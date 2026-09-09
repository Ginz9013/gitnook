import type { Status } from '@/api';
import type { OptimisticField, UnconfirmedComment } from '@/reconcile';

/**
 * 念給 screen reader 聽的字。純函式 —— 它們是這個看板對看不見畫面的人講的
 * 全部內容。兩種：拖曳過程中的即時播報（`announceGrab` 等四個），以及掛在
 * 一張 Issue 上、Tab 過去就聽得到的敘述（`announceIssueState`）。
 *
 * ADR-0008 選 React 的唯一理由是 `@dnd-kit` 的鍵盤拖曳與播報，所以這裡的字不是
 * 裝飾：**看得見的那一套區別必須在這裡同樣講出來**，否則鍵盤與 screen reader
 * 使用者收到的是另一個看板。
 *
 * 反過來也一樣，而這一面現在管得更嚴：**八個 Status 一視同仁（ADR-0010）**。
 * 換欄的措辭是同一個模板，只有 Status 名不同 —— 沒有任何一格有自己的字。
 * `queued` 曾經有（「授權 agent 不再詢問、直接動手」），那是規劃時擅自加上的
 * 解讀；授權語意留在 CLI 與 AGENT.md，看板不替使用者念它。唯一分得出來的兩種
 * 結果是「換了欄」與「沒換」，那講的是這次拖曳，不是某個 Status。
 */

/**
 * 一張 Issue 取得焦點時念的說明（`aria-describedby`，由 @dnd-kit 掛上）。
 *
 * 用字講 Status 而不是「欄位」：看不見畫面的人沒有那八個直排，聽到的是
 * `backlog`、`queued` 這些 Status 值本身，說「欄位」等於多發明一個他們對不上
 * 的東西。上下鍵不做事，而且這裡明講：Nook 的同一個 Status 裡沒有順序
 * （ADR-0003 只定義八個 Status），讓 Issue 上下動會讓人以為自己改變了什麼。
 */
export const dragInstructions =
  '按 Space 抓起這張 Issue，用左右方向鍵在 Status 之間移動，再按一次 Space 放下，Esc 取消。' +
  '按 Enter 開啟細節。同一個 Status 裡沒有順序，上下鍵不會移動 Issue。';

export function announceGrab(title: string, from: Status): string {
  return `抓起「${title}」，目前在 ${from}。用左右方向鍵換 Status。`;
}

export function announceOver(title: string, from: Status, to: Status | null): string {
  if (to === null) return `「${title}」不在任何 Status 上，放開不會移動。`;
  if (to === from) return `「${title}」回到原本的 ${to}。`;
  return `「${title}」停在 ${to}。`;
}

export function announceDrop(title: string, from: Status, to: Status | null): string {
  if (to === null) return `放開「${title}」，沒有放進任何 Status，維持在 ${from}。`;
  if (to === from) return `放回原處，「${title}」仍然在 ${from}。`;
  return `已把「${title}」從 ${from} 移到 ${to}。`;
}

export function announceCancel(title: string, from: Status): string {
  return `取消拖曳，「${title}」仍然在 ${from}。`;
}

/**
 * 一張 Issue 上還沒落地的變更，用字列出來。全部落地就是空陣列。
 *
 * **順序照 `FIELD_ORDER` 而不是集合的迭代順序**：`optimistic` 是
 * `ReadonlySet`，它的順序是「哪個欄位先被覆蓋」，所以同樣的兩個欄位在飛，
 * 先改標題與先搬 Status 會念出不同的句子。同一個狀態必須念出同一句話。
 *
 * `unconfirmed` 也算在內，即使它不進 `optimistic`（留言是附加不是覆蓋，
 * 見 `reconcile.ts`）。使用者要知道的是「這張 Issue 上有東西還沒落地」，
 * 而一則還沒被確認的留言正是那樣的東西。
 */
export function pendingParts(
  optimistic: ReadonlySet<OptimisticField>,
  unconfirmed: readonly UnconfirmedComment[],
): readonly string[] {
  const parts = FIELD_ORDER.filter((f) => optimistic.has(f)).map((f) => FIELD_WORD[f]);
  return unconfirmed.length === 0 ? parts : [...parts, `${unconfirmed.length} 則 Comment`];
}

/** 欄位念出來的名字。Status、Label、Comment 是領域語彙（CONTEXT.md），不翻。 */
const FIELD_WORD: Record<OptimisticField, string> = {
  title: '標題',
  description: '描述',
  status: 'Status',
  labels: 'Label',
  archived: '封存',
};

const FIELD_ORDER: readonly OptimisticField[] = ['status', 'title', 'labels', 'description', 'archived'];

/**
 * 卡片上那一行看得見的字。沒有東西在飛就是 null。
 *
 * 與 `announceIssueState` 同一份 `pendingParts`：看得見的與念出來的講的必須是
 * 同一件事，兩邊各列一次欄位名遲早會分岔成兩個看板。
 */
export function pendingLabel(
  optimistic: ReadonlySet<OptimisticField>,
  unconfirmed: readonly UnconfirmedComment[],
): string | null {
  const parts = pendingParts(optimistic, unconfirmed);
  return parts.length === 0 ? null : `送出中：${parts.join('、')}`;
}

/**
 * 同一張 Issue 的狀態講給看不見畫面的人聽 —— 虛線邊框與 ring 對他們不存在，
 * 而「這張還沒落地」正是拖完之後最需要知道的一件事。
 *
 * 這不是拖曳過程中的即時播報（上面那四個是），而是掛在卡片上的敘述：Tab 到
 * 這張 Issue 就會連著標題一起聽到，時機因此不限於拖曳當下。
 *
 * `held` 也講出來的理由：被抓住的那張在放開之前不接受任何來自伺服器的移動
 * （`reconcile.ts` 的 GRAB）。「畫面停著不動」對指標使用者是自己按著造成的，
 * 對鍵盤使用者則是一個看不出原因的靜止。
 */
export function announceIssueState(
  optimistic: ReadonlySet<OptimisticField>,
  unconfirmed: readonly UnconfirmedComment[],
  held: boolean,
): string | null {
  const parts = pendingParts(optimistic, unconfirmed);
  const said: string[] = [];
  // 欄位名列在冒號後面而不是接在「的變更」前面：`Status`、`Label` 是拉丁字，
  // 直接黏上中文會念成「Status的」。開頭與卡片上那一行同樣是「送出中」。
  if (parts.length > 0) said.push(`送出中，還沒有得到伺服器確認的變更：${parts.join('、')}。`);
  if (held) said.push('這張 Issue 正被抓著，放開之前伺服器的更新不會套用到它。');
  return said.length === 0 ? null : said.join('');
}
