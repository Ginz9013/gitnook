import { Fragment, useMemo, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { Announcements, DragEndEvent, DragStartEvent } from '@dnd-kit/core';

import type { IssueView, Status } from '@/api';
import { Button } from '@/components/ui/button';

import { BlockedGate } from './BlockedGate';
import { CardFace } from './Card';
import { Column } from './Column';
import type { DragState } from './Column';
import { announceCancel, announceDrop, announceGrab, announceOver, dragInstructions } from './announce';
import { boardCollision, cardData, columnKeyboardCoordinates, statusOf } from './dnd';
import { COLUMNS, dropEffect, groupByStatus } from './lanes';

/**
 * 看板的插槽。**這是票 06 要填的空殼** —— 八欄、卡片與 `@dnd-kit` 的拖拉
 * 都在那張票。這裡先把介面定下來，票 06 因此只需要改本目錄底下的檔案，
 * 不必回頭動 `App.tsx`。
 */
export interface BoardProps {
  /** 目前這一版快照裡的全部 Issue，含 archived —— 藏不藏是這一層的決定。 */
  readonly issues: readonly IssueView[];
  /** drawer 目前開在哪一張；沒開就是 null。 */
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  /** 一次拖曳的結果。票 06 接上 @dnd-kit，票 05 負責送出與調和。 */
  readonly onMove: (id: string, status: Status) => void;
  /**
   * 卡片被指標或鍵盤抓住了。對應調和 reducer 的 `GRAB`：抓住之後這張卡片在
   * 放開之前不接受任何來自伺服器的移動（`reconcile.ts` 第三條規則）。
   *
   * 選用 —— 目前的 `App.tsx` 還沒有 reducer 可派（票 05）。看板這一側的責任
   * 是把時機正確地講出來，接不接得住是輪詢那一票的事。
   */
  readonly onGrab?: (id: string) => void;
  /**
   * 放開了，而且**沒有**造成移動（取消、放回原欄、或在 blocked 閘門前反悔）。
   * 對應 `RELEASE`。有移動時只送 `onMove`：reducer 的 `DROP` 本身就結束拖曳，
   * 再補一次 `RELEASE` 會把押後的快照套兩次。
   */
  readonly onRelease?: () => void;
}

/** blocked 閘門正在問的那一張。 */
interface Gate {
  readonly id: string;
  readonly title: string;
}

export function Board({
  issues,
  selectedId,
  onSelect,
  onMove,
  onGrab,
  onRelease,
}: BoardProps): React.JSX.Element {
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
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

  const archivedCount = issues.filter((i) => i.archived).length;
  // archived 是可見性欄位而不是第九個 Status（ADR-0003）：它不佔一欄，而是
  // 從八欄裡隱藏起來，預設不顯示。
  const visible = showArchived ? issues : issues.filter((i) => !i.archived);
  const byStatus = groupByStatus(visible);
  const activeIssue = dragging === null ? null : (issues.find((i) => i.id === dragging.id) ?? null);

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const data = cardData(active);
        return data === null ? undefined : announceGrab(data.title, data.status);
      },
      onDragOver: ({ active, over }) => {
        const data = cardData(active);
        return data === null ? undefined : announceOver(data.title, data.status, statusOf(over));
      },
      onDragEnd: ({ active, over }) => {
        const data = cardData(active);
        return data === null ? undefined : announceDrop(data.title, data.status, statusOf(over));
      },
      onDragCancel: ({ active }) => {
        const data = cardData(active);
        return data === null ? undefined : announceCancel(data.title, data.status);
      },
    }),
    [],
  );

  function handleDragStart(event: DragStartEvent): void {
    const data = cardData(event.active);
    if (data === null) return;
    const id = String(event.active.id);
    setDragging({ id, ...data });
    onGrab?.(id);
  }

  function handleDragEnd(event: DragEndEvent): void {
    const drag = dragging;
    setDragging(null);
    if (drag === null) return;

    const to = statusOf(event.over);
    if (to === null) {
      onRelease?.();
      return;
    }
    switch (dropEffect(drag.status, to)) {
      case 'none':
        onRelease?.();
        return;
      case 'needs-reason':
        // 還沒決定，所以還沒 RELEASE：閘門開著的時候這張卡片不該被伺服器抽走。
        setGate({ id: drag.id, title: drag.title });
        return;
      case 'authorize':
      case 'move':
        onMove(drag.id, to);
        return;
    }
  }

  function handleDragCancel(): void {
    setDragging(null);
    onRelease?.();
  }

  return (
    <main className="flex h-dvh flex-col gap-3 p-4" data-slot="board">
      <header className="flex shrink-0 items-center gap-3">
        <span className="text-muted-foreground text-xs">{visible.length} 張 Issue</span>
        {archivedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? '隱藏已封存' : `顯示已封存（${archivedCount}）`}
          </Button>
        )}
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={boardCollision}
        accessibility={{ announcements, screenReaderInstructions: { draggable: dragInstructions } }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((column) => (
            <Fragment key={column.status}>
              {column.opensLane && <LaneBoundary />}
              <Column
                column={column}
                issues={byStatus.get(column.status) ?? []}
                selectedId={selectedId}
                onSelect={onSelect}
                dragging={dragging}
              />
            </Fragment>
          ))}
        </div>

        {/* 欄位會 overflow-y-auto，被拖的卡片放在 overlay 上才不會被裁掉。 */}
        <DragOverlay dropAnimation={null}>
          {activeIssue !== null && <CardFace issue={activeIssue} className="rotate-1 shadow-lg" />}
        </DragOverlay>
      </DndContext>

      {gate !== null && (
        <BlockedGate
          title={gate.title}
          onConfirm={() => {
            onMove(gate.id, 'blocked');
            // 原因寫在 drawer 裡（票 07）—— 閘門只負責在放手的當下把人帶到那裡。
            onSelect(gate.id);
            setGate(null);
          }}
          onCancel={() => {
            onRelease?.();
            setGate(null);
          }}
        />
      )}
    </main>
  );
}

/**
 * 人的車道與 agent 的車道之間那條線（CONTEXT.md）。它一直畫在那裡，不是只有
 * 拖曳時才出現 —— 「現在塞住的是哪一邊」是看一眼就要看得出來的事。
 */
function LaneBoundary(): React.JSX.Element {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2 self-stretch px-1">
      <div className="border-primary/50 min-h-4 flex-1 border-l border-dashed" />
      <span
        className="text-primary/70 text-[10px] whitespace-nowrap"
        style={{ writingMode: 'vertical-rl' }}
      >
        人 ／ agent 的交接
      </span>
      <div className="border-primary/50 min-h-4 flex-1 border-l border-dashed" />
    </div>
  );
}
