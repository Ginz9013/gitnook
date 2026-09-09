/**
 * Drawer 的樂觀編輯模型 —— 純函式，不碰 DOM、不 import React。
 *
 * 為什麼不是 `reconcile.ts`：那個模組回答的是「這張卡片現在在哪一欄」，
 * 它的 `PendingWrite.value` 是一個 status 字串。Drawer 要樂觀更新的東西
 * 不是同一個形狀 —— label 是集合、留言是只增不減的時間軸 —— 塞不進
 * `ReconcileIssue { id, status }`。而 `reconcile.ts` 屬於票 02，本票不得改。
 *
 * 四條規則仍然照抄，因為壞掉的情況是同一批：
 *
 * 1. 飛行中的變更蓋過快照 —— 否則輪詢帶回舊快照時欄位彈回去再彈回來
 * 2. 同一個欄位只認最後一筆 —— pending 依 seq 遞增套用，晚的蓋過早的
 * 3. （拖曳押後與 drawer 無關）
 * 4. ACK 帶的是寫入當下摺疊出來的值，不是永恆真理 —— 所以 ACK 拿伺服器
 *    回的整張 `IssueView` 蓋進快照，而不是把樂觀值扶正
 */

// 型別在打包時整條被抹掉，所以 core 不會出現在 studio 的 bundle 裡 ——
// 同 `api.ts` 對 server 的規則，這裡對 core 也只能是 `import type`。
import type { Change, Status } from '../../core/types.js';
import type { IssueView } from '@/api';

/**
 * Drawer 送得出去的 Change。`status` 收窄成完整的 `Status`：core 也收無歧義
 * 前綴，但選單裡挑出來的永遠是完整值，收窄讓樂觀投影不必再斷言一次。
 *
 * 這個型別可以指派給 `Change`，因此 `POST /i/<ref>` 的 body 一定是 Change 的
 * 形狀 —— 票 03 對不認得的欄位回 400 而不是忽略，多送一個鍵就是一次 400。
 */
export type DrawerChange = Omit<Change, 'status'> & { readonly status?: Status };

/** 一筆已經反映在畫面上、但還沒被伺服器回應確認的編輯。 */
export interface PendingEdit {
  readonly seq: number;
  readonly change: DrawerChange;
}

export interface EditState {
  /** 最後一次從 server 拿到的這張 issue（初始快照、輪詢，或某次寫入的回應）。 */
  readonly snapshot: IssueView;
  /** 樂觀編輯，依 seq 遞增排列。 */
  readonly pending: readonly PendingEdit[];
}

export type EditAction =
  /** seq 由呼叫端配發（單調遞增）—— 它要拿著同一個 seq 回來 ACK 或 FAIL。 */
  | { readonly type: 'EDIT'; readonly seq: number; readonly change: DrawerChange }
  | { readonly type: 'ACK'; readonly seq: number; readonly issue: IssueView }
  | { readonly type: 'FAIL'; readonly seq: number }
  | { readonly type: 'POLL'; readonly issue: IssueView };

export function initialEdits(issue: IssueView): EditState {
  return { snapshot: issue, pending: [] };
}

export function editReduce(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'EDIT':
      // 樂觀更新：畫面先動，POST 之後才送。
      return { ...state, pending: [...state.pending, { seq: action.seq, change: action.change }] };

    case 'ACK':
      // 伺服器回的是「寫入當下摺疊出來的整張 issue」——不是永恆真理：在這個
      // 回應飛回來的路上，agent 的 op 還是可能後來居上。樂觀值退場，改用它
      // 當新快照；下一次輪詢仍可以蓋過它。
      return {
        pending: state.pending.filter((p) => p.seq !== action.seq),
        snapshot: action.issue,
      };

    case 'FAIL':
      // 傳輸失敗（server 收掉了、board 目錄不見了）。這是唯一真正要回滾的
      // 情況：樂觀值退場，快照不動，欄位回到伺服器上的值。
      return { ...state, pending: state.pending.filter((p) => p.seq !== action.seq) };

    case 'POLL':
      // 只換快照、絕不動 pending —— 飛行中的編輯蓋過快照那條規則由
      // projectEdits() 負責。
      return { ...state, snapshot: action.issue };
  }
}

