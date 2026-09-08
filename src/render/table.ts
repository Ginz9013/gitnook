import type { Comment, Issue } from '../core/types.js';

/** 顯示用短 ID 長度。撞號時由 ref 解析報錯，見 spec.md。 */
const SHORT_ID_LEN = 6;
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

const shortId = (issue: Issue): string => issue.id.slice(0, SHORT_ID_LEN);
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

  const cells = issues.map((issue) => [
    shortId(issue),
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

/** 單張 Issue 的詳情。title 不截斷 —— 讀者正是為了看完整內容才點進來。 */
function renderDetail(issue: Issue): string {
  const header = [shortId(issue), issue.status, issue.title, labelCell(issue)]
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
