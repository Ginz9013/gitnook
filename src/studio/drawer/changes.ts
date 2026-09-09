/**
 * Drawer 的「可判定規則」—— 純函式，不碰 DOM、不 import React。
 *
 * 每一條都在這裡，組件只負責問「拿到 Change 了嗎」——`undefined` 表示這一下
 * 不該產生任何 op。為什麼「沒有變化就不送」很重要：op-log 是 append-only，
 * 送出去的每一筆都永久留在 .ndjson 裡。一個什麼都沒改的 blur 不該在歷史上
 * 留下痕跡。
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

/**
 * 八個 Status 的顯示順序（ADR-0003：固定，不可自訂）。
 *
 * 用 `Record<Status, number>` 宣告而不是直接寫陣列：少一個或多一個都會在
 * `tsc` 停下來。不從 core 的值層 import `STATUSES`，是為了維持「studio 對
 * core 只有 `import type`」——一個值的 import 就會把 core 拉進 bundle。
 */
const STATUS_INDEX: Readonly<Record<Status, number>> = {
  backlog: 0,
  todo: 1,
  queued: 2,
  in_progress: 3,
  review: 4,
  blocked: 5,
  done: 6,
  cancelled: 7,
};

export const STATUSES: readonly Status[] = (Object.keys(STATUS_INDEX) as Status[]).sort(
  (a, b) => STATUS_INDEX[a] - STATUS_INDEX[b],
);

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
 * 改 status。**`blocked` 必須同時留一則說明原因的 comment**（CONTEXT.md）——
 * 理由沒填就回傳 `undefined`，這一下什麼都不會送出。
 *
 * 兩者放進同一份 Change 而不是兩次 POST：`board.apply()` 對一份 Change 只
 * append 一次，status 與 comment 因此不可能只落地一半。
 *
 * server 端刻意不強制這條（票 03）—— CLI 是提醒而非拒絕，在 server 加一條
 * CLI 沒有的規則會讓兩個介面分歧。配對的責任在這裡。
 */
export function statusChange(
  next: Status,
  current: Status,
  reason: string,
): DrawerChange | undefined {
  if (next === current) return undefined;
  if (next !== 'blocked') return { status: next };
  const comment = reason.trim();
  return comment === '' ? undefined : { status: next, comment };
}

/** 改成這個 status 需要先問原因嗎。 */
export function needsReason(next: Status, current: Status): boolean {
  return next === 'blocked' && next !== current;
}
