import type { Status } from '@/api';

/**
 * 看板上可判定的規則全部在這裡 —— 純函式、不 import React、不碰 DOM。
 *
 * 組件不做判斷：它們只把事件翻成這裡的答案，再翻成 `BoardProps` 上的 action。
 * 這一片段沒有自動化測試（spec.md 的測試策略），所以「值得測試的判斷」不能
 * 散在 JSX 裡 —— 集中在一個純模組至少讓它讀得完、看得出來對不對。
 */

/**
 * Status 序列被切成兩段（CONTEXT.md）：`backlog` 與 `todo` 是人的車道，
 * `queued` 之後是 agent 的車道。這條線是 Board 上最重要的分界。
 */
export type Lane = 'human' | 'agent';

/**
 * 八欄的順序即 `STATUSES`（ADR-0003）。
 *
 * 這裡刻意抄一份而不是 `import { STATUSES } from '../../core/types.js'`：
 * 那會是一個**值**的 import，把 core 拉進 studio 的 bundle，而 studio 對
 * server／core 的 import 一律只能是型別（`api.ts`）。下面的 `_exhaustive`
 * 讓抄寫不會漂開 —— 少一個或多一個 Status 都是型別錯誤。
 */
const ORDER = [
  'backlog',
  'todo',
  'queued',
  'in_progress',
  'review',
  'blocked',
  'done',
  'cancelled',
] as const;

type Missing = Exclude<Status, (typeof ORDER)[number]>;
type Extra = Exclude<(typeof ORDER)[number], Status>;
/** 八欄必須恰好等於八個 Status。不相等時這一行編不過。 */
const _exhaustive: [Missing | Extra] extends [never] ? true : ['欄位與 Status 不一致'] = true;
void _exhaustive;

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

export interface ColumnDef {
  readonly status: Status;
  readonly lane: Lane;
  /** 這一欄是不是 agent 車道的第一欄 —— 車道之間那條線畫在它左邊。 */
  readonly opensLane: boolean;
}

export const COLUMNS: readonly ColumnDef[] = ORDER.map((status, i) => ({
  status,
  lane: LANE_OF[status],
  opensLane: i > 0 && LANE_OF[status] !== LANE_OF[ORDER[i - 1] as Status],
}));

export function laneOf(status: Status): Lane {
  return LANE_OF[status];
}

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LANE_OF, value);
}

/**
 * 一次拖曳放下去會發生什麼事。**這是本片段唯一真正的判斷**，組件只負責分派。
 *
 * - `authorize` —— 進 `queued`。那不只是換一欄：它表示需求已釐清，**已授權
 *   agent 不再詢問、直接動手**（CONTEXT.md）。因此它不能跟 `todo → in_progress`
 *   長得一樣，也不能只用顏色講 —— 播報的字也要不一樣，否則鍵盤使用者收不到。
 * - `needs-reason` —— 進 `blocked`。ADR-0003 要求同時留下說明卡住原因的 Comment，
 *   所以放下的當下就要問，不能讓人拖完才發現。
 */
export type DropEffect = 'none' | 'move' | 'authorize' | 'needs-reason';

export function dropEffect(from: Status, to: Status): DropEffect {
  if (from === to) return 'none';
  if (to === 'queued') return 'authorize';
  if (to === 'blocked') return 'needs-reason';
  return 'move';
}

/** 八欄各自的卡片。沒有 issue 的欄位也要在 map 裡，否則欄位會消失。 */
export function groupByStatus<T extends { readonly status: Status }>(
  items: readonly T[],
): ReadonlyMap<Status, readonly T[]> {
  const groups = new Map<Status, T[]>(ORDER.map((s) => [s, []]));
  for (const item of items) groups.get(item.status)?.push(item);
  return groups;
}
