import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AmbiguousRef,
  BoardNotInitialized,
  ConflictingGitAttributes,
  InvalidStatus,
  PortInUse,
  RefNotFound,
  diagnose,
  initBoard,
  inspectMergeGuarantee,
  isValidRef,
  openBoard,
  renderJson,
  renderTable,
  repair,
  serve,
  shortIdLength,
} from '../index.js';
import type { Board, Change, CreateInput, Filter, Issue } from '../index.js';

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
    ...(signal === undefined ? {} : { signal }),
  };
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
  ConflictingGitAttributes,
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
      initBoard(io.cwd);
      // 成功即沉默 —— 每一行輸出都在吃 agent 的 token 預算（docs/adr/0005）。
      return 0;
    case 'new':
      return cmdNew(parseArgs(rest, NEW_FLAGS), io);
    case 'list':
      return cmdList(parseArgs(rest, LIST_FLAGS), io);
    case 'show':
      return cmdShow(parseArgs(rest, SHOW_FLAGS), io);
    case 'set':
      return cmdSet(parseArgs(rest, SET_FLAGS), io);
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

const COMMANDS = ['init', 'new', 'list', 'show', 'set', 'mv', 'comment', 'label', 'doctor', 'studio'];

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
 * 顯示用短 ID。盲取 6 碼會撞號 —— ULID 前綴編的是時間的高位，同一段時間內
 * 建立的 Issue 前 6 碼完全相同，印出去就是一個不能用的 ref。
 */
function shortId(board: Board, issue: Issue): string {
  const ids = board.list({ all: true }).map((i) => i.id);
  return issue.id.slice(0, shortIdLength(ids));
}

/**
 * 每次互動都可能被讀，所以每一行都要付得起 token（ADR-0005）。
 * 指令一行一個，後面只留三條「不知道就會做錯」的規則。
 */
const HELP = `nook <command>

init                                   建立 .issues/ 與 .gitattributes
new <title> [--description <text|->] [--label <l>] [--editor]
list [--all] [--status <s>] [--label <l>] [--json]
show <ref> [--json]
set <ref> <title|description|status|archived> <value|-> [--editor]
mv <ref> <status>
comment <ref> <body|->
label <ref> +bug -ui                   加減 Label（無優先級欄位，用 Label）
doctor [--fix]                         資料健康檢查，--fix 修復黏合行
studio [--port <n>]                    localhost 唯讀看板

status: backlog todo queued in_progress review blocked done cancelled
<ref> 與 status 都接受無歧義前綴。<value> 用 - 從 stdin 讀。
queued 是授權邊界：進入 queued 表示已授權 agent 直接動手。
blocked 必須同時留一則 comment 說明原因。
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
const NEW_FLAGS: ReadonlySet<string> = new Set(['--description', '--editor', '--label']);
const LIST_FLAGS: ReadonlySet<string> = new Set(['--all', '--status', '--label', '--json']);
const SHOW_FLAGS: ReadonlySet<string> = new Set(['--json']);
const SET_FLAGS: ReadonlySet<string> = new Set(['--editor']);
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
 * .gitattributes 是整個零衝突保證的唯一單點失效 —— 被誤刪時資料會靜默開始
 * 衝突。讀取類指令因此主動監看它。警告走 stderr，管線上的資料不受污染。
 *
 * 問的是 inspectMergeGuarantee 而不是 diagnose：這裡只需要知道那一行還在不在，
 * 而完整診斷要再掃一次全部 op-log 並 spawn 一個 git rev-parse —— 對每一次
 * list / show 都收這筆帳，直接吃掉冷啟預算（spec.md 四個硬指標）。
 */
function warnIfUnguarded(io: Io): void {
  // absent 與 conflicting 都表示 op-log 拿不到 union，兩者同樣要警告。
  if (inspectMergeGuarantee(io.cwd).kind !== 'union') {
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
  const issues = openBoard({ dir: io.cwd }).list(filter);
  warnIfUnguarded(io);
  line(io, args.has('--json') ? renderJson(issues) : renderTable(issues));
  return 0;
}

function cmdShow(args: Args, io: Io): number {
  const issue = openBoard({ dir: io.cwd }).get(requireRef(args.positional[0] ?? ''));
  warnIfUnguarded(io);
  // 單一物件而非長度 1 的陣列 —— 串接端不必為了取一張票去拆陣列。
  line(io, args.has('--json') ? renderJson(issue) : renderTable(issue));
  return 0;
}

/** `set` 可寫的欄位。labels 有專屬的 OR-Set 語意，不走這裡。 */
const SETTABLE = ['title', 'description', 'status', 'archived'] as const;
type Field = (typeof SETTABLE)[number];

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

function asChange(field: Field, value: string): Change {
  if (field === 'archived') {
    if (value !== 'true' && value !== 'false') throw new UsageError(`archived 只接受 true 或 false：${value}`);
    return { archived: value === 'true' };
  }
  return { [field]: value };
}

function cmdSet(args: Args, io: Io): number {
  const [ref, field, value] = args.positional;
  const usage = '用法：nook set <ref> <title|description|status|archived> <value|->';
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
  remindIfBlocked(io, updated);
  // 回印更新後那一行 —— 呼叫端不必再跑一次 show 才知道結果。
  line(io, renderTable([updated]));
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
  remindIfBlocked(io, updated);
  line(io, renderTable([updated]));
  return 0;
}

/**
 * blocked 遺失的資訊是「卡住前在做什麼」，只有 Comment 補得回來（ADR-0003）——
 * 所以這條規則是提醒而不是錯誤：擋下狀態會讓「卡住」這件事整個消失，比缺一則
 * 說明更糟。
 */
function remindIfBlocked(io: Io, issue: Issue): void {
  if (issue.status === 'blocked' && issue.comments.length === 0) {
    errLine(io, '提醒：blocked 要有一則說明原因的 comment（nook comment <ref> <why>）');
  }
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

/** 唯讀的會議投影用檢視器。只綁 loopback，且刻意不提供 --host。 */
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
    for (const fixed of repair(io.cwd)) {
      line(io, `Repaired  ${fixed.file}:${fixed.line}  拆回 ${fixed.ops} 個 op`);
    }
  }

  const found = diagnose(io.cwd);
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
  line(io, renderTable([board.apply(ref, { comment: longText(body, io) })]));
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

  const updated = openBoard({ dir: io.cwd }).apply(ref, { labels: { add, remove } });
  line(io, renderTable([updated]));
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

  const board = openBoard({ dir: io.cwd });
  const issue = board.create(input);
  // 印短 ID 而非整行 —— 呼叫端接著要的就是這個 ref。
  line(io, shortId(board, issue));
  return 0;
}