/** 有樂觀值覆蓋著的欄位。`descriptionHtml` 對它們是過期的 —— 見下。 */
export type OptimisticField = 'title' | 'description' | 'status' | 'labels' | 'archived';

/** 還沒被伺服器確認的留言。只有原文 —— 前端不得自己把 markdown 渲染成 HTML。 */
export interface UnconfirmedComment {
  readonly seq: number;
  readonly body: string;
}

export interface ProjectedIssue {
  /**
   * 快照 + 樂觀覆蓋後、畫面該顯示的值。
   *
   * **`descriptionHtml` 與 `comments[].bodyHtml` 一律原封不動**：那兩個字串
   * 是 server 用「先逸出、再構造」產出的，前端沒有（也不該有）第二份 markdown
   * 渲染器。因此描述有樂觀值時，`description` 是新原文而 `descriptionHtml`
   * 還是舊的 —— 呼叫端要用 `optimistic` 判斷該顯示哪一個，見 IssueDetail。
   */
  readonly issue: IssueView;
  readonly optimistic: ReadonlySet<OptimisticField>;
  /**
   * 飛行中的留言。**接在 `issue.comments` 尾端顯示，不併進去、不排序** ——
   * `issue.comments` 已由 core 的 reduce() 以 (t, actor, id) 全序產出，在前端
   * 放第二個比較器正是 commit 463343d 那個 bug 的成因。
   */
  readonly unconfirmed: readonly UnconfirmedComment[];
}

export function projectEdits(state: EditState): ProjectedIssue {
  let issue = state.snapshot;
  const optimistic = new Set<OptimisticField>();
  const unconfirmed: UnconfirmedComment[] = [];

  // 依 seq 遞增套用：同一個欄位上，晚的那一筆蓋過早的。
  for (const { seq, change } of state.pending) {
    if (change.title !== undefined) {
      issue = { ...issue, title: change.title };
      optimistic.add('title');
    }
    if (change.description !== undefined) {
      issue = { ...issue, description: change.description };
      optimistic.add('description');
    }
    if (change.status !== undefined) {
      issue = { ...issue, status: change.status };
      optimistic.add('status');
    }
    if (change.archived !== undefined) {
      issue = { ...issue, archived: change.archived };
      optimistic.add('archived');
    }
    if (change.labels !== undefined) {
      issue = { ...issue, labels: applyLabels(issue.labels, change.labels) };
      optimistic.add('labels');
    }
    if (change.comment !== undefined) unconfirmed.push({ seq, body: change.comment });
  }

  return { issue, optimistic, unconfirmed };
}

/**
 * 樂觀的 label 集合。留下沒被點名移除的、把新增的接在尾端 —— 與 core 的
 * `reduce()` 一致：呈現順序是各值第一個存活 add tag 在全序中的位置，而新
 * 增的那筆 t 最大，所以落在最後。
 */
function applyLabels(
  labels: readonly string[],
  edit: NonNullable<DrawerChange['labels']>,
): readonly string[] {
  const removed = new Set(edit.remove ?? []);
  const kept = labels.filter((l) => !removed.has(l));
  return [...kept, ...(edit.add ?? []).filter((l) => !kept.includes(l))];
}

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

/*
 * 以下是 drawer 的「可判定規則」。每一條都在這裡，組件只負責問「拿到
 * Change 了嗎」——`undefined` 表示這一下不該產生任何 op。
 *
 * 為什麼「沒有變化就不送」很重要：op-log 是 append-only，送出去的每一筆都
 * 永久留在 .ndjson 裡。一個什麼都沒改的 blur 不該在歷史上留下痕跡。
 */

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
