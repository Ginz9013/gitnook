import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// 直接匯入各模組，不繞 src/index.ts。CLI 是這個 package 內部的呼叫端，走公開面
// 只會逼公開面為了自己人而變寬 —— 而每一個匯出都是永久的相容負債。
import { openBoard } from '../core/board.js';
import { ConflictingGitAttributes, NestedBoard, findBoardRoot } from '../core/gitattributes.js';
import { repair } from '../core/health.js';
import type { Repair } from '../core/health.js';
import { shortIdLength } from '../core/ids.js';
import { AlreadySharedBoard, NoGitDir } from '../core/sharing.js';
import {
  AmbiguousRef,
  AmbiguousWorkspaceRef,
  BoardNotInitialized,
  IncompleteRef,
  InvalidStatus,
  IssueDeleted,
  NotAWorkspaceMember,
  RefNotFound,
  RefNotFoundInWorkspace,
} from '../core/types.js';
import { PortInUse, serve } from '../server/serve.js';
import { dispatchDecision } from './decision.js';
import { dispatchIssue } from './issue.js';
import { dispatchWorkspace } from './workspace.js';
import type { SetKey } from '../core/ops.js';
import type { Board, Change, CreateInput, Diagnostic } from '../core/types.js';

/**
 * argv → Board → render → exit code。
 *
 * 指令刻意保持薄 —— 複雜度屬於 Board（spec.md「Design contract」）。
 */

/**
 * CLI 與外界的唯一接觸面。真實 process 一個 adapter、測試捕獲一個 adapter ——
 * spec.md 兩個真實接縫之一，理由是 CLI 測試不該 spawn 子行程。
 */
export interface Io {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 資料寫 stdout。 */
  write(text: string): void;
  /** 錯誤與警告寫 stderr。 */
  writeError(text: string): void;
  /** stdin 全文。只有 `-` 會呼叫。 */
  readStdin(): string;
  /** stdin 是互動終端嗎？`--editor` 靠它在非 TTY 時報錯而不是卡住。 */
  readonly isTty: boolean;
  /**
   * 互動確認讀一行 —— `rm` 的「真的要刪嗎」。
   *
   * 與 readStdin 是兩件事：那個讀到 EOF 為止（`-` 的用法就是餵一份東西
   * 進來），拿它問問題會停在使用者按 Ctrl-D 才回來。
   *
   * **選用是為了接縫外的呼叫端**：`test/agent-doc.test.ts` 用一個手工的 `Io`
   * literal 跑 `--help`，它不在 `test/cli/run.test.ts` 的 `capture()` 裡，必填
   * 就編不過。代價是 `rm` 要多擋一次 —— 沒有它的 adapter 沒有確認可問，於是
   * 要求 `--yes`（見 `confirmed`）。
   */
  readLine?(): string;
  /**
   * 長駐指令（studio）的關閉信號。真實 adapter 綁 SIGINT，測試綁一個
   * AbortController —— 沒有它，`studio` 就只能靠殺掉 process 來結束。
   */
  readonly signal?: AbortSignal | undefined;
}

/**
 * 真實 process 的 adapter。放在這裡而不是 bin/nook.js，是為了讓「資料走
 * stdout、錯誤走 stderr」這條接線本身也被測到 —— bin 因此可以薄到沒有東西會錯。
 */
export function processIo(signal?: AbortSignal): Io {
  return {
    cwd: process.cwd(),
    env: process.env,
    isTty: process.stdin.isTTY === true,
    write: (text) => void process.stdout.write(text),
    writeError: (text) => void process.stderr.write(text),
    // fd 0 一次讀完。`-` 的用法本來就是「把一份東西餵進來」。
    readStdin: () => readFileSync(0, 'utf8'),
    readLine: readLineFromStdin,
    ...(signal === undefined ? {} : { signal }),
  };
}

/** 兩次探問之間的間隔。夠短到打字沒有延遲感，夠長到不算忙等。 */
const POLL_MS = 20;

/**
 * fd 0 讀到第一個換行為止。終端機在正常（canonical）模式下本來就是一行一
 * 送，所以這裡不必自己處理逐字元輸入；迴圈只是為了不假設一次 read 就拿得
 * 到整行。讀到 EOF 就交出手上有的 —— 那等於使用者沒有回答，呼叫端會當成否定。
 */
