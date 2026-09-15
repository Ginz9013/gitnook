import { shortIdLength } from '../core/ids.js';
import { displayWidth } from './width.js';
import type { SetOp } from '../core/ops.js';
import type { Comment, Issue } from '../core/types.js';
import type { Decision } from '../core/decisionTypes.js';
import type { DecisionSetOp } from '../core/decisionOps.js';

/** 欄位分隔。ADR-0005 的量測範例即以兩個空白分隔。 */
const GAP = '  ';
/**
 * title 欄的上限，單位是**顯示欄**而非字元。80 欄終端扣掉 id(6)+分隔(2)+
 * 最寬 status `in_progress`(11)+分隔(2)=21，再為 labels 欄留約 11 欄，剩下 48。
 */
const TITLE_MAX = 48;
const ELLIPSIS = '…';
/** 空清單的訊息。輸出一個空表頭比一句話更浪費，也更難讀。 */
const EMPTY = 'no issues';
/** 同上，但問的是一張 Issue 的 Op-log。 */
const EMPTY_OPS = 'no set ops';
/** 同 EMPTY，但問的是空的 Decision Log —— 剛 init、還沒 new 過任何一篇。 */
const EMPTY_DECISIONS = 'no decisions';

/**
 * 短 ID 的長度由呼叫端算好後傳進來 —— 長度是「整批的性質」，單張 Issue
 * 看不出來。長度邏輯只有 core 的 shortIdLength 一份，此處不得再算一次：
 * 兩個渲染器各留一份比較器正是 comment 排序分歧的成因（commit 463343d）。
 */
const shortId = (issue: Issue, len: number): string => issue.id.slice(0, len);
const labelCell = (issue: Issue): string =>
  issue.labels.length === 0 ? '' : `[${issue.labels.join(',')}]`;

/**
 * 以顯示欄寬截斷，不以字元數截斷。全形字放不進剩餘欄寬時整個不放 ——
 * 切半個字元會產生亂碼，而寧可少一欄也不要多一欄。
 */
function truncate(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;

  const budget = max - displayWidth(ELLIPSIS);
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = displayWidth(ch);
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  return out + ELLIPSIS;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(width - displayWidth(text));
}

/**
 * 欄寬依內容自適應；最後一欄不補寬，且整行去除尾隨空白 —— 尾隨空白是純粹的
 * token 浪費（ADR-0005）。這是本檔兩張表格共用的版面規則，只有一份。
 */
function grid(rows: readonly (readonly string[])[]): string[] {
  // 呼叫端都先擋掉空清單（各有自己的訊息），所以這裡一定有第一列可以定欄數。
  const last = rows[0]!.length - 1;
  const widths = rows[0]!.map((_, col) =>
    col === last ? 0 : Math.max(...rows.map((row) => displayWidth(row[col]!))),
  );
  return rows.map((row) =>
    row
      .map((cell, col) => (col === last ? cell : pad(cell, widths[col]!)))
      .join(GAP)
      .trimEnd(),
  );
}

/** 清單的緊湊表格 —— ADR-0005 的量測對象。 */
function renderList(issues: readonly Issue[], given: number | undefined): string {
  if (issues.length === 0) return EMPTY;

  // 這批 Issue 彼此無歧義所需的長度。盲取 6 碼會讓兩張前綴相同的 Issue
  // 顯示成同一個短 ID，而短 ID 正是使用者接著要拿來當 Ref 用的東西。
  //
  // 呼叫端知道得更多時由它決定：回印單張的 CLI 路徑手上只有一個單元素陣列，
  // 而「一張 Issue 跟自己不會撞號」會讓這裡算出下限 6 —— 那個 6 碼前綴在
  // 整個 Board 上可能對應到幾十張 Issue。
  const len = given ?? shortIdLength(issues.map((i) => i.id));

  const cells = issues.map((issue) => [
    shortId(issue, len),
    issue.status,
    truncate(issue.title, TITLE_MAX),
    labelCell(issue),
  ]);

  return grid(cells).join('\n');
}

// 不重排：Issue.comments 已由 reduce() 以 (t, a, id) 全序產出。
// 在此複製一份比較器只會與 core 分歧 —— 排序是 core 的責任。
const timeline = (comments: readonly Comment[]): string =>
  comments.map((c) => `- ${c.actor}${GAP}${c.body}`).join('\n');

