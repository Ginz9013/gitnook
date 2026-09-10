import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// 直接匯入各模組，不繞 src/index.ts。CLI 是這個 package 內部的呼叫端，走公開面
// 只會逼公開面為了自己人而變寬 —— 而每一個匯出都是永久的相容負債。
import { openBoard } from '../core/board.js';
import {
  ConflictingGitAttributes,
  MERGE_RULE,
  NestedBoard,
  findBoardRoot,
  initBoard,
  inspectMergeGuarantee,
} from '../core/gitattributes.js';
import { repair } from '../core/health.js';
import { isValidRef, shortIdLength } from '../core/ids.js';
import { fieldWrites } from '../core/reduce.js';
import { inspectSharing } from '../core/sharing.js';
import {
  AmbiguousRef,
  BoardNotInitialized,
  InvalidStatus,
  IssueDeleted,
  RefNotFound,
} from '../core/types.js';
import { renderJson } from '../render/json.js';
import { renderSetOps, renderTable } from '../render/table.js';
import { PortInUse, serve } from '../server/serve.js';
import type { SetKey } from '../core/ops.js';
import type { Board, Change, CreateInput, Filter } from '../core/types.js';

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

/** CLI 自己發現的使用者錯誤（用法不對、欄位不存在）。與領域錯誤同樣是 exit 1。 */
class UsageError extends Error {
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
  PortInUse,
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
    case 'init':
      return cmdInit(parseArgs(rest, INIT_FLAGS), io);
    case 'new':
      return cmdNew(parseArgs(rest, NEW_FLAGS), io);
    case 'list':
      return cmdList(parseArgs(rest, LIST_FLAGS), io);
    case 'show':
      return cmdShow(parseArgs(rest, SHOW_FLAGS), io);
    case 'history':
      return cmdHistory(parseArgs(rest, NO_FLAGS), io);
    case 'set':
      return cmdSet(parseArgs(rest, SET_FLAGS), io);
    case 'rm':
      return cmdRm(parseArgs(rest, RM_FLAGS), io);
    case 'mv':
      return cmdMv(parseArgs(rest, NO_FLAGS), io);
    case 'comment':
      return cmdComment(parseArgs(rest, NO_FLAGS), io);
    case 'label':
      return cmdLabel(parseArgs(rest, NO_FLAGS), io);
    case 'doctor':
      return cmdDoctor(parseArgs(rest, DOCTOR_FLAGS), io);
    case 'studio':
      return cmdStudio(parseArgs(rest, STUDIO_FLAGS), io);
  }

  throw new UsageError(unknownCommand(command));
}

const COMMANDS = ['init', 'new', 'list', 'show', 'history', 'set', 'rm', 'mv', 'comment', 'label', 'doctor', 'studio'];

