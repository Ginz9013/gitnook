import { shortIdLength } from '../core/ids.js';
import { displayWidth } from './width.js';
import type { Comment, Issue } from '../core/types.js';

/** 欄位分隔。ADR-0005 的量測範例即以兩個空白分隔。 */
const GAP = '  ';
/**
 * title 欄的上限，單位是**顯示欄**而非字元。80 欄終端扣掉 id(6)+分隔(2)+
 * 最寬 status `in_progress`(11)+分隔(2)=21，再為 labels 欄留約 11 欄，剩下 48。
 */
const TITLE_MAX = 48;
const ELLIPSIS = '…';
/** 空清單的訊息。輸出一個空表頭比一句話更浪費，也更難讀。 */
const EMPTY = '沒有 issue';

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
  // 欄寬依內容自適應；最後一欄不補寬，且整行去除尾隨空白 —— 尾隨空白是純粹的 token 浪費。
  const widths = [0, 1, 2].map((col) => Math.max(...cells.map((row) => displayWidth(row[col]!))));

  return cells
    .map((row) =>
      row
        .map((cell, col) => (col < widths.length ? pad(cell, widths[col]!) : cell))
        .join(GAP)
        .trimEnd(),
    )
    .join('\n');
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