function readLineFromStdin(): string {
  const buffer = Buffer.alloc(256);
  // 下面那個 `Atomics.wait` 是一次同步的睡眠，而**它靠逾時返回**：`idle[0]` 永遠
  // 是 0，也就是等待時要比對的那個期望值，所以它一定進入等待；而全程沒有任何地方
  // 呼叫 `Atomics.notify`，於是喚醒它的只可能是 POLL_MS 到期。這個陣列從頭到尾不
  // 存任何東西 —— `Atomics.wait` 需要一塊 shared memory 才等得起來，它就是那一塊。
  //
  // 被否決的替代方案是忙等：在等一個人打字的那幾秒裡會把一顆核心燒滿。
  const idle = new Int32Array(new SharedArrayBuffer(4));
  let answer = '';
  for (;;) {
    let read: number;
    try {
      read = readSync(0, buffer, 0, buffer.length, null);
    } catch (thrown) {
      // 終端機的 fd 0 是 non-blocking 的：還沒有人打字時 read 立刻以 EAGAIN
      // 失敗。那不是錯誤而是「還沒輸入」—— 照著拋出去，rm 會在真實終端機上
      // 變成一個 exit 2 的內部錯誤（實測如此，而這條路徑沒有測試看得到）。
      if ((thrown as NodeJS.ErrnoException).code !== 'EAGAIN') throw thrown;
      Atomics.wait(idle, 0, 0, POLL_MS);
      continue;
    }
    if (read === 0) return answer;
    const chunk = buffer.toString('utf8', 0, read);
    const end = chunk.indexOf('\n');
    if (end !== -1) return answer + chunk.slice(0, end);
    answer += chunk;
  }
}

/**
 * CLI 自己發現的使用者錯誤（用法不對、欄位不存在）。與領域錯誤同樣是 exit 1。
 * export 供 `cli/workspace.ts` 重用（票 02）——同一種錯誤只走一條路徑
 * （`run()` 的 catch），不在新檔裡另開一條手寫 errLine + return 1。
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * 使用者能自己修好的錯誤。其餘一律是 nook 的 bug —— 兩者的 exit code 不同，
 * 因為呼叫端對它們該做的事不同（改指令 vs 回報）。
 */
const USER_ERRORS = [
  UsageError,
  BoardNotInitialized,
  RefNotFound,
  AmbiguousRef,
  InvalidStatus,
  // 對一張已刪的 Issue 寫入：使用者先復原（set deleted false）就修好了，
  // 而且什麼都沒壞 —— 那是一次被擋下的寫入，不是一個值得回報的 nook bug。
  IssueDeleted,
  ConflictingGitAttributes,
  // 在 board 底下再 init：使用者 cd 到根目錄就修好了，而且不修也沒有壞任何東西。
  NestedBoard,
  // init --private 撞到一塊已經共享出去的 board：使用者自己跑
  // `git rm -r --cached .issues` 就修好了，而且什麼都沒壞 —— 那是一次被擋下
  // 的寫入。訊息本身就是他的下一步，掛上型別名只會蓋掉它。
  AlreadySharedBoard,
  // init --private 在 git repo 外：沒有 git 就沒有東西需要藏，改跑 nook init
  // 就得到他要的那塊 board。同樣是「改你的指令」，不是一個值得回報的 bug。
  NoGitDir,
  PortInUse,
  // `memberAt()` 解析出來的 Board 不在這個 workspace 的 members 裡：使用者的
  // `--in` 打到了掃描範圍外的路徑，改成範圍內的路徑就修好了 —— 同樣不是
  // nook 的 bug（票 02，第一個用到 `memberAt` 的地方）。
  NotAWorkspaceMember,
  // 跨 board 操作給了短前綴：改成完整 26 碼 ULID 就修好了，訊息本身就是
  // 下一步（票 03，第一個用到 `locateInWorkspace` 的地方）。
  IncompleteRef,
  // `locateInWorkspace()` 掃過全部成員都找不到這個 ref：使用者的 ref 打錯了，
  // 不是 nook 的 bug。
  RefNotFoundInWorkspace,
  // 同一個 ref 同時存在於多個成員：資料完整性問題，使用者自己造成的（見
  // spec.md Non-goals），不是 nook 的 bug。
  AmbiguousWorkspaceRef,
] as const;

