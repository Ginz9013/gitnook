import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDecisionLog } from '../core/decisionLog.js';
import {
  DECISION_LOG_SAMPLE,
  DECISION_MERGE_RULE,
  findDecisionRoot,
  initDecisionRoot,
  inspectMergeGuarantee,
} from '../core/gitattributes.js';
import { isValidRef, shortIdLength } from '../core/ids.js';
import {
  AmbiguousDecisionRef,
  DecisionLogNotInitialized,
  DecisionNotFound,
  InvalidDisposition,
} from '../core/decisionTypes.js';
import type {
  CreateDecisionInput,
  Decision,
  DecisionChange,
  DecisionFilter,
} from '../core/decisionTypes.js';
import { ConflictingGitAttributes, NestedBoard } from '../core/gitattributes.js';
import { decisionFieldWrites } from '../core/decisionReduce.js';
import { renderDecisionDetail, renderDecisionSetOps, renderDecisionTable } from '../render/table.js';
import { errLine, fromEditor, line, longText, UsageError } from './run.js';
import type { Io } from './run.js';

/**
 * `nook decision <init|new|show|...>` 的 argv → DecisionLog → render → exit
 * code —— 同 `dispatchWorkspace` 的先例（`cli/workspace.ts`）：`run.ts` 只留
 * 一個 `case 'decision': return dispatchDecision(rest, io)`。
 *
 * 這一批（票 01）只接 `init`/`new`/`show`——`list`/`set`/`history` 屬於票
 * 02/03/04，它們對這個檔案的擴充是一條誠實的全序鏈（spec.md 的批次表），
 * 不是刻意製造的序列化。
 *
 * **這個函式自己把全部使用者錯誤接成 exit 1，從不把它們丟出去**——不倚賴
 * `run.ts` 的 `USER_ERRORS`。那份清單活在這張票的寫入範圍之外（`run.ts`
 * 只准加一個 case，改 `USER_ERRORS` 會牴觸這條限制，且會跟拆分 dispatch 的
 * 票 05 相撞），而票的 Test seam 明講要直接測 `dispatchDecision(argv, io)`
 * ——不透過 `run()`，所以這裡若把已知的使用者錯誤丟出去，直接呼叫端（測試、
 * 未來的第二個呼叫端）就拿不到正確的 exit code。真正意料之外的內部錯誤仍然
 * 往外丟，讓 `run()` 走它既有的「內部錯誤」那一支（`${error.name}:
 * ${error.message}`，exit 2）。
 */
export async function dispatchDecision(argv: readonly string[], io: Io): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (thrown) {
    if (DECISION_USER_ERRORS.some((type) => thrown instanceof type)) {
      errLine(io, (thrown as Error).message);
      return 1;
    }
    throw thrown;
  }
}

const DECISION_USER_ERRORS = [
  UsageError,
  // gitattributes 的既有型別（`initDecisionRoot` 內部沿用）——訊息與語意
  // 逐字同 Issue 側的 `initBoard`，見 `core/gitattributes.ts`。
  ConflictingGitAttributes,
  NestedBoard,
  DecisionLogNotInitialized,
  DecisionNotFound,
  AmbiguousDecisionRef,
  InvalidDisposition,
] as const;

async function dispatch(argv: readonly string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;

  switch (sub) {
    case 'init':
      return cmdInit(parseDecisionArgs(rest, NO_FLAGS, NO_FLAGS), io);
    case 'new':
      return cmdNew(parseDecisionArgs(rest, NEW_FLAGS, NEW_FLAGS), io);
    case 'list':
      return cmdList(parseDecisionArgs(rest, LIST_VALUED_FLAGS, LIST_FLAGS), io);
    case 'show':
      return cmdShow(parseDecisionArgs(rest, NO_FLAGS, SHOW_FLAGS), io);
    case 'set':
      return cmdSet(parseDecisionArgs(rest, NO_FLAGS, SET_FLAGS), io);
    case 'history':
      return cmdHistory(parseDecisionArgs(rest, NO_FLAGS, NO_FLAGS), io);
  }

  throw new UsageError(
    `unknown decision subcommand: ${sub ?? ''} (available: init, new, list, show, set, history)`,
  );
}

/**
 * 一個吃「值旗標名單」為參數的小型 argv 解析器 —— **刻意不重用 `run.ts` 的
 * `parseArgs`**：那個函式的「哪些旗標接一個值」（`VALUED`）是模組層級寫死的
 * 一份清單，而這張票不准碰 `run.ts` 除了那一個 case 之外的任何一行（避免跟
 * 拆分 dispatch 的票 05 相撞）。`--title`/`--body`/`--disposition` 因此另外
 * 在這裡自己維護一份，範圍只限 Decision 的子指令。
 */
