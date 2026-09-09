import { KeyboardCode, closestCenter, pointerWithin } from '@dnd-kit/core';
import type { Active, CollisionDetection, KeyboardCoordinateGetter, Over } from '@dnd-kit/core';

import type { Status } from '@/api';

import { STATUS_LANES, isStatus } from './lanes';

/**
 * `@dnd-kit` 與這個看板之間的轉接層：把它的 id、rect 與座標翻成 Status。
 * 領域規則不在這裡（在 `lanes.ts`），畫面也不在這裡。
 */

/** 被拖的那張 Issue 掛在 draggable 上的資料。播報要靠它才講得出「哪一張、從哪個 Status」。 */
export interface DraggedIssue {
  readonly title: string;
  readonly status: Status;
}

export function draggedIssue(active: Active): DraggedIssue | null {
  // `active.data.current` 是 `Record<string, any>` —— 逐個欄位檢查而不是斷言。
  const data = active.data.current;
  if (data === undefined) return null;
  const title: unknown = data['title'];
  const status: unknown = data['status'];
  if (typeof title !== 'string' || !isStatus(status)) return null;
  return { title, status };
}

/** droppable 的 id 就是那一欄的 Status；認不出來就是沒放進任何一欄。 */
export function statusOf(over: Over | null): Status | null {
  if (over === null) return null;
  return isStatus(over.id) ? over.id : null;
}

/**
 * 指標時用 `pointerWithin`（游標在哪一欄裡是精確的），鍵盤時沒有游標座標，
 * 退回 `closestCenter`。
 *
 * `closestCenter` 在這個版面上是安全的：欄位很高，被拖的方框停在自己這一欄時
 * 中心只差垂直距離，鄰欄還要再加上水平距離，必然更遠。
 */
export const boardCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : closestCenter(args);
};

/**
 * 鍵盤拖曳：左右方向鍵一次走一欄，上下鍵不做任何事。
 *
 * `@dnd-kit` 內建的座標取得器一次只移動 25px，在八欄的看板上等於要按幾十次；
 * `@dnd-kit/sortable` 的那一個則是為「一欄之內有順序」設計的，而 Nook 的同一個
 * Status 裡沒有順序（ADR-0003 只定義八個 Status）。所以這裡自己走欄位：把被拖的
 * 矩形水平對齊到下一欄的中央，垂直位置不動。
 *
 * **`@dnd-kit/sortable` 因此不是相依套件。** 它曾經被宣告過但從來沒有任何一行
 * import 它 —— 留著一個沒人用的套件，會讓下一個人以為欄內排序是既有設計的一
 * 部分。要恢復它得先有「同一個 Status 裡有順序」這件事，而那是 ADR-0003 的改動。
 *
 * 回傳值的座標系與 `sortableKeyboardCoordinates` 相同：被拖矩形的新左上角
 * （viewport 座標），sensor 自己算差值。
 */
export const columnKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  const step =
    event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();

  const { collisionRect, droppableRects } = context;
  if (collisionRect === null) return;

  // 欄位在畫面上的順序就是 STATUS_LANES 的順序 —— 左右鍵沿著它走。
  const rects = STATUS_LANES.map(({ status }) => droppableRects.get(status));
  const dragCenter = collisionRect.left + collisionRect.width / 2;

  // 目前在哪一欄：中心最接近的那一欄。用距離而不是「包含」，欄位之間的空隙
  // 才不會變成沒有答案的位置。
  let current = -1;
  let best = Number.POSITIVE_INFINITY;
  rects.forEach((rect, i) => {
    if (rect === undefined) return;
    const distance = Math.abs(rect.left + rect.width / 2 - dragCenter);
    if (distance < best) {
      best = distance;
      current = i;
    }
  });
  if (current === -1) return;

  for (let i = current + step; i >= 0 && i < rects.length; i += step) {
    const next = rects[i];
    if (next === undefined) continue;
    return {
      x: next.left + (next.width - collisionRect.width) / 2,
      y: currentCoordinates.y,
    };
  }
  // 已經在最外側的欄位，什麼都不動 —— 回傳 undefined 讓 sensor 不要移動。
  return;
};