export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    if (USER_ERRORS.some((type) => error instanceof type)) {
      errLine(io, error.message);
      return 1;
    }
    // 內部錯誤帶上 name：ENOTDIR 這類訊息單看不出是哪一類失敗。
    errLine(io, `${error.name}: ${error.message}`);
    return 2;
  }
}

async function dispatch(argv: readonly string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;

  // 沒有指令時印說明，不是錯誤 —— 使用者要的東西就是它。
  if (command === undefined || command === '--help' || command === '-h') {
    io.write(HELP);
    return 0;
  }
  if (command === '--version' || command === '-v') {
    line(io, version());
    return 0;
  }

  switch (command) {
    case 'issue':
      return dispatchIssue(rest, io);
    case 'decision':
      return dispatchDecision(rest, io);
    case 'doctor':
      return cmdDoctor(parseArgs(rest, DOCTOR_FLAGS), io);
    case 'studio':
      return cmdStudio(parseArgs(rest, STUDIO_FLAGS), io);
    case 'workspace':
      return dispatchWorkspace(rest, io);
  }

  // pre-1.0 breaking change（票 05）：11 個扁平 Issue 指令全部搬進
  // `nook issue <verb>`，沒有相容別名（CHANGELOG 的既有政策明講允許）。打
  // 舊指令得到的必須是一句指向新路徑的明確訊息 —— 落回下面模糊的
  // unknownCommand 只會讓人以為自己打錯字，去猜一個離題的候選。
  if ((LEGACY_ISSUE_COMMANDS as readonly string[]).includes(command)) {
    throw new UsageError(
      `\`nook ${command}\` moved to \`nook issue ${command}\` — this is a breaking, ` +
        'pre-1.0 change with no compatibility alias (see CHANGELOG)',
    );
  }

  throw new UsageError(unknownCommand(command));
}

/**
 * 票 05 之前的 11 個扁平 Issue 指令，現在全部只活在 `nook issue <verb>` 底下。
 * 名單只用來認出「這是一個搬過家的舊指令」，好給出比模糊的 unknownCommand
 * 更明確的那句話 —— 不是給 `dispatchIssue` 用的清單（那份清單在
 * `cli/issue.ts` 自己手上）。
 */
const LEGACY_ISSUE_COMMANDS = [
  'init',
  'new',
  'list',
  'show',
  'history',
  'set',
  'rm',
  'mv',
  'comment',
  'label',
  'share',
] as const;

/** 頂層指令：ADR-0005 的近似建議只在這個小得多的命名空間裡做，子命名空間
 * 各自的未知子指令另外處理（`dispatchIssue`/`dispatchWorkspace`/
 * `dispatchDecision`，都只列出可用清單，不做模糊猜測）。 */
const COMMANDS = ['issue', 'decision', 'doctor', 'studio', 'workspace'];

/** 打錯字與想要一個不存在的功能是兩件事，回答也該不一樣。 */
function unknownCommand(command: string): string {
  const near = COMMANDS.filter((known) => distance(known, command) <= 2).sort(
    (a, b) => distance(a, command) - distance(b, command),
  );
  // 差太遠就不硬猜一個 —— 猜錯比不猜更難查。
  return near.length === 0
    ? `unknown command ${command} (see nook --help)`
    : `unknown command ${command}; did you mean ${near[0]!}?`;
}

/** Levenshtein。只用來排序候選，不需要比這更聰明。 */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitute = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitute));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** export 供 `cli/workspace.ts` 重用（票 02），不在新檔裡重寫一份同樣的兩行。 */
export const line = (io: Io, text: string): void => io.write(`${text}\n`);
export const errLine = (io: Io, text: string): void => io.writeError(`${text}\n`);

/**
 * Ref 的分工：**顯示用短的，交付用完整的。**
 *
 * `list` / `show` / 看板印的是短 ID，每次對**當下的 Board** 重算 —— 它只需要
 * 在讀者眼前那一刻無歧義。`new` 交付的則是完整的 26 碼 ULID，因為那是唯一
 * 永久有效的 Ref。
 *
 * 長度一律對整個 Board 算，不是對正要印的那幾張。ULID 前綴編的是時間的高位，
 * 前 6 碼每 17.5 分鐘才變一次；對單張（或一份過濾後的子集）去算，會得出一個
 * 在整塊 Board 上對應到幾十張 Issue 的前綴，而解析是對整塊 Board 做的。
 *
 * 來源是 `board.refs()`（票 15）而不是 `list({ all: true })`：算長度只需要一串
 * Ref，而 list 會把整塊 Board 的 Op-log 摺一遍。走 refs() 只列目錄，所以連
 * `show` 都付得起 —— 票 13 的「show 只讀它要的那一張」因此仍然成立。
 *
 * export 供 `cli/workspace.ts` 重用（票 02）——ADR-0006「長度只有一個算法」，
 * 兩處各自重算同一個公式正是那條規則要擋的漂移。
 */
