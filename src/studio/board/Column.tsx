import { useDroppable } from '@dnd-kit/core';

import type { IssueView, Status } from '@/api';
import type { ProjectedIssue } from '@/reconcile';
import { cn } from '@/lib/utils';

import { Card } from './Card';
import type { DraggedIssue } from './dnd';

/** 拖曳中的那一張 Issue：從哪個 Status 來、叫什麼。 */
export interface DragState extends DraggedIssue {
  readonly id: string;
}

export interface ColumnProps {
  /** 這一欄畫的是哪一個 Status —— 欄是版面，Status 才是它代表的東西。 */
  readonly status: Status;
  /** 這一欄的 Issue，**已經是調和過的投影** —— 卡片要畫得出「還沒落地」。 */
  readonly issues: readonly ProjectedIssue<IssueView>[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly dragging: DragState | null;
}

/**
 * 被拖到這一欄上方時，這一欄長什麼樣。**只有兩種，而且與是哪一欄無關**：
 * 放下去會換 Status，或不會。
 *
 * 沒有第三格。`queued` 曾經有（實心 ring 加 primary 底色，外加一行「放開＝授權
 * agent 不再詢問、直接動手」），`blocked` 更早之前也有（destructive 的 ring 加
 * 「放開後要說明卡住的原因」）。兩個都拆了 —— 看板不替任何 Status 預設解讀
 * （ADR-0010），而 `blocked` 就只是八個 Status 之一（ADR-0003）。授權語意留在
 * CLI 與 AGENT.md，那是工作流的約定，不是這裡的一格 CSS。
 */
const TARGET_STYLE = {
  stay: 'border-muted-foreground/40 border-dashed',
  move: 'border-primary/40 bg-accent',
} as const;

/** 看板上的一個直排 —— 一個 Status 的全部 Issue。名字講的是版面，`status` 講的是內容。 */
export function Column({
  status,
  issues,
  selectedId,
  onSelect,
  dragging,
}: ColumnProps): React.JSX.Element {
  // droppable 的 id 就是 Status —— 放下時不必再查表。
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const targeted = isOver && dragging !== null;
  // 放回原本那一欄不是一次移動（`Board.tsx` 的 `handleDragEnd` 送的是 `onRelease`），
  // 所以它也不該長得像一次移動。這是唯一的判斷，而它問的是這次拖曳，不是這一欄。
  const effect = dragging !== null && dragging.status === status ? 'stay' : 'move';

  return (
    <section
      ref={setNodeRef}
      aria-label={`${status}，${issues.length} 張 Issue`}
      className={cn(
        'bg-muted/40 flex w-64 shrink-0 flex-col rounded-lg border transition-colors',
        targeted && TARGET_STYLE[effect],
      )}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {/* 八個欄頭長得一模一樣：名字與張數，沒有任何一欄多一個東西（ADR-0010）。 */}
        <h2 className="font-mono text-xs font-medium">{status}</h2>
        <span className="text-muted-foreground text-xs">{issues.length}</span>
      </header>

      <ul className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {issues.map((projected) => (
          <Card
            key={projected.id}
            projected={projected}
            selected={projected.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}