/**
 * 單張 Issue 的詳情。title 不截斷 —— 讀者正是為了看完整內容才點進來。
 *
 * 呼叫端沒給長度時一律顯示 SHORT_ID_MIN 碼：這裡只拿得到一張 Issue，無從
 * 得知整批的情況，因此不可能自行算出「幾碼才無歧義」。刻意不改成顯示完整
 * 識別碼 —— 詳情是 `show` 的輸出，而使用者手上已經有那個 Ref 了（他正是用
 * 它叫出這張 Issue 的）。算得出整批長度的呼叫端可以把它傳進來覆寫；`show`
 * 刻意不傳，理由見 src/cli/run.ts 的 cmdShow。
 */
function renderDetail(issue: Issue, given: number | undefined): string {
  // 一張 Issue 自己跟自己永遠不會撞號，故 shortIdLength 回傳的就是下限。
  const len = given ?? shortIdLength([issue.id]);
  const header = [shortId(issue, len), issue.status, issue.title, labelCell(issue)]
    .join(GAP)
    .trimEnd();

  // 空的區塊整個略去 —— 空白行既無資訊也佔 token。
  return [header, issue.description, timeline(issue.comments)]
    .filter((block) => block !== '')
    .join('\n\n');
}

/**
 * `shortIdLen` 是「顯示這批 Issue 要幾碼才無歧義」。省略時由手上這幾張推得 ——
 * 但只有呼叫端知道「這批」實際上是哪一批，見 renderList 的註解。
 */
export function renderTable(issues: readonly Issue[], shortIdLen?: number): string;
export function renderTable(issue: Issue, shortIdLen?: number): string;
export function renderTable(input: readonly Issue[] | Issue, shortIdLen?: number): string {
  return Array.isArray(input)
    ? renderList(input, shortIdLen)
    : renderDetail(input as Issue, shortIdLen);
}

const shortDecisionId = (decision: Decision, len: number): string => decision.id.slice(0, len);

/**
 * `nook decision list` 的緊湊表格：ref/title/disposition —— 票 02
 * spec.md 的 Outcome。短 ID／無歧義前綴顯示規則沿用 `shortIdLength`（呼叫端
 * 算好整個 Decision Log 的長度後傳進來，理由同 `renderList` 上的既有註解，
 * 這裡不重寫比較器）。title 截斷沿用同一份 `truncate`/`TITLE_MAX`，理由同
 * Issue 的清單：這是「緊湊表格」的既有版面慣例，只有一份實作。
 */
export function renderDecisionTable(decisions: readonly Decision[], shortIdLen?: number): string {
  if (decisions.length === 0) return EMPTY_DECISIONS;

  const len = shortIdLen ?? shortIdLength(decisions.map((d) => d.id));

  const cells = decisions.map((decision) => [
    shortDecisionId(decision, len),
    truncate(decision.title, TITLE_MAX),
    decision.disposition,
  ]);

  return grid(cells).join('\n');
}

/**
 * 單張 Decision 的 detail 版面 —— 比照 Issue 既有 `renderDetail` 的節奏：
 * header 一行（shortId／disposition／title）＋空行＋`body`（不截斷，理由同
 * Issue 的 description：這是唯一拿得回完整內容的地方）＋`supersededBy`
 * （有值才印）。**不是**逐欄 key:value 傾印 —— 那是票 08 review 判定要換掉
 * 的舊版面（見票 08 spec.md 的「從哪來」）。
 *
 * `shortIdLen` 省略時比照 `renderDetail`：對這一張自己算，永遠得到
 * `SHORT_ID_MIN`——單張 Decision 跟自己不會撞號，算不出「這批」要幾碼。
 */
export function renderDecisionDetail(decision: Decision, shortIdLen?: number): string {
  const len = shortIdLen ?? shortIdLength([decision.id]);
  const header = [shortDecisionId(decision, len), decision.disposition, decision.title]
    .join(GAP)
    .trimEnd();

  const supersededBy =
    decision.supersededBy === undefined ? '' : `supersededBy: ${decision.supersededBy}`;

  // 空的區塊整個略去 —— 同 renderDetail 的既有規則：空白行既無資訊也佔 token。
  return [header, decision.body, supersededBy].filter((block) => block !== '').join('\n\n');
}