export function displayLength(board: Board): number {
  return shortIdLength(board.refs());
}

/**
 * 每次互動都可能被讀，所以每一行都要付得起 token（ADR-0005）——這條預算
 * 因為票 05 的 `nook issue <verb>` 命名空間而變得更緊：11 個扁平指令全部多
 * 出一個 `issue ` 前綴，`decision` 那組還要從零生出。省下來的餘裕全部來自
 * 描述文字的精簡，而不是拿掉任何一個指令或旗標——藏起一個存在的指令與教一
 * 個不存在的指令是同一種錯。
 *
 * 對齊：`issue ` 前綴長度一律相同，其餘沿用「兩個空白分隔」的既有慣例。
 */
const HELP = `nook <command>

issue init [--private]  create the board; --private = no committed bytes
issue new <title> [--description <t|->] [--label <l>] [--editor]
issue list [--all] [--status <s>] [--label <l>] [--json]
issue show <ref> [--json]
issue history <ref> [<field>]  every write to an LWW field
issue set <ref> <title|description|status|archived|deleted> <value|-> [--editor]
issue rm <ref> [--yes]  delete; --yes off a TTY
issue mv <ref> <status>
issue comment <ref> <body|->
issue label <ref> +bug -ui
issue share  upgrade a private board to shared
decision init|new|show
doctor [--fix]           health check; --fix repairs glued lines
studio [--port <n>]      localhost board
workspace list [flags]   grouped by member, same filters as list

status: backlog todo queued in_progress review blocked done cancelled
<ref>/status accept an unambiguous prefix; <value> reads stdin with -.
queued is an authorization boundary: once set, an agent may act on it.
list hides archived / done / cancelled by default.
`;

/**
 * 版本取自套件自身的 package.json —— 從本模組往上找，dev 樹與打包後的
 * dist 樹都成立，不必假設任何固定的相對深度。
 */
function version(): string {
  let here = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const file = join(here, 'package.json');
    if (existsSync(file)) {
      const pkg: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const found = (pkg as { version?: unknown }).version;
      if (typeof found === 'string') return found;
    }
    const parent = dirname(here);
    if (parent === here) return '0.0.0';
    here = parent;
  }
}

/**
 * 需要接一個值的旗標。其餘以 `--` 開頭者都是開關。
 * export 供 `cli/workspace.ts` 重用（票 02）—— 兩處指令共用同一份判斷，
 * 不重寫一份可能漂開的副本。
 */
export const VALUED: ReadonlySet<string> = new Set([
  '--status',
  '--label',
  '--description',
  '--port',
  // `workspace new --in <path>`（票 02）：跟其餘會接一個值的旗標同一份判斷，
  // 不在 `cli/workspace.ts` 重寫第二份可能漂開的副本。
  '--in',
]);

/** 每個指令認得的旗標。不在名單上的一律報錯 —— 靜默吃掉一個打錯的旗標，
 * 呼叫端會拿到一份沒過濾的答案卻以為自己過濾了。Issue 11 個扁平指令自己的
 * 旗標名單搬進了 `cli/issue.ts`，這裡只留 doctor/studio 自己的兩份。 */
const DOCTOR_FLAGS: ReadonlySet<string> = new Set(['--fix']);
const STUDIO_FLAGS: ReadonlySet<string> = new Set(['--port']);

/** 供 `cli/workspace.ts` 重用（票 02），不在新檔裡重寫一份參數解析器。 */
export interface Args {
  readonly positional: readonly string[];
  has(flag: string): boolean;
  /** 可重複的旗標 —— `--label a --label b` 是收斂條件（AND）。 */
  all(flag: string): readonly string[];
  one(flag: string): string | undefined;
}

