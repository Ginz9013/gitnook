import type { Status } from '@/api';
import { needsReason } from '@/drawer/changes';
import { STATUS_ORDER } from '@/statuses';

/**
 * 看板上可判定的規則全部在這裡 —— 純函式、不 import React、不碰 DOM。
 *
 * 組件不做判斷：它們只把事件翻成這裡的答案，再翻成 `BoardProps` 上的 action。
 * 這一片段沒有自動化測試（spec.md 的測試策略），所以「值得測試的判斷」不能
 * 散在 JSX 裡 —— 集中在一個純模組至少讓它讀得完、看得出來對不對。
 *
 * 八個 Status 的清單不在這裡，在 `@/statuses`：drawer 的選單也要同一份，
 * 而它不該為了那八個字串去 import 看板的規則。
 */

/**
 * Status 序列被切成兩段（CONTEXT.md）：`backlog` 與 `todo` 是人的車道，
 * `queued` 之後是 agent 的車道。這條線是 Board 上最重要的分界。
 *
 * **不轉出去。** 這個模組交出去的是 `opensLane`（分界畫在哪），不是「這格
 * 屬於誰」—— 沒有呼叫端需要後者，而轉出一個沒人要的判斷只會讓下一個人以為
 * 該拿它再判一次。
 */
type Lane = 'human' | 'agent';

const LANE_OF: Record<Status, Lane> = {
  backlog: 'human',
  todo: 'human',
  queued: 'agent',
  in_progress: 'agent',
  review: 'agent',
  blocked: 'agent',
  done: 'agent',
  cancelled: 'agent',
};

/**
 * 一個 Status 加上「它前面要不要畫那條交接線」。
 *
 * **刻意不帶 `lane` 本身。** 車道是 `LANE_OF` 的私事：看板要畫的是**分界**，
 * 而分界只出現在車道換手的那一格。把 `lane` 也放進來，等於邀請呼叫端各自
 * 再判一次「這格屬於誰」，而那個判斷已經在 `opensLane` 裡算完了。
 */
export interface StatusLane {
  readonly status: Status;
  /** 這是不是 agent 車道的第一個 Status —— 車道之間那條線畫在它左邊。 */
  readonly opensLane: boolean;
}

/** 八個 Status 依固定順序。看板照這個順序由左到右畫。 */
export const STATUS_LANES: readonly StatusLane[] = STATUS_ORDER.map((status, i) => ({
  status,
  opensLane: i > 0 && LANE_OF[status] !== LANE_OF[STATUS_ORDER[i - 1] as Status],
}));

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LANE_OF, value);
}

/**
 * 一次拖曳放下去會發生什麼事。**這是本片段唯一真正的判斷**，組件只負責分派。
 *
 * - `authorize` —— 進 `queued`。那不只是換一個 Status：它表示需求已釐清，**已授權
 *   agent 不再詢問、直接動手**（CONTEXT.md）。因此它不能跟 `todo → in_progress`
 *   長得一樣，也不能只用顏色講 —— 播報的字也要不一樣，否則鍵盤使用者收不到。
 * - `needs-reason` —— 進 `blocked`。ADR-0003 要求同時留下說明卡住原因的 Comment，
 *   所以放下的當下就要問，不能讓人拖完才發現。**這一條不在這裡判斷**：判斷式
 *   只有一份，在 `drawer/changes.ts` 的 `needsReason`，這裡問它。原本兩邊各寫
 *   一次 `to === 'blocked'`，而兩份的行為分歧過 —— drawer 那一份沒有理由就不
 *   送出，看板這一份只是把對話框叫出來然後照樣移動。同一條領域規則寫兩次的
 *   代價從來不是重複，是兩份會分頭演化。
 */
export type DropEffect = 'none' | 'move' | 'authorize' | 'needs-reason';

export function dropEffect(from: Status, to: Status): DropEffect {
  if (from === to) return 'none';
  if (to === 'queued') return 'authorize';
  if (needsReason(to, from)) return 'needs-reason';
  return 'move';
}

/**
 * 每個 Status 各自的 Issue。沒有 Issue 的 Status 也要在 map 裡，否則它會從畫面上消失。
 *
 * Status 用 `statusOf` 取而不是直接讀 `item.status`：看板拿的是 `project()` 的
 * 投影，而投影把 Issue 包了一層（Status 在 `shown` 裡）。用取值函式而不是要求
 * 呼叫端先攤平成 `IssueView[]`——攤平就是把 `optimistic` 與 `held` 丟掉，那正是
 * 這一版要停止做的事。
 */
export function groupByStatus<T>(
  items: readonly T[],
  statusOf: (item: T) => Status,
): ReadonlyMap<Status, readonly T[]> {
  const groups = new Map<Status, T[]>(STATUS_ORDER.map((s) => [s, []]));
  for (const item of items) groups.get(statusOf(item))?.push(item);
  return groups;
}