interface DecisionArgs {
  readonly positional: readonly string[];
  has(flag: string): boolean;
  one(flag: string): string | undefined;
}

function parseDecisionArgs(
  args: readonly string[],
  valued: ReadonlySet<string>,
  allowed: ReadonlySet<string>,
): DecisionArgs {
  const positional: string[] = [];
  const switches = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (!allowed.has(arg)) throw new UsageError(`unrecognized flag ${arg} (see nook --help)`);
    if (!valued.has(arg)) {
      switches.add(arg);
      continue;
    }
    const value = args[++i];
    if (value === undefined) throw new UsageError(`${arg} is missing a value`);
    values.set(arg, value);
  }

  return {
    positional,
    has: (flag) => switches.has(flag),
    one: (flag) => values.get(flag),
  };
}

const NO_FLAGS: ReadonlySet<string> = new Set();
const NEW_FLAGS: ReadonlySet<string> = new Set(['--title', '--body', '--disposition']);
const SHOW_FLAGS: ReadonlySet<string> = new Set(['--json']);
const LIST_VALUED_FLAGS: ReadonlySet<string> = new Set(['--disposition']);
const LIST_FLAGS: ReadonlySet<string> = new Set(['--disposition', '--json']);
const SET_FLAGS: ReadonlySet<string> = new Set(['--editor']);

/**
 * `.gitattributes` 的那一行這次發生了什麼事，講成一行字 —— 同 `run.ts` 的
 * `guaranteeLine`（那個函式沒有 export，且改它同樣落在「只准加一個 case」
 * 的限制之外，所以這裡另起一份，換上 Decision 專屬的訊息與樣本路徑）。
 */
function guaranteeLine(dir: string): (io: Io) => void {
  const guarded = inspectMergeGuarantee(dir, DECISION_LOG_SAMPLE).kind === 'union';
  const existed = existsSync(join(dir, '.gitattributes'));
  return (target) => {
    if (guarded) return;
    line(target, `${existed ? 'Added  ' : 'Created'}  .gitattributes  ${DECISION_MERGE_RULE}`);
  };
}

/**
 * `nook decision init`：建立 `.decisions/decisions/` 與 `merge=union` 那一行。
 * 已存在衝突規則時 `initDecisionRoot` 拋 `ConflictingGitAttributes`，往外丟
 * 給 `run()` 的既有 `USER_ERRORS` 處理——那個型別已經在清單上，不必在這裡
 * 重複接。`NestedBoard` 同理。
 */
function cmdInit(_args: DecisionArgs, io: Io): number {
  const enclosing = findDecisionRoot(io.cwd);
  const logExisted = enclosing.found && enclosing.root === io.cwd;
  const guarded = inspectMergeGuarantee(io.cwd, DECISION_LOG_SAMPLE).kind === 'union';
  const sayGuarantee = guaranteeLine(io.cwd);

  initDecisionRoot(io.cwd);

  if (!logExisted) line(io, 'Created  .decisions/decisions/');
  sayGuarantee(io);
  if (logExisted && guarded) line(io, 'Unchanged  this is already a decision log; nothing was created');
  return 0;
}

/**
 * `nook decision new --title <t> [--body <b>] [--disposition <d>]`：印出完整
 * 26 碼 ULID——同 `nook new` 既有理由，短 ID 只在印出當下無歧義。
 */
function cmdNew(args: DecisionArgs, io: Io): number {
  const title = args.one('--title');
  const usage = 'usage: nook decision new --title <t> [--body <b>] [--disposition <d>]';
  if (title === undefined) throw new UsageError(usage);

  const body = args.one('--body');
  const disposition = args.one('--disposition');

  const input: CreateDecisionInput = {
    title,
    ...(body === undefined ? {} : { body }),
    ...(disposition === undefined ? {} : { disposition }),
  };

  const decision = openDecisionLog({ dir: io.cwd }).create(input);
  line(io, decision.id);
  return 0;
}

/**
 * `nook decision list [--disposition <d>] [--json]`：compact table（ref/
 * title/disposition），沒有索引沒有快取（ADR-0002 的既有取捨）——票 02
 * spec.md 的 Outcome，「title list 快速搜尋是否有特定決策」的答案。
 *
 * 短 ID 長度對整個 Decision Log 算（`log.refs()`），不是對過濾後的結果算——
 * 理由同 `run.ts` 的 `displayLength`／`cmdList`：對子集算出來的前綴會在解析端
 * 撞號。`--disposition` 的無歧義前綴解析交給 `DecisionLog.list()` 內部呼叫的
 * `resolveDisposition`，這裡不重複驗證一次。
 */