export function parseArgs(args: readonly string[], allowed: ReadonlySet<string>): Args {
  const positional: string[] = [];
  const switches = new Set<string>();
  const values = new Map<string, string[]>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // `-` 是「從 stdin 讀」的位置引數，不是旗標。
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (!allowed.has(arg)) throw new UsageError(`unrecognized flag ${arg} (see nook --help)`);
    if (!VALUED.has(arg)) {
      switches.add(arg);
      continue;
    }
    const value = args[++i];
    if (value === undefined) throw new UsageError(`${arg} is missing a value`);
    const bucket = values.get(arg);
    if (bucket === undefined) values.set(arg, [value]);
    else bucket.push(value);
  }

  return {
    positional,
    has: (flag) => switches.has(flag),
    all: (flag) => values.get(flag) ?? [],
    one: (flag) => values.get(flag)?.at(-1),
  };
}

/**
 * 這次呼叫實際作用的 board 根目錄。
 *
 * core 已經由 io.cwd 向上尋根（票 15），所以 CLI 這邊每一個問「這個目錄裡的
 * 檔案」的地方都必須問同一塊 board。拿 io.cwd 去問，使用者只要 cd 進任何子
 * 目錄就會得到另一個目錄的答案 —— 而幾乎沒有人是站在 repo 根目錄打指令的。
 *
 * 找不到根時退回 io.cwd：doctor 在還不是 board 的目錄也該答得出話（同
 * board.health()），該說的「先跑 nook init」由讀資料的那一步負責。
 *
 * 成本是每層一次 existsSync，不 spawn 任何子行程 —— 冷啟預算（spec.md 四個
 * 硬指標）與「list 不 spawn git rev-parse」的保證都不受影響。
 *
 * export 供 `cli/issue.ts` 重用（票 05）——doctor 留在這個檔案，Issue 的讀取
 * 指令（list/show/history/init/share）搬進 `cli/issue.ts`，兩邊問的都必須是
 * 同一塊 board 根目錄，不能各自尋根出兩個答案。
 */
export function boardDir(io: Io): string {
  const found = findBoardRoot(io.cwd);
  return found.found ? found.root : io.cwd;
}

/**
 * 五個 LWW 欄位：`set` 可寫的，也是 `history` 可查的。
 * labels 有專屬的 OR-Set 語意，不走這裡。
 *
 * `deleted` 在這份名單上，`nook set <ref> deleted <bool>` 與
 * `nook history <ref> deleted` 因此不必各寫一份 —— 刪除是既有 LWW 機器上的
 * 一個欄位，不是一種新的東西（ADR-0009）。
 */
/** export 供 `cli/workspace.ts` 重用（票 03）——欄位名單只有一份。 */
export const SETTABLE = [
  'title',
  'description',
  'status',
  'archived',
  'deleted',
] as const satisfies readonly SetKey[];
/** export 供 `cli/workspace.ts` 重用（票 03），`asChange()` 的參數型別。 */
export type Field = (typeof SETTABLE)[number];

/** export 供 `cli/workspace.ts` 重用（票 03）——欄位驗證只有一份，不重打第二份。 */
export const isSettable = (value: string): value is Field =>
  (SETTABLE as readonly string[]).includes(value);

/**
 * 長文的兩條路之一：`-` 表示從 stdin 讀（`nook set X description - < bug.md`）——
 * agent 的正解，零 shell 跳脫問題。
 */
const STDIN = '-';

/** export 供 `cli/workspace.ts` 重用（票 02）—— `new --description`/`--in` 組裝
 * 邏輯的長文一半，不重寫一份可能漂開的副本。 */
export function longText(value: string, io: Io): string {
  if (value !== STDIN) return value;
  // 檔案結尾的換行是檔案的事，不該變成內容的一部分。
  return io.readStdin().replace(/\r?\n$/, '');
}

/**
 * 長文的另一條路：開 $EDITOR —— 人的正解。
 *
 * 非 TTY 時報錯而不是卡住：agent 的管線正是非 TTY，掛在一個等不到輸入的
 * 編輯器上等於整條管線掛死。兩道守門都在任何寫入之前。
 */