/** 打錯字與想要一個不存在的功能是兩件事，回答也該不一樣。 */
function unknownCommand(command: string): string {
  const near = COMMANDS.filter((known) => distance(known, command) <= 2).sort(
    (a, b) => distance(a, command) - distance(b, command),
  );
  // 差太遠就不硬猜一個 —— 猜錯比不猜更難查。
  return near.length === 0
    ? `未知的指令 ${command}（nook --help 看全部）`
    : `未知的指令 ${command}；最接近的是 ${near[0]!}`;
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

const line = (io: Io, text: string): void => io.write(`${text}\n`);
const errLine = (io: Io, text: string): void => io.writeError(`${text}\n`);

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
 */
function displayLength(board: Board): number {
  return shortIdLength(board.refs());
}

/**
 * 每次互動都可能被讀，所以每一行都要付得起 token（ADR-0005）。
 * 指令一行一個，後面只留兩條「不知道就會做錯」的規則。
 */
const HELP = `nook <command>

init [--private]                       建立 board；--private 不留 committed bytes
new <title> [--description <text|->] [--label <l>] [--editor]
list [--all] [--status <s>] [--label <l>] [--json]
show <ref> [--json]
history <ref> [<field>]                看某個 LWW 欄位被寫過哪些值
set <ref> <title|description|status|archived|deleted> <value|-> [--editor]
rm <ref> [--yes]                       刪除；非 TTY 需 --yes
mv <ref> <status>
comment <ref> <body|->
label <ref> +bug -ui                   加減 Label（無優先級欄位，用 Label）
doctor [--fix]                         資料健康檢查，--fix 修復黏合行
studio [--port <n>]                    localhost 看板，可拖拉與編輯

status: backlog todo queued in_progress review blocked done cancelled
<ref> 與 status 都接受無歧義前綴。<value> 用 - 從 stdin 讀。
queued 是授權邊界：進入 queued 表示已授權 agent 直接動手。
list 預設隱藏 archived / done / cancelled。
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

/** 需要接一個值的旗標。其餘以 `--` 開頭者都是開關。 */
const VALUED: ReadonlySet<string> = new Set(['--status', '--label', '--description', '--port']);

/** 每個指令認得的旗標。不在名單上的一律報錯 —— 靜默吃掉一個打錯的旗標，
 * 呼叫端會拿到一份沒過濾的答案卻以為自己過濾了。 */
const NO_FLAGS: ReadonlySet<string> = new Set();
const INIT_FLAGS: ReadonlySet<string> = new Set(['--private']);
const NEW_FLAGS: ReadonlySet<string> = new Set(['--description', '--editor', '--label']);
const LIST_FLAGS: ReadonlySet<string> = new Set(['--all', '--status', '--label', '--json']);
const SHOW_FLAGS: ReadonlySet<string> = new Set(['--json']);
const SET_FLAGS: ReadonlySet<string> = new Set(['--editor']);
const RM_FLAGS: ReadonlySet<string> = new Set(['--yes']);
const DOCTOR_FLAGS: ReadonlySet<string> = new Set(['--fix']);
const STUDIO_FLAGS: ReadonlySet<string> = new Set(['--port']);

interface Args {
  readonly positional: readonly string[];
  has(flag: string): boolean;
  /** 可重複的旗標 —— `--label a --label b` 是收斂條件（AND）。 */
  all(flag: string): readonly string[];
  one(flag: string): string | undefined;
}

function parseArgs(args: readonly string[], allowed: ReadonlySet<string>): Args {
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
    if (!allowed.has(arg)) throw new UsageError(`不認得的旗標 ${arg}（nook --help 看用法）`);
    if (!VALUED.has(arg)) {
      switches.add(arg);
      continue;
    }
    const value = args[++i];
    if (value === undefined) throw new UsageError(`${arg} 缺少值`);
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
 */
function boardDir(io: Io): string {
  const found = findBoardRoot(io.cwd);
  return found.found ? found.root : io.cwd;
}

/**
 * .gitattributes 是整個零衝突保證的唯一單點失效 —— 被誤刪時資料會靜默開始
 * 衝突。讀取類指令因此主動監看它。警告走 stderr，管線上的資料不受污染。
 *
 * 問的是 inspectMergeGuarantee 而不是 diagnose：這裡只需要知道那一行還在不在，
 * 而完整診斷要再掃一次全部 op-log 並 spawn 一個 git rev-parse —— 對每一次
 * list / show 都收這筆帳，直接吃掉冷啟預算（spec.md 四個硬指標）。
 */
function warnIfUnguarded(io: Io): void {
  // absent 與 conflicting 都表示 op-log 拿不到 union，兩者同樣要警告。
  if (inspectMergeGuarantee(boardDir(io)).kind !== 'union') {
    errLine(io, '警告：.gitattributes 缺少 merge=union，合併會衝突（nook init 補回）');
  }
}

function cmdList(args: Args, io: Io): number {
  const status = args.one('--status');
  const labels = args.all('--label');
  const filter: Filter = {
    ...(args.has('--all') ? { all: true } : {}),
    ...(status === undefined ? {} : { status }),
    ...(labels.length === 0 ? {} : { labels }),
  };

  // 先讀資料：board 根本不存在時，該說的是「先跑 nook init」而不是兩個問題。
  const board = openBoard({ dir: io.cwd });
  const issues = board.list(filter);
  warnIfUnguarded(io);
  // 長度對整塊 Board 算，不是對這份過濾後的結果 —— 預設檢視藏起 archived /
  // done / cancelled，而它們仍然是 board.get() 的候選。對子集算出來的前綴
  // 會在解析端撞號，也就是印出一個打不開的 Ref（ADR-0006）。
  line(io, args.has('--json') ? renderJson(issues) : renderTable(issues, displayLength(board)));
  return 0;
}

/**
 * 讀到一張已刪的 Issue 時該說的那句話。**前半段的字串歸 `IssueDeleted` 所有**
 * —— 手抄一份，兩邊遲早各自漂移，而它們講的是同一件事。
 *
 * 後半段是出路：只說東西沒了，誤刪的人下一步無處可去。它不屬於那個錯誤型別
 * （core 不知道有 CLI 這回事），所以接在這裡。
 */
function deletedMessage(ref: string): string {
  return `${new IssueDeleted(ref).message}（nook history ${ref} 撈得回寫過的值，nook set ${ref} deleted false 復原）`;
}

/**
 * `show` 與 `list` 印的是同一個顯示用表示法，所以長度也必須一樣 —— 對整塊
 * Board 算。`board.refs()` 只列目錄、不摺疊任何 Op-log，因此票 13 的效能保證
 * （`test/cli/run.test.ts` 的「單點失效的監看不該把整個 Board 掃一遍」守住）
 * 仍然成立：詳情這條路徑只會讀被點名的那一個 op-log。
 */
function cmdShow(args: Args, io: Io): number {
  const board = openBoard({ dir: io.cwd });
  const ref = requireRef(args.positional[0] ?? '');
  const issue = board.get(ref);

  // `board.get()` 對已刪的 Issue 不拋（ADR-0009），正是為了讓這裡分得出
  // 「被刪了」與「找不到」—— 兩者要修的東西完全不同。訊息必須帶出撈得回來
  // 的方法：只說東西沒了，誤刪的人下一步無處可去。
  // 擺在 warnIfUnguarded 之前 —— 一個問題就講一個問題（同尚未 init 的目錄）。
  if (issue.deleted) {
    errLine(io, deletedMessage(ref));
    return 1;
  }

  warnIfUnguarded(io);
  // 單一物件而非長度 1 的陣列 —— 串接端不必為了取一張 Issue 去拆陣列。
  line(io, args.has('--json') ? renderJson(issue) : renderTable(issue, displayLength(board)));
  return 0;
}

/**
 * 五個 LWW 欄位：`set` 可寫的，也是 `history` 可查的。
 * labels 有專屬的 OR-Set 語意，不走這裡。
 *
 * `deleted` 在這份名單上，`nook set <ref> deleted <bool>` 與
 * `nook history <ref> deleted` 因此不必各寫一份 —— 刪除是既有 LWW 機器上的
 * 一個欄位，不是一種新的東西（ADR-0009）。
 */
const SETTABLE = [
  'title',
  'description',
  'status',
  'archived',
  'deleted',
] as const satisfies readonly SetKey[];
type Field = (typeof SETTABLE)[number];

const isSettable = (value: string): value is Field =>
  (SETTABLE as readonly string[]).includes(value);

/**
 * 一張 Issue 的 Op-log 中的 set Op —— 每一次對 LWW 欄位的寫入，誰寫的、
 * 在哪個 lamport `t`、寫成什麼。
 *
 * 存在的理由只有一個：`description` 是 LWW，並行編輯時摺疊只留一份，敗方的
 * 文字完整躺在檔案裡卻沒有任何指令拿得回來。看得到就手動 copy 回 `nook set`
 * 拿得回來 —— **刻意不做 restore**，那是 append 一個新 Op 把舊值寫回去，不是
 * 「回到過去」，語意值得單獨定。
 *
 * 只列對 LWW 欄位的寫入：`create` 折成 title 的第一次寫入（core 的 `fieldWrites`），
 * label 是 OR-Set、comment 只增不減，兩者都不會弄丟東西，而 comment 在 `show`
 * 就看得到。
 * **本指令唯讀，不 append 任何 Op。**
 */
function cmdHistory(args: Args, io: Io): number {
  const [ref, field] = args.positional;
  if (ref === undefined) throw new UsageError('用法：nook history <ref> [<field>]');
  requireRef(ref);
  // 打錯欄位名而靜默回一份空清單，等於告訴呼叫端「那個欄位從沒被寫過」——
  // 而他正是在找一份被蓋掉的舊值。同 `set` 與未知旗標的慣例：不靜默猜測。
  if (field !== undefined && !isSettable(field)) {
    throw new UsageError(`不是可查的欄位：${field}（可用：${SETTABLE.join(', ')}）`);
  }

  const board = openBoard({ dir: io.cwd });
  // 摺疊與篩選都在 core，**與 `GET /api/history/<ref>` 是同一份** —— 兩邊各留一份
  // 就是票 B9 的成因。順序沿用 `opLog` 的全序，這裡與 core 都不再碰它。
  const ops = fieldWrites(board.opLog(ref), field);
  // 同 list / show：單點失效的監看擺在讀完之後，board 不存在時該說的是
  // 「先跑 nook init」而不是兩個問題。
  warnIfUnguarded(io);
  line(io, renderSetOps(ops));
  return 0;
}

/**
 * 長文的兩條路之一：`-` 表示從 stdin 讀（`nook set X description - < bug.md`）——
 * agent 的正解，零 shell 跳脫問題。
 */
const STDIN = '-';

function longText(value: string, io: Io): string {
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
function fromEditor(io: Io, seed: string): string {
  if (!io.isTty) throw new UsageError('--editor 需要互動終端；非 TTY 請改用 - 從 stdin 讀');

  const editor = (io.env.VISUAL ?? io.env.EDITOR ?? '').trim();
  if (editor === '') throw new UsageError('沒有設定 $EDITOR；改用 - 從 stdin 讀');

  const file = join(mkdtempSync(join(tmpdir(), 'nook-edit-')), 'NOOK_EDITMSG.md');
  writeFileSync(file, seed, 'utf8');
  // $EDITOR 可以帶參數（`code -w`），所以照 shell 的習慣切開。
  const [command, ...rest] = editor.split(/\s+/);
  execFileSync(command!, [...rest, file], { stdio: 'inherit' });

  return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
}

/** 兩個 boolean 欄位。`yes` 被靜默讀成真值，就是一次沒有人打算下達的刪除。 */
const BOOLEAN_FIELDS: ReadonlySet<string> = new Set(['archived', 'deleted']);

function asChange(field: Field, value: string): Change {
  if (BOOLEAN_FIELDS.has(field)) {
    if (value !== 'true' && value !== 'false') {
      throw new UsageError(`${field} 只接受 true 或 false：${value}`);
    }
    return { [field]: value === 'true' };
  }
  return { [field]: value };
}

function cmdSet(args: Args, io: Io): number {
  const [ref, field, value] = args.positional;
  const usage = '用法：nook set <ref> <title|description|status|archived|deleted> <value|->';
  if (ref === undefined || field === undefined) throw new UsageError(usage);
  requireRef(ref);
  if (!(SETTABLE as readonly string[]).includes(field)) {
    throw new UsageError(`不是可寫的欄位：${field}（可用：${SETTABLE.join(', ')}）`);
  }

  const board = openBoard({ dir: io.cwd });

  let text: string;
  if (args.has('--editor')) {
    // 以現值開場 —— 編輯既有的 description 才是這條路的實際用途。
    const current = board.get(ref);
    text = fromEditor(io, field === 'title' || field === 'description' ? current[field] : '');
  } else {
    if (value === undefined) throw new UsageError(usage);
    text = longText(value, io);
  }

  const updated = board.apply(ref, asChange(field as Field, text));
  // 回印更新後那一行 —— 呼叫端不必再跑一次 show 才知道結果。
  line(io, renderTable([updated], displayLength(board)));
  return 0;
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
 */
function confirmed(io: Io, title: string): boolean {
  if (!io.isTty) throw new UsageError('rm 預設要互動確認；非 TTY 請加 --yes');
  if (io.readLine === undefined) {
    throw new UsageError('rm 預設要互動確認；這個 io 沒有 readLine，問不出問題，請加 --yes');
  }

  io.writeError(`刪除 ${title}？(y/N) `);
  if (io.readLine().trim().toLowerCase() === 'y') return true;

  errLine(io, '取消：沒有刪除任何東西');
  return false;
}

/**
 * 刪除。定義是「`set <ref> deleted true` **加上一次確認**」—— 不是第二條
 * 路徑，是一層安全包裝，所以寫入仍然只經過 `board.apply` 那一個決定點。
 *
 * 檔案永遠不 unlink：留下的是一個墓碑欄位（ADR-0009）。modify/delete 是
 * merge=union 不涵蓋的固有衝突，而零衝突是這個工具的第一句話。
 */
function cmdRm(args: Args, io: Io): number {
  const [ref] = args.positional;
  if (ref === undefined) throw new UsageError('用法：nook rm <ref> [--yes]');
  requireRef(ref);

  const board = openBoard({ dir: io.cwd });
  const target = board.get(ref);

  // 已經刪掉了。問「真的要刪嗎」是在為一次**不可能落地的寫入**要求一個決定 ——
  // 答了 y 之後拿到的仍然是 `board.apply` 丟出來的 `IssueDeleted`。
  //
  // 這是**讀取側的呈現判斷**，與上面 `cmdShow` 的同一類：`board.get()` 對已刪的
  // Issue 不拋（ADR-0009），CLI 因此讀得到這一格，決定的只是「要不要開口問」。
  // **寫入安全那個決定點仍然只有 `board.apply` 一個**，這裡沒有第二份守門 ——
  // 把它拿掉，刪除照樣擋得住，只是訊息回到那句不好的。
  if (target.deleted) {
    errLine(io, deletedMessage(ref));
    return 1;
  }

  // 守門在任何寫入之前。
  if (!args.has('--yes') && !confirmed(io, target.title)) return 1;

  board.apply(ref, { deleted: true });
  // 回印的不是更新後那一行 —— 一張已刪的 Issue 印成普通的一列，看起來會像
  // 什麼都沒發生。說出刪掉的是哪一張，同 init 的「動詞 + 對象」。
  line(io, `Deleted  ${target.id.slice(0, displayLength(board))}  ${target.title}`);
  return 0;
}

/**
 * 一張 Issue 的生命週期會用上四次以上，因頻率而回本 ——
 * `set <ref> status <value>` 的捷徑。
 */
function cmdMv(args: Args, io: Io): number {
  const [ref, status] = args.positional;
  if (ref === undefined || status === undefined) throw new UsageError('用法：nook mv <ref> <status>');
  requireRef(ref);

  const board = openBoard({ dir: io.cwd });
  const updated = board.apply(ref, { status });
  line(io, renderTable([updated], displayLength(board)));
  return 0;
}

/**
 * Ref 是使用者輸入，而完整識別碼會被接進檔案路徑。core 目前也擋，但 CLI 是
 * 第一個接觸點 —— 而且「找不到 issue：../../etc/passwd」會暗示這種 issue
 * 有可能存在。它不可能存在。
 */
function requireRef(ref: string): string {
  if (!isValidRef(ref)) throw new UsageError(`不是合法的 ref：${ref}`);
  return ref;
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
    throw new UsageError(`不是合法的 port：${given}`);
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
function cmdDoctor(args: Args, io: Io): number {
  if (args.has('--fix')) {
    // 修的必須是 board 根目錄那一塊。拿 io.cwd 去修，在子目錄執行時掃不到
    // 任何 op-log —— 那是靜默不修：它會 exit 0 卻什麼都沒動。
    for (const fixed of repair(boardDir(io))) {
      line(io, `Repaired  ${fixed.file}:${fixed.line}  拆回 ${fixed.ops} 個 op`);
    }
  }

  // 走 board.health() 而不是 diagnose(io.cwd)：Board 已經會尋根，而「在子目錄
  // 診斷錯的目錄」與「不是 board 的目錄也要答得出話」這兩件事只該有一份
  // 實作。這也是 README 給 library 呼叫端的承諾：board.health() 就是 nook doctor 報的。
  const found = openBoard({ dir: io.cwd }).health();
  for (const d of found) {
    const where = d.file === undefined ? '' : `${d.file}${d.line === undefined ? '' : `:${d.line}`}  `;
    line(io, `${d.kind}  ${where}${d.message}`);
  }
  return found.length === 0 ? 0 : 1;
}

/** Comment 是 Nook 中唯一的討論載體，人與 agent 共用。只增不減。 */
function cmdComment(args: Args, io: Io): number {
  const [ref, body] = args.positional;
  if (ref === undefined || body === undefined) throw new UsageError('用法：nook comment <ref> <body>');
  requireRef(ref);

  const board = openBoard({ dir: io.cwd });
  const updated = board.apply(ref, { comment: longText(body, io) });
  line(io, renderTable([updated], displayLength(board)));
  return 0;
}

/**
 * Nook 沒有優先級欄位 —— 優先級用 Label 表達（CONTEXT.md）。`+bug -ui` 的寫法
 * 讓加與減在同一行說完，而不是兩個子指令。
 *
 * OR-Set 的 `seen` 語意完全在 core：這裡只把 token 分成兩堆交給 apply()。
 */
function cmdLabel(args: Args, io: Io): number {
  const [ref, ...tokens] = args.positional;
  if (ref === undefined || tokens.length === 0) {
    throw new UsageError('用法：nook label <ref> +<label> -<label>');
  }
  requireRef(ref);

  const add: string[] = [];
  const remove: string[] = [];
  for (const token of tokens) {
    const sign = token[0];
    const value = token.slice(1);
    // 少了正負號的 `bug` 若被當成「移除 ug」，呼叫端會以為自己改了一個
    // 其實沒動過的 Label —— 靜默猜測比報錯貴得多（票 10 的慣例）。
    if ((sign !== '+' && sign !== '-') || value === '') {
      throw new UsageError(`label 要寫成 +<label> 或 -<label>：${token}`);
    }
    (sign === '+' ? add : remove).push(value);
  }

  const board = openBoard({ dir: io.cwd });
  const updated = board.apply(ref, { labels: { add, remove } });
  line(io, renderTable([updated], displayLength(board)));
  return 0;
}

/**
 * init 是一次性的建置動作，因此它說話 —— 而 doctor 不說（unix「沒消息就是好
 * 消息」，且它會進 CI）。ADR-0005 的 token 預算管的是 40 票的日常情境，init
 * 一輩子只跑一次且不在該情境內，這幾行買到的是「我到底建了什麼」。
 *
 * 狀態必須在 initBoard 之前讀完 —— 之後再讀，看到的是它剛寫完的結果，
 * 三種結果會全部塌成「本來就在」。initBoard 丟例外時一行都不印。
 */
function cmdInit(args: Args, io: Io): number {
  if (args.has('--private')) return initPrivate(io);

  const enclosing = findBoardRoot(io.cwd);
  const boardExisted = enclosing.found && enclosing.root === io.cwd;
  const guarded = inspectMergeGuarantee(io.cwd).kind === 'union';
  const attributesExisted = existsSync(join(io.cwd, '.gitattributes'));

  initBoard(io.cwd);

  if (!boardExisted) line(io, 'Created  .issues/issues/');
  // 補一行進別人的檔案與整個檔案都是我建的，是兩件不同的事 —— 說成 Created
  // 會讓使用者以為原本的規則被蓋掉了。動詞補到等寬，路徑才對得起來。
  const verb = attributesExisted ? 'Added  ' : 'Created';
  if (!guarded) line(io, `${verb}  .gitattributes  ${MERGE_RULE}`);
  // 兩件事都已經在了才是 no-op。沉默在這裡會與第一次的成功長得一模一樣，
  // 而使用者問的正是「這次到底有沒有動到東西」。
  if (boardExisted && guarded) line(io, 'Unchanged  這裡已經是一塊 board，這次沒有建立任何東西');
  return 0;
}

/**
 * private mode 的 init。輸出沿用同一套三分法（建了 / 補了 / 什麼都沒做），
 * 外加一條**必須**被講出來的代價：被 git ignore 的 board 是一份沒有備份的
 * 資料，`git clean -xdf` 會把它整塊刪掉。
 *
 * 狀態同樣在寫入之前問完 —— 寫完再問，答案永遠是「已經在了」。
 */
function initPrivate(io: Io): number {
  const enclosing = findBoardRoot(io.cwd);
  const boardExisted = enclosing.found && enclosing.root === io.cwd;
  const excluded = inspectSharing(io.cwd) === 'private';

  initBoard(io.cwd, { sharing: 'private' });

  if (!boardExisted) line(io, 'Created  .issues/issues/');
  if (!excluded) line(io, 'Ignored  .issues/  $GIT_DIR/info/exclude（這塊 board 不會被 commit）');
  // 兩件事都已經在了才是 no-op。沉默在這裡會與第一次的成功長得一模一樣。
  if (boardExisted && excluded) {
    line(io, 'Unchanged  這裡已經是一塊 private board，這次沒有建立任何東西');
  }
  // 每次都印：重跑 init 的人正是在問「我這塊 board 現在是什麼狀態」，而這是
  // 那個答案裡最貴的一件事。
  line(io, 'Note  git clean -xdf 會刪掉整塊 board，而且沒有備份');
  return 0;
}

function cmdNew(args: Args, io: Io): number {
  const title = args.positional[0];
  if (title === undefined) throw new UsageError('用法：nook new <title>');

  // 編輯器與 `-` 是同一件事的兩條路，不會同時走。
  let description: string | undefined;
  if (args.has('--editor')) {
    description = fromEditor(io, '');
  } else {
    const given = args.one('--description');
    if (given !== undefined) description = longText(given, io);
  }

  const labels = args.all('--label');
  const input: CreateInput = {
    title,
    ...(description === undefined ? {} : { description }),
    ...(labels.length === 0 ? {} : { labels }),
  };

  const issue = openBoard({ dir: io.cwd }).create(input);
  // 印完整的 26 碼 ULID 而非短 ID —— 那是唯一**永久有效**的 Ref。短 ID 只在
  // 印出的當下無歧義：ULID 前綴編的是時間高位，下一張 Issue 就可能延伸同一個
  // 前綴，把剛交出去的 ref 變成有歧義的。`new` 的輸出會被存進變數、寫進腳本、
  // 貼進 commit message，它必須在那之後仍然指得到同一張 Issue。
  line(io, issue.id);
  return 0;
}
