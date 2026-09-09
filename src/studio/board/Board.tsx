import { useMemo, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { Announcements, DragEndEvent, DragStartEvent } from '@dnd-kit/core';

import type { BoardInfo, IssueView, Status } from '@/api';
import type { ProjectedIssue } from '@/reconcile';
import { STATUS_ORDER, groupByStatus } from '@/statuses';

import { BoardHeader } from './BoardHeader';
import { CardFace } from './Card';
import { Column } from './Column';
import type { DragState } from './Column';
import { announceCancel, announceDrop, announceGrab, announceOver, dragInstructions } from './announce';
import { boardCollision, columnKeyboardCoordinates, draggedIssue, statusOf } from './dnd';

/**
 * 看板對外的那一面。`App` 是唯一的呼叫端 —— 它持有調和 state 與寫入面，看板
 * 只把事件翻成這裡的 action。
 */
export interface BoardProps {
  /**
   * 目前這一版快照裡的全部 Issue，含 archived —— 藏不藏是這一層的決定。
   *
   * **收的是 `project()` 的投影，不是攤平過的 `IssueView[]`。** 攤平（原本
   * `App.tsx` 的 `.map(p => p.shown)`）會把 `optimistic` 與 `held` 丟掉，而丟掉
   * 之後一張還在飛的 Issue 與一張已經落地的長得一模一樣 —— 那正是這一層唯一
   * 能講、也只有這一層講得出來的區別。drawer 的 `IssueDrawerProps` 一直都是這
   * 個形狀，看板這裡是補齊。
   */
  readonly issues: readonly ProjectedIssue<IssueView>[];
  /**
   * 這塊 board 是哪一塊 —— 路徑、分支、Actor（`/api/board-info`）。看板自己不用
   * 它，整份直接交給 `BoardHeader`。
   *
   * **還沒抓到就是 `null`，看板照畫。** 那個端點會 spawn 一個 `git rev-parse`，
   * 所以它與快照分開、只在開場抓一次（`App.tsx`）；讓看板等它，等於為了一行
   * 說明文字把整塊 board 押後。
   */
  readonly info: BoardInfo | null;
  /** drawer 目前開在哪一張；沒開就是 null。 */
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  /**
   * 一次拖曳造成的移動。**八個 Status 都走這一條**，包含 `blocked`。
   *
   * 曾經有一條 `onBlock`：拖進 `blocked` 得先開閘門收下卡住的原因，再把
   * status 與 comment 當成同一份 Change 送出。那條規則整條拿掉了（ADR-0003
   * 已改寫），於是「只有 status」就是一次拖曳能表達的全部 —— 這個簽章因此
   * 不再是缺了什麼，而是剛好。
   */
  readonly onMove: (id: string, status: Status) => void;
  /**
   * 這張 Issue 被指標或鍵盤抓住了。對應調和 reducer 的 `GRAB`：抓住之後它在
   * 放開之前不接受任何來自伺服器的移動（`reconcile.ts` 第三條規則）。
   *
   * **必填。** 原本是選用的（那時 `App.tsx` 還沒有 reducer 可派），但看板現在
   * 靠 `held` 畫出「被抓著」的那張卡片 —— 少傳 `onGrab` 的看板永遠不會有任何
   * 一張是 held，而且編得過、跑得動、沒有任何錯誤。可選的接線就是這樣靜靜壞掉的。
   */
  readonly onGrab: (id: string) => void;
  /**
   * 放開了，而且**沒有**造成移動（取消，或放回原本的 Status）。對應 `RELEASE`。
   * 有移動時只送 `onMove`：reducer 的 `DROP` 本身就結束拖曳，再補一次
   * `RELEASE` 會把押後的快照套兩次。
   */
  readonly onRelease: () => void;
  /**
   * 開一張新的 Issue。`status` 是 `undefined` 時不指定，由 core 決定落點
   * （`backlog`）—— header 那顆按鈕就是這種，欄頂的八個 `+` 各自帶著自己那一欄。
   *
   * **回 `false` 表示沒建成**，表單靠它決定要不要清空輸入框。新增刻意不做樂觀
   * 更新：新 Issue 的 ULID 由 server 產生，client 沒有 id 可以先畫
   * （`reconcile.ts` 的 `CREATED`），所以看板在回應到達之前不會多出任何東西。
   */
  readonly onCreate: (title: string, status: Status | undefined) => Promise<boolean>;
}

export function Board({
  issues,
  info,
  selectedId,
  onSelect,
  onMove,
  onGrab,
  onRelease,
  onCreate,
}: BoardProps): React.JSX.Element {
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const sensors = useSensors(
    // 4px 的門檻讓「點一下開細節」與「拖走」分得開。
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      // 預設 Enter 也是「開始拖曳」，這裡讓出來給開啟細節（見 Card.tsx）。
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
      coordinateGetter: columnKeyboardCoordinates,
    }),
  );

  // archived 與 status 都讀 `shown`：畫面該照著樂觀值分欄，否則拖走的那張會
  // 留在原本的欄位裡，等 ACK 回來才跳過去。
  const archivedCount = issues.filter((i) => i.shown.archived).length;
  // archived 是可見性欄位而不是第九個 Status（ADR-0003）：它不多佔一欄，而是
  // 從八欄裡隱藏起來，預設不顯示。
  const visible = showArchived ? issues : issues.filter((i) => !i.shown.archived);
  const byStatus = groupByStatus(visible, (i) => i.shown.status);
  const activeIssue = dragging === null ? null : (issues.find((i) => i.id === dragging.id) ?? null);

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const data = draggedIssue(active);
        return data === null ? undefined : announceGrab(data.title, data.status);
      },
      onDragOver: ({ active, over }) => {
        const data = draggedIssue(active);
        return data === null ? undefined : announceOver(data.title, data.status, statusOf(over));
      },
      onDragEnd: ({ active, over }) => {
        const data = draggedIssue(active);
        return data === null ? undefined : announceDrop(data.title, data.status, statusOf(over));
      },
      onDragCancel: ({ active }) => {
        const data = draggedIssue(active);
        return data === null ? undefined : announceCancel(data.title, data.status);
      },
    }),
    [],
  );

  function handleDragStart(event: DragStartEvent): void {
    const data = draggedIssue(event.active);
    if (data === null) return;
    const id = String(event.active.id);
    setDragging({ id, ...data });
    onGrab(id);
  }

  function handleDragEnd(event: DragEndEvent): void {
    const drag = dragging;
    setDragging(null);
    if (drag === null) return;

    // 換了 Status 才是一次移動。沒放進任何一欄、或放回原本那一欄，都只是放開 ——
    // op-log 是 append-only，一次什麼都沒改的放下不該在 .ndjson 上留下痕跡。
    //
    // 八個 Status 走的是同一條（ADR-0010）：沒有哪一格放下去會發生別的事。
    const to = statusOf(event.over);
    if (to === null || to === drag.status) {
      onRelease();
      return;
    }
    onMove(drag.id, to);
  }

  function handleDragCancel(): void {
    setDragging(null);
    onRelease();
  }

  return (
    <main
      className="flex h-dvh flex-col gap-3 p-4 outline-none"
      data-slot="board"
      // 焦點的最後退路（`focus.ts`）：對話框關掉時那張 Issue 已經不在畫面上
      // （被 archived 篩掉、從快照消失）就 focus 到這裡。`-1` 是「程式可以給它
      // 焦點，但 Tab 不會停在這」。
      tabIndex={-1}
      // 這個 landmark 一定要有可及名稱，因為焦點**會**退回它，而且正是在最需要
      // 交代狀況的時候：那張 Issue 剛從看板上消失了。沒有名稱時 screen reader
      // 唸到的只有「main」，使用者不知道自己被丟到哪裡。`data-slot` 是給 CSS
      // 與測試看的，輔助技術讀不到它。
      aria-label="Nook 看板"
    >
      {/* 整條 header 在 `BoardHeader.tsx` —— B5 與 B6 都還要往上加東西，而這個
          檔案已經是 DndContext 的持有者。 */}
      <BoardHeader
        info={info}
        visibleCount={visible.length}
        archivedCount={archivedCount}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        onCreate={onCreate}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={boardCollision}
        accessibility={{ announcements, screenReaderInstructions: { draggable: dragInstructions } }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2">
          {/* 由左到右照 `STATUS_ORDER`，鍵盤的左右鍵也照同一份（`dnd.ts`）。
              中間不插任何東西 —— 八欄一視同仁（ADR-0010）。 */}
          {STATUS_ORDER.map((status) => (
            <Column
              key={status}
              status={status}
              issues={byStatus.get(status) ?? []}
              selectedId={selectedId}
              onSelect={onSelect}
              dragging={dragging}
              onCreate={onCreate}
            />
          ))}
        </div>

        {/* 欄位會 overflow-y-auto，被拖的那張放在 overlay 上才不會被裁掉。 */}
        <DragOverlay dropAnimation={null}>
          {activeIssue !== null && (
            <CardFace projected={activeIssue} className="rotate-1 shadow-lg" />
          )}
        </DragOverlay>
      </DndContext>
    </main>
  );
}