/** export 供 `cli/workspace.ts` 重用（票 02），理由同 `longText`。 */
export function fromEditor(io: Io, seed: string): string {
  if (!io.isTty) throw new UsageError('--editor needs an interactive terminal; off a TTY, use - to read from stdin');

  const editor = (io.env.VISUAL ?? io.env.EDITOR ?? '').trim();
  if (editor === '') throw new UsageError('$EDITOR is not set; use - to read from stdin instead');

  const file = join(mkdtempSync(join(tmpdir(), 'nook-edit-')), 'NOOK_EDITMSG.md');
  writeFileSync(file, seed, 'utf8');
  // $EDITOR 可以帶參數（`code -w`），所以照 shell 的習慣切開。
  const [command, ...rest] = editor.split(/\s+/);
  execFileSync(command!, [...rest, file], { stdio: 'inherit' });

  return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
}

/**
 * 兩個 boolean 欄位。`yes` 被靜默讀成真值，就是一次沒有人打算下達的刪除。
 * export 供 `cli/workspace.ts` 重用（票 03），理由同 `SETTABLE`。
 */
export const BOOLEAN_FIELDS: ReadonlySet<string> = new Set(['archived', 'deleted']);

/** export 供 `cli/workspace.ts` 重用（票 03）——欄位組裝邏輯只有一份。 */
export function asChange(field: Field, value: string): Change {
  if (BOOLEAN_FIELDS.has(field)) {
    if (value !== 'true' && value !== 'false') {
      throw new UsageError(`${field} only accepts true or false: ${value}`);
    }
    return { [field]: value === 'true' };
  }
  return { [field]: value };
}

/**
 * 問一次「真的要刪嗎」。**答案不是 y 就是否定** —— 一個看不懂的回答在這裡
 * 只能當成「不要」。
 *
 * 非 TTY 是 agent 的實際情境：掛在一個等不到輸入的確認上等於整條管線掛死，
 * 所以那裡拒絕而不是等待（同 --editor 的既有守門），出口是 `--yes`。
 *
 * **兩個擋法各說各的話。** 沒有終端機，與這個 `Io` 交不出一行輸入，是兩件不同
 * 的事 —— 合成一句，第二種處境會被告知一件與它無關而且是假的事（「非 TTY」），
 * 而讀訊息的人會去查一個好好的終端機為什麼不算終端機。出口兩邊同樣是 `--yes`。
 *
 * 問句帶著標題：前綴打錯而刪掉另一張，正是這道關卡存在的理由。它走 stderr，
 * 因為 stdout 是資料。
 *
 * export 供 `cli/workspace.ts` 重用（票 07）——workspace 版的 `rm` 靠組好帶
 * 成員路徑的字串當 `title` 傳進來，簽章與行為原封不動，不改這個函式本身。
 */
export function confirmed(io: Io, title: string): boolean {
  if (!io.isTty) throw new UsageError('rm asks for confirmation by default; off a TTY, add --yes');
  if (io.readLine === undefined) {
    throw new UsageError('rm asks for confirmation by default; this io has no readLine to ask with, add --yes');
  }

  io.writeError(`Delete ${title}? (y/N) `);
  if (io.readLine().trim().toLowerCase() === 'y') return true;

  errLine(io, 'Cancelled: nothing was deleted');
  return false;
}

/** 沒有關閉信號就一直服務下去 —— 由 process 本身的生命週期收尾。 */
function untilAborted(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return new Promise<void>(() => {});
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * 瀏覽器裡的看板，讀寫都能做（ADR-0007）—— 拖曳搬 Status、drawer 改標題與
 * label、留言，全都走 `POST /i/<ref>`。
 *
 * 只綁 loopback，且**刻意不提供 `--host`**：寫入面沒有任何驗證，能連到這個
 * port 的人就能改這塊 board。那條界線由「只有本機連得上」守著，不是由設定
 * 守著 —— 一個 `--host` 旗標會讓它變成一次手滑就能跨過的東西（ADR-0007）。
 */
async function cmdStudio(args: Args, io: Io): Promise<number> {
  const given = args.one('--port');
  const port = given === undefined ? undefined : Number(given);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new UsageError(`not a valid port: ${given}`);
  }

  const studio = await serve(openBoard({ dir: io.cwd }), port === undefined ? {} : { port });
  line(io, studio.url);

  await untilAborted(io.signal);
  await studio.close();
  return 0;
}

