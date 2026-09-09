import { useDroppable } from '@dnd-kit/core';

import type { IssueView, Status } from '@/api';
import type { ProjectedIssue } from '@/reconcile';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { Card } from './Card';
import type { DraggedIssue } from './dnd';
import { dropEffect } from './lanes';

/** 拖曳中的那一張 Issue：從哪個 Status 來、叫什麼。放下會發生什麼由 `dropEffect` 決定。 */
export interface DragState extends DraggedIssue {
  readonly id: string;
}

export interface ColumnProps {
  /** 這一欄畫的是哪一個 Status —— 欄是版面，Status 才是它代表的東西。 */
  readonly status: Status;
  /** 這一欄的 Issue，**已經是調和過的投影** —— 方框要畫得出「還沒落地」。 */
  readonly issues: readonly ProjectedIssue<IssueView>[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly dragging: DragState | null;
}

/** 被拖到這一欄上方時，這一欄長什麼樣、說什麼話。 */
const TARGET_STYLE = {
  none: 'border-muted-foreground/40 border-dashed',
  move: 'border-primary/40 bg-accent',
  // 授權邊界要看得出來比換一個 Status 重：實心的 ring 加 primary 底色。
  authorize: 'border-primary bg-primary/10 ring-2 ring-primary',
  'needs-reason': 'border-destructive bg-destructive/10 ring-2 ring-destructive',
} as const;

const TARGET_HINT = {
  none: null,
  move: null,
  authorize: '放開＝授權 agent 不再詢問、直接動手',
  'needs-reason': '放開後要說明卡住的原因',
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
  const effect = dragging === null ? 'none' : dropEffect(dragging.status, status);
  const targeted = isOver && dragging !== null;
  const hint = targeted ? TARGET_HINT[effect] : null;

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
        <h2 className="font-mono text-xs font-medium">{status}</h2>
        <span className="text-muted-foreground text-xs">{issues.length}</span>
        {status === 'queued' && (
          // 閘門不是只有拖曳時才存在 —— 它一直都在那裡。
          <Badge variant="outline" className="border-primary text-primary ml-auto font-normal">
            授權閘門
          </Badge>
        )}
      </header>

      {hint !== null && (
        <p
          className={cn(
            'px-3 py-1 text-xs font-medium',
            effect === 'authorize' ? 'text-primary' : 'text-destructive',
          )}
        >
          {hint}
        </p>
      )}

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