function cmdList(args: DecisionArgs, io: Io): number {
  const disposition = args.one('--disposition');
  const filter: DecisionFilter = disposition === undefined ? {} : { disposition };

  const log = openDecisionLog({ dir: io.cwd });
  const decisions = log.list(filter);
  const len = shortIdLength(log.refs());

  line(io, args.has('--json') ? renderDecisionListJson(decisions) : renderDecisionTable(decisions, len));
  return 0;
}

/** Ref 是使用者輸入，完整識別碼會被接進檔案路徑——同 `run.ts` 的 `requireRef`。 */
function requireRef(ref: string): string {
  if (!isValidRef(ref)) throw new UsageError(`not a valid ref: ${ref}`);
  return ref;
}

/**
 * `nook decision show <ref> [--json]`：預設輸出走 `renderDecisionDetail`——
 * 同 Issue 的 `nook show`，compact header 一行＋body 區塊，不是逐欄
 * key:value 傾印（票 08 review 判定的版面問題，見票 08 spec.md 的「從哪來」）。
 * JSON 輸出走本檔自己的一份 sortKeys + stringify，不重用 `render/json.ts`
 * （它的簽章釘死在 `Issue`，且不在這張票的寫入範圍），且不受本票影響。
 */
function cmdShow(args: DecisionArgs, io: Io): number {
  const log = openDecisionLog({ dir: io.cwd });
  const ref = requireRef(args.positional[0] ?? '');
  const decision = log.get(ref);

  line(io, args.has('--json') ? renderDecisionJson(decision) : renderDecisionDetail(decision));
  return 0;
}

/**
 * `title`/`body`/`disposition`/`supersededBy`——`DecisionLog.apply()`（票 01）
 * 已經接受的四個 LWW 欄位，這裡只是把欄位名單釘成一份 CLI 端可驗證的清單。
 * 不像 Issue 的 `SETTABLE`（`run.ts`）沒有布林欄位，所以不需要一份
 * `BOOLEAN_FIELDS` 對應物。
 */
const DECISION_SETTABLE = ['title', 'body', 'disposition', 'supersededBy'] as const;
type DecisionField = (typeof DECISION_SETTABLE)[number];

const isDecisionSettable = (value: string): value is DecisionField =>
  (DECISION_SETTABLE as readonly string[]).includes(value);

/**
 * `history` 的可查欄位比 `set` 的可寫欄位多一個 `legacyRef`——兩份名單
 * **不對稱是刻意的**，不是 `DECISION_SETTABLE` 沒同步更新。`legacyRef` 不是
 * `set` 可寫的欄位（spec.md Non-goals：只在遷移當下手動標記一次），但它一旦
 * 被寫過，`nook decision history <ref>`（不帶欄位）本來就會把它列進「全部
 * 欄位」──`decisionFieldWrites(ops, undefined)` 不看欄位名單，全部 set op
 * 照樣折出來。若這裡只放行 `DECISION_SETTABLE`，`history <ref> legacyRef`
 * 會拋 UsageError，卻在不給欄位時又看得到同一筆紀錄，這種只在單欄位查詢時
 * 消失的不一致才是真正的 bug。
 */
const DECISION_HISTORY_FIELDS = [...DECISION_SETTABLE, 'legacyRef'] as const;
type DecisionHistoryField = (typeof DECISION_HISTORY_FIELDS)[number];

const isDecisionHistoryField = (value: string): value is DecisionHistoryField =>
  (DECISION_HISTORY_FIELDS as readonly string[]).includes(value);

/** 欄位名 + 新值 → `DecisionChange`——同 `run.ts` 的 `asChange`，一個 switch
 * 換掉那裡的 `BOOLEAN_FIELDS` 分支（Decision 沒有布林欄位可寫）。 */
function decisionChangeFor(field: DecisionField, value: string): DecisionChange {
  switch (field) {
    case 'title':
      return { title: value };
    case 'body':
      return { body: value };
    case 'disposition':
      return { disposition: value };
    case 'supersededBy':
      return { supersededBy: value };
  }
}

/**
 * `nook decision set <ref> <title|body|disposition|supersededBy> <value|->
 * [--editor]`：語意同 `nook set`（`run.ts` 的 `cmdSet`）——`-` 讀 stdin、
 * `--editor` 開 `$EDITOR`（兩者互斥的既有規則沿用 `longText`/`fromEditor`，
 * 不重寫），回印更新後那一列走 `renderDecisionTable`（同 `list` 的緊湊列
 * 版面，不是 `show` 的 detail 版面——這是「回印剛剛改了什麼」，不是「看
 * 這張 Decision 的全貌」）。
 *
 * `disposition` 的前綴解析與 `supersededBy` 的形狀驗證都留給
 * `DecisionLog.apply()`（票 01 已做完，見 `decisionLog.ts` 的 `apply()`）——
 * 這裡不重複驗證一次，`InvalidDisposition`/`DecisionNotFound` 直接往外丟，
 * 由 `dispatchDecision` 既有的 `DECISION_USER_ERRORS` 接住。
 */
