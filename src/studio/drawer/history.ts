/**
 * 「一列變更歷史要顯示什麼」的可判定規則 —— 純函式，不碰 DOM、不 import React。
 *
 * 同 `changes.ts` 與 `board/path.ts`：票 B7 本身是版面，沒有自動化測試
 * （spec.md 的測試策略），所以能推進純函式的就不留在組件裡。
 */

// 型別在打包時整條被抹掉，所以 server 不會出現在 studio 的 bundle 裡 ——
// 同 `api.ts` 的規則（ADR-0008）。
import type { WriteView } from '@/api';

/** 一列歷史 —— 欄位 · 值 · actor · `t`，與 CLI 的 `nook history` 同一份資訊。 */
export interface HistoryRow {
  readonly field: WriteView['field'];
  /**
   * 那一次寫入的值，**原文**。markdown 不在這裡渲染（ADR-0008：前端不得有第二份
   * 渲染器），而歷史要看的本來就是原文本身。
   */
  readonly text: string;
  /**
   * 收起來時顯示的那一段。**等於 `text` 就表示這一列不必展開** —— 組件據此決定
   * 要不要給展開鍵，不必自己再數一次字。
   */
  readonly preview: string;
  readonly actor: string;
  /** per-issue 的 lamport clock，不是牆上時鐘 —— 同 `CommentTimeline` 的註記。 */
  readonly t: number;
}

/**
 * `GET /api/history/<ref>` 的 `writes` 翻成畫面上的列，**由新到舊**。
 *
 * **反轉，不重排。** `board.opLog()` 交出來的已經是 `orderOps` 的全序（由舊到新，
 * board.ts:113），而全序只有一份。在這裡放第二個比較器就是第二個真相 ——
 * commit 463343d 那個 bug 就是這樣來的，`CommentTimeline` 上面同一句話的由來也是。
 */
export function historyRows(writes: readonly WriteView[]): readonly HistoryRow[] {
  return writes
    .map((w) => {
      const text = valueText(w.value);
      return { field: w.field, text, preview: previewOf(text), actor: w.actor, t: w.t };
    })
    .reverse();
}

/**
 * `archived` 與 `deleted` 的值是 boolean，而 React 把 `false` 渲染成**什麼都沒有**。
 * 誤刪救生索上最重要的那兩列（`deleted true` 與復原的 `deleted false`）因此會變成
 * 一列空白 —— 看起來像那一次寫入沒有值。
 */
function valueText(value: string | boolean): string {
  return typeof value === 'string' ? value : String(value);
}

/**
 * 收起來的那一段的上限。`description` 的舊值可能是整篇 markdown，而這個面板是
 * 「出事才來看」的東西 —— 一列攤開整篇會讓它變成 drawer 上最大的那一塊。
 */
export const PREVIEW_LIMIT = 160;

/**
 * 收起來時顯示的那一段；沒有東西要收就原樣交出去（`preview === text`）。
 *
 * **兩條上限，第一行也是一條。** 字數擋不住五行、每行十個字的 description ——
 * 那種值遠低於字數上限，攤開卻是五列高，而「一列一次寫入」是這個面板的形狀。
 */
function previewOf(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? '';
  const head = firstLine.slice(0, PREVIEW_LIMIT);
  return head === text ? text : `${head}…`;
}