/**
 * 資料健康。健康時沉默、有 Diagnostic 時逐條印出並回非 0 —— 讓 CI 接得住。
 *
 * `--fix` 先修再診斷：報告一個「可修復」卻不給任何修復途徑，等於只是在指責
 * 使用者。修完必須重跑，否則印出來的是一份已經過期的診斷。
 */
/**
 * `repair()` 修好一個黏合行印的那一句。export 供 `cli/workspace.ts` 重用
 * （票 03）——同一句措辭只有一份，不在兩個 `cmdDoctor` 各自重打一次。
 */
export function formatRepaired(fixed: Repair): string {
  return `Repaired  ${fixed.file}:${fixed.line}  split back into ${fixed.ops} ops`;
}

/**
 * 一條 Diagnostic 印成的那一行（不含開頭的縮排/標籤，呼叫端各自決定要不要
 * 加）。export 供 `cli/workspace.ts` 重用（票 03），理由同 `formatRepaired`。
 */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file === undefined ? '' : `${d.file}${d.line === undefined ? '' : `:${d.line}`}  `;
  return `${d.kind}  ${where}${d.message}`;
}

function cmdDoctor(args: Args, io: Io): number {
  if (args.has('--fix')) {
    // 修的必須是 board 根目錄那一塊。拿 io.cwd 去修，在子目錄執行時掃不到
    // 任何 op-log —— 那是靜默不修：它會 exit 0 卻什麼都沒動。
    for (const fixed of repair(boardDir(io))) {
      line(io, formatRepaired(fixed));
    }
  }

  // 走 board.health() 而不是 diagnose(io.cwd)：Board 已經會尋根，而「在子目錄
  // 診斷錯的目錄」與「不是 board 的目錄也要答得出話」這兩件事只該有一份
  // 實作。這也是 README 給 library 呼叫端的承諾：board.health() 就是 nook doctor 報的。
  const found = openBoard({ dir: io.cwd }).health();
  for (const d of found) {
    line(io, formatDiagnostic(d));
  }
  return found.length === 0 ? 0 : 1;
}

/**
 * `+bug -ui` 形狀的 token 分成 add/remove 兩堆——單一 Board 版本
 * （`cli/issue.ts` 的 `cmdLabel`，票 05 搬過去的）與 workspace 版本
 * （`cli/workspace.ts` 票 06）共用同一份解析，不重寫第二份可能漂開的迴圈。
 *
 * OR-Set 的 `seen` 語意完全在 core：這裡只負責把 token 分堆交給 apply()。
 * export 供 `cli/issue.ts`（票 05）與 `cli/workspace.ts`（票 06）重用。
 */
export function parseLabelTokens(tokens: readonly string[]): {
  add: string[];
  remove: string[];
} {
  const add: string[] = [];
  const remove: string[] = [];
  for (const token of tokens) {
    const sign = token[0];
    const value = token.slice(1);
    // 少了正負號的 `bug` 若被當成「移除 ug」，呼叫端會以為自己改了一個
    // 其實沒動過的 Label —— 靜默猜測比報錯貴得多（票 10 的慣例）。
    if ((sign !== '+' && sign !== '-') || value === '') {
      throw new UsageError(`a label must be written as +<label> or -<label>: ${token}`);
    }
    (sign === '+' ? add : remove).push(value);
  }
  return { add, remove };
}

/**
 * `title` 之外的 `CreateInput` 組裝——`--editor`/`--description`/`--label`。
 * export 供 `cli/workspace.ts` 重用（票 02）：workspace 版的 `new` 只是目標
 * board 換一個來源，其餘欄位組裝跟單一 Board 版本一字不差，不重寫一份
 * 可能漂開的副本。`title` 由呼叫端自己驗證並傳進來——兩邊的「缺標題」用法
 * 錯誤訊息不一樣（`nook new` vs `nook workspace new ... --in`），不適合
 * 塞進這個共用函式。
 */
export function assembleCreateInput(title: string, args: Args, io: Io): CreateInput {
  // 編輯器與 `-` 是同一件事的兩條路，不會同時走。
  let description: string | undefined;
  if (args.has('--editor')) {
    description = fromEditor(io, '');
  } else {
    const given = args.one('--description');
    if (given !== undefined) description = longText(given, io);
  }

  const labels = args.all('--label');
  return {
    title,
    ...(description === undefined ? {} : { description }),
    ...(labels.length === 0 ? {} : { labels }),
  };
}
