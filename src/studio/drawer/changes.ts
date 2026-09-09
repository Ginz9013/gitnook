/**
 * 「一次編輯送不送得出去」的可判定規則 —— 純函式，不碰 DOM、不 import React。
 *
 * 每一條都在這裡，組件只負責問「拿到 Change 了嗎」——`undefined` 表示這一下
 * 不該產生任何 op。為什麼「沒有變化就不送」很重要：op-log 是 append-only，
 * 送出去的每一筆都永久留在 .ndjson 裡。一個什麼都沒改的 blur 不該在歷史上
 * 留下痕跡。
 *
 * **這裡只剩「有沒有變化」這一類的判斷。** 曾經還有一條領域規則住在這裡
 * （`needsReason`：改成 `blocked` 要先問卡住的原因），`board/lanes.ts` 的
 * `dropEffect` 也 import 它。那條規則整條拿掉了（ADR-0003 已改寫）——
 * `blocked` 就只是一個 Status，狀態不該帶有額外效果，所以 drawer 與看板
 * 對它沒有任何要對齊的東西。
 *
 * **樂觀模型不在這裡。** 這個檔案的前身 `pending.ts` 另外帶著一份 drawer 專用
 * 的 pending reducer；票 10 把 `reconcile.ts` 擴成 Change 的形狀之後，那一份就
 * 是同一個模型的第二份實作 —— 兩份樂觀模型會分歧，所以只留 `reconcile.ts`
 * 那一份，由 `App.tsx` 統一持有（票 12）。
 */

// 型別在打包時整條被抹掉，所以 core 不會出現在 studio 的 bundle 裡 ——
// 同 `api.ts` 對 server 的規則，這裡對 core 也只能是 `import type`。
import type { Change, Status } from '@/api';

/**
 * Drawer 送得出去的 Change。`status` 收窄成完整的 `Status`：core 也收無歧義
 * 前綴，但選單裡挑出來的永遠是完整值，收窄讓呼叫端不必再斷言一次。
 *
 * 這個型別可以指派給 `Change`，因此 `POST /i/<ref>` 的 body 一定是 Change 的
 * 形狀 —— 票 03 對不認得的欄位回 400 而不是忽略，多送一個鍵就是一次 400。
 */
export type DrawerChange = Omit<Change, 'status'> & { readonly status?: Status };

export function titleChange(next: string, current: string): DrawerChange | undefined {
  const title = next.trim();
  // 空標題不是一次編輯，是一次誤觸 —— issue 一定有標題（create op 帶著它）。
  return title === '' || title === current ? undefined : { title };
}

export function descriptionChange(next: string, current: string): DrawerChange | undefined {
  // description 不 trim：markdown 的縮排與尾端空行是內容的一部分。
  return next === current ? undefined : { description: next };
}

export function commentChange(body: string): DrawerChange | undefined {
  const comment = body.trim();
  return comment === '' ? undefined : { comment };
}

export function addLabelChange(
  label: string,
  current: readonly string[],
): DrawerChange | undefined {
  const v = label.trim();
  return v === '' || current.includes(v) ? undefined : { labels: { add: [v] } };
}

export function removeLabelChange(label: string): DrawerChange {
  return { labels: { remove: [label] } };
}

/**
 * 改 status。八個 Status 一視同仁 —— 沒有變化就不送，其餘什麼都不判斷。
 *
 * 曾經有第三個參數 `reason`：改成 `blocked` 要同時帶一則說明原因的 comment，
 * 沒填就回 `undefined`。那條規則拿掉了（ADR-0003 已改寫），於是 CLI、server
 * 與 studio 三邊對 `blocked` 又是同一套行為 —— 分歧原本就是只有 studio 擋、
 * CLI 只提醒、server 完全不管造成的。
 */
export function statusChange(next: Status, current: Status): DrawerChange | undefined {
  return next === current ? undefined : { status: next };
}