/**
 * 一個成員 Board 分組後要印的份量：來源路徑（相對於 workspace 根目錄）、
 * 篩選後的 issue 清單、以及**這個成員自己**的短 ID 顯示長度 —— 每個成員
 * 完全維持自己的獨立性（CONTEXT.md 的 Workspace 詞條），不跨成員合算長度。
 */
export interface WorkspaceGroup {
  readonly path: string;
  readonly issues: readonly Issue[];
  readonly shortIdLen: number;
}

/**
 * 依來源路徑分組印出，組合既有 `renderTable`，不重新發明表格版面。
 *
 * 篩選後一張都沒有的成員整組不列出（不印一個空表頭）；全部成員都是空的
 * 才印一句彙整版的 `EMPTY`，不是逐組重複同一句話。
 */
export function renderWorkspaceList(groups: readonly WorkspaceGroup[]): string {
  const nonEmpty = groups.filter((g) => g.issues.length > 0);
  if (nonEmpty.length === 0) return EMPTY;

  return nonEmpty
    .map((g) => `${g.path}\n${renderTable(g.issues, g.shortIdLen)}`)
    .join('\n\n');
}

/**
 * 一張 Issue 的 Op-log 中的 set Op：誰、在哪個 lamport `t`、把哪個欄位寫成什麼。
 *
 * 不重排 —— 傳進來的順序就是 core 的 (t, a, id) 全序（`Board.opLog`）。在此
 * 複製一份比較器只會與 core 分歧，同 timeline 的理由（commit 463343d）。
 *
 * 值**不截斷**：這張表存在的理由就是把被 LWW 蓋掉的那份 description 原封不動
 * 交回讀者手上，截斷等於沒救回來。description 因此常常是多行的，而多行的值
 * 塞不進一列 —— 只要有一個值含換行，就整份改成「表頭一行、值另起、區塊間空
 * 一行」。全部一起換而不是逐列決定：讀者要能一眼看出一個值在哪裡結束，而那
 * 取決於整份輸出的形狀，不是單一列的。
 */
export function renderSetOps(ops: readonly SetOp[]): string {
  if (ops.length === 0) return EMPTY_OPS;

  const values = ops.map((op) => String(op.v));
  const head = ops.map((op) => [String(op.t), op.a, op.k]);

  if (values.some((v) => v.includes('\n'))) {
    return grid(head)
      .map((row, i) => `${row}\n${values[i]!}`)
      .join('\n\n');
  }
  return grid(head.map((row, i) => [...row, values[i]!])).join('\n');
}

/**
 * 一張 Decision 的 Op-log 中的 set op：誰、在哪個 lamport `t`、把哪個欄位寫成
 * 什麼 —— 票 04，`nook decision history` 的呈現。同 `renderSetOps` 的版面
 * 規則（不截斷、多行值整份改版面），但**不重用**它：那個函式的簽章釘死在
 * Issue 的 `SetOp`，這裡另起一份換上 `DecisionSetOp`，共用的只有底下的
 * `grid`/`EMPTY_OPS`。
 *
 * 不重排：傳進來的順序就是 core 的 `decisionFieldWrites()` 已經摺好的全序
 * （`DecisionLog.opLog()` 內部呼叫 `oplog.ts` 的 `orderOps`）——排序沿用
 * 那一份，這裡與 `renderSetOps` 都不再各寫一份比較器（spec.md 明講這正是
 * commit 463343d 那個 bug 的成因）。
 */
export function renderDecisionSetOps(ops: readonly DecisionSetOp[]): string {
  if (ops.length === 0) return EMPTY_OPS;

  const values = ops.map((op) => op.v);
  const head = ops.map((op) => [String(op.t), op.a, op.k]);

  if (values.some((v) => v.includes('\n'))) {
    return grid(head)
      .map((row, i) => `${row}\n${values[i]!}`)
      .join('\n\n');
  }
  return grid(head.map((row, i) => [...row, values[i]!])).join('\n');
}
