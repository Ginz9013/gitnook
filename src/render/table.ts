import { shortIdLength } from '../core/ids.js';
import type { Comment, Issue } from '../core/types.js';

/** 欄位分隔。ADR-0005 的量測範例即以兩個空白分隔。 */
const GAP = '  ';
/**
 * title 欄的上限。80 欄終端扣掉 id(6)+分隔(2)+最寬 status `in_progress`(11)+分隔(2)=21，
 * 再為 labels 欄留約 11 欄，剩下 48。
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - ELLIPSIS.length) + ELLIPSIS;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(width - text.length);
}

/** 清單的緊湊表格 —— ADR-0005 的量測對象。 */
function renderList(issues: readonly Issue[]): string {
  if (issues.length === 0) return EMPTY;

  // 這批 Issue 彼此無歧義所需的長度。盲取 6 碼會讓兩張前綴相同的 Issue
  // 顯示成同一個短 ID，而短 ID 正是使用者接著要拿來當 Ref 用的東西。
  const len = shortIdLength(issues.map((i) => i.id));

  const cells = issues.map((issue) => [
    shortId(issue, len),
    issue.status,
    truncate(issue.title, TITLE_MAX),
    labelCell(issue),
  ]);
  // 欄寬依內容自適應；最後一欄不補寬，且整行去除尾隨空白 —— 尾隨空白是純粹的 token 浪費。
  const widths = [0, 1, 2].map((col) => Math.max(...cells.map((row) => row[col]!.length)));

  return cells
    .map((row) =>
      row
        .map((cell, col) => (col < widths.length ? pad(cell, widths[col]!) : cell))
        .join(GAP)
        .trimEnd(),
    )
    .join('\n');
}

const timeline = (comments: readonly Comment[]): string =>
  [...comments]
    .sort((a, b) => a.t - b.t)
    .map((c) => `- ${c.actor}${GAP}${c.body}`)
    .join('\n');

/**
 * 單張 Issue 的詳情。title 不截斷 —— 讀者正是為了看完整內容才點進來。
 *
 * 短 ID 一律顯示 SHORT_ID_MIN 碼：這裡只拿得到一張 Issue，無從得知整批的
 * 情況，因此不可能算出「幾碼才無歧義」。刻意不改成顯示完整識別碼 ——
 * 詳情是 `show` 的輸出，而使用者手上已經有那個 Ref 了（他正是用它叫出這
 * 張 Issue 的）。需要保證無歧義的 Ref 時看 `list`，那裡才知道整批。
 */
function renderDetail(issue: Issue): string {
  // 一張 Issue 自己跟自己永遠不會撞號，故 shortIdLength 回傳的就是下限。
  const len = shortIdLength([issue.id]);
  const header = [shortId(issue, len), issue.status, issue.title, labelCell(issue)]
    .join(GAP)
    .trimEnd();

  // 空的區塊整個略去 —— 空白行既無資訊也佔 token。
  return [header, issue.description, timeline(issue.comments)]
    .filter((block) => block !== '')
    .join('\n\n');
}

export function renderTable(issues: readonly Issue[]): string;
export function renderTable(issue: Issue): string;
export function renderTable(input: readonly Issue[] | Issue): string {
  return Array.isArray(input) ? renderList(input) : renderDetail(input as Issue);
}