function cmdSet(args: DecisionArgs, io: Io): number {
  const [ref, field, value] = args.positional;
  const usage = 'usage: nook decision set <ref> <title|body|disposition|supersededBy> <value|-> [--editor]';
  if (ref === undefined || field === undefined) throw new UsageError(usage);
  requireRef(ref);
  if (!isDecisionSettable(field)) {
    throw new UsageError(`not a writable field: ${field} (available: ${DECISION_SETTABLE.join(', ')})`);
  }

  const log = openDecisionLog({ dir: io.cwd });

  let text: string;
  if (args.has('--editor')) {
    // 以現值開場——同 `run.ts` 的既有理由：編輯既有的長文才是這條路的實際用途。
    const current = log.get(ref);
    text = fromEditor(io, field === 'title' || field === 'body' ? current[field] : '');
  } else {
    if (value === undefined) throw new UsageError(usage);
    text = longText(value, io);
  }

  const updated = log.apply(ref, decisionChangeFor(field, text));
  // 回印更新後那一列——呼叫端不必再跑一次 show 才知道結果，同 `nook set`。
  line(io, renderDecisionTable([updated], shortIdLength(log.refs())));
  return 0;
}

/**
 * `nook decision history <ref> [<title|body|disposition|supersededBy|legacyRef>]`：
 * 某個欄位（或不給欄位時全部欄位）曾經被寫過的所有值，帶 actor 與
 * lamport `t`——同票 09 對 Issue `history` 的先例（`cli/issue.ts` 的
 * `cmdHistory`）：**唯讀，不做 restore**，看得到就手動 `nook decision set`
 * 貼回去。
 *
 * 可查詢的欄位名單是 `DECISION_HISTORY_FIELDS`，比 `set` 的
 * `DECISION_SETTABLE` 多一個 `legacyRef`——見該常數上的註解：不給欄位時
 * `decisionFieldWrites()` 本來就不篩欄位，`legacyRef` 一旦被寫過就會出現，
 * 所以單欄位查詢也該放行，否則同一筆紀錄會「不給欄位看得到、指名欄位卻
 * 查不到」。
 *
 * 摺疊與篩選都在 core 的 `decisionFieldWrites()`（票 01），排序沿用
 * `DecisionLog.opLog()` 內部呼叫的 `orderOps`——這裡與 `render/table.ts` 都
 * 不再各寫一份比較器（spec.md 明講這正是 commit 463343d 那個 bug 的成因）。
 * **本指令唯讀，不 append 任何 Op。**
 */
function cmdHistory(args: DecisionArgs, io: Io): number {
  const [ref, field] = args.positional;
  const usage = 'usage: nook decision history <ref> [<title|body|disposition|supersededBy|legacyRef>]';
  if (ref === undefined) throw new UsageError(usage);
  requireRef(ref);
  // 打錯欄位名而靜默回一份空清單，等於告訴呼叫端「那個欄位從沒被寫過」——
  // 同 Issue 的既有慣例：不靜默猜測。
  if (field !== undefined && !isDecisionHistoryField(field)) {
    throw new UsageError(`not a queryable field: ${field} (available: ${DECISION_HISTORY_FIELDS.join(', ')})`);
  }

  const log = openDecisionLog({ dir: io.cwd });
  const ops = decisionFieldWrites(log.opLog(ref), field);
  line(io, renderDecisionSetOps(ops));
  return 0;
}

/** 鍵依字母排序——同 `render/json.ts` 的 `sortKeys` 對 Issue 的既有慣例，
 * 這裡另起一份是因為那個檔案的簽章釘死在 `Issue` 且不在這張票的寫入範圍。 */
function sortDecisionKeys(decision: Decision): Record<string, unknown> {
  const source = decision as unknown as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = source[key];
  return sorted;
}

/** `--json`：鍵依字母排序，無縮排——同 `render/json.ts` 對 Issue 的既有慣例。 */
function renderDecisionJson(decision: Decision): string {
  return JSON.stringify(sortDecisionKeys(decision));
}

/** `nook decision list --json`：同一份 shape，但陣列——沿用 `renderJson` 對
 * Issue 清單的既有形狀（鍵排序後的物件陣列，無縮排），不另創一種 JSON shape。 */
function renderDecisionListJson(decisions: readonly Decision[]): string {
  return JSON.stringify(decisions.map(sortDecisionKeys));
}
