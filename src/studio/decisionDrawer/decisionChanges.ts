/**
 * 「一次編輯送不送得出去」的可判定規則 —— Decision 版，逐一比照
 * `drawer/changes.ts` 的既有節奏：純函式，不碰 DOM、不 import React，
 * 「沒有變化就回 `undefined`」。理由與那邊完全一樣：op-log 是 append-only，
 * 一個什麼都沒改的 blur 不該在歷史上留下痕跡。
 *
 * **只有四個函式**，因為 drawer 只能改這四個欄位（spec.md Outcome）：
 * `legacyRef` 唯讀（spec.md Non-goals，同 CLI 的 `set` 不曝露它的理由），
 * 不在這裡出現，也不在下面 `DecisionDrawerChange` 收得的鍵裡。
 *
 * **`disposition` 沒有任何值需要「選到就先問原因」的特例。** `drawer/changes.ts`
 * 的 `statusChange` 已經拿掉這條規則了（ADR-0003），而 Disposition 從來就沒有
 * 過這種東西 —— 四個值一視同仁。
 */

// 型別在打包時整條被抹掉，所以 core 不會出現在 studio 的 bundle 裡 ——
// 同 `drawer/changes.ts` 對 core 的既有規則。
import type { DecisionChange, Disposition } from '@/api';

/**
 * Drawer 送得出去的 Decision Change。`disposition` 收窄成完整的 `Disposition`：
 * core 也收無歧義前綴，但選單裡挑出來的永遠是完整值，收窄讓呼叫端不必再斷言
 * 一次 —— 同 `DrawerChange` 對 `Status` 的既有收斂關係。
 *
 * 這個型別可以指派給 `DecisionChange`，因此 `POST /d/<ref>` 的 body 一定是
 * DecisionChange 的形狀 —— 對不認得的欄位回 400 而不是忽略，多送一個鍵就是
 * 一次失敗的寫入。
 */
export type DecisionDrawerChange = Omit<DecisionChange, 'disposition'> & {
  readonly disposition?: Disposition;
};

export function titleChange(next: string, current: string): DecisionDrawerChange | undefined {
  const title = next.trim();
  // 空標題不是一次編輯，是一次誤觸 —— 同 `drawer/changes.ts` 的 titleChange：
  // Decision 一定有標題（create op 帶著它）。
  return title === '' || title === current ? undefined : { title };
}

export function bodyChange(next: string, current: string): DecisionDrawerChange | undefined {
  // 不 trim：markdown 的縮排與尾端空行是內容的一部分 —— 同 `descriptionChange`
  // 對 markdown 的既有態度（`drawer/changes.ts`）。
  return next === current ? undefined : { body: next };
}

/**
 * 改 disposition。四個值一視同仁 —— 沒有變化就不送，其餘什麼都不判斷。
 * 見本檔頂端關於「沒有特例」的說明。
 */
export function dispositionChange(
  next: Disposition,
  current: Disposition,
): DecisionDrawerChange | undefined {
  return next === current ? undefined : { disposition: next };
}

/**
 * 改 supersededBy。**不 trim，也不解析、不驗證存在** —— 純文字輸入
 * （spec.md Non-goals），理由同 `bodyChange`：這是一段文字內容，不是一個
 * 要正規化的識別碼。存進去的錯字要靠人自己發現，這是接受的取捨，不是
 * 這裡的缺口。
 */
export function supersededByChange(next: string, current: string): DecisionDrawerChange | undefined {
  return next === current ? undefined : { supersededBy: next };
}
