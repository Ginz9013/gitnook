import { useDraggable } from '@dnd-kit/core';

import type { IssueView } from '@/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * 卡片的樣子。抽出來是因為拖曳中的 `DragOverlay` 要畫同一張卡片 ——
 * 兩處各畫一次遲早會長歪。
 */
export function CardFace({
  issue,
  className,
}: {
  readonly issue: IssueView;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-md border p-2 text-left shadow-xs',
        className,
      )}
    >
      <div className="text-muted-foreground font-mono text-[10px] break-all">
        {/*
          短 ID 的長度是「整批 Issue」的性質，唯一來源是 core 的 shortIdLength，
          因此它必須由 server 算好隨 IssueView 一起送。`IssueView` 目前沒有那個
          欄位（見執行報告），在它補上之前這裡顯示完整 id —— 前端自己挑一個長度
          會在別的分支上撞號，而撞號的短 ID 比長 ID 更糟。
        */}
        {issue.id}
      </div>
      <div className="mt-1 text-sm leading-snug">{issue.title}</div>
      {issue.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {issue.labels.map((label) => (
            <Badge key={label} variant="secondary" className="font-normal">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export interface CardProps {
  readonly issue: IssueView;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

/**
 * 一張可拖曳的卡片，一個 tab stop：**Space 抓起、Enter 開細節**。
 *
 * `@dnd-kit` 預設 Space 與 Enter 都是「開始拖曳」，這裡把 Enter 讓出來給
 * 開啟細節（見 `Board.tsx` 的 sensor 設定）—— 否則卡片上就得多長一顆按鈕，
 * 四十張 Issue 就是八十個 tab stop。
 *
 * 整張卡片都是拖曳把手，所以指標可以從任何地方拖起。拖完那一下的 click 由
 * `@dnd-kit` 自己在 document 上攔掉，不會誤開 drawer。
 */
export function Card({ issue, selected, onSelect }: CardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: { title: issue.title, status: issue.status },
    attributes: { roleDescription: '可拖曳的 Issue 卡片' },
  });

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // 拖曳期間的鍵盤全部歸 sensor 管（它自己聽 document 的 keydown）。
    if (isDragging) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onSelect(issue.id);
      return;
    }
    listeners?.['onKeyDown']?.(event);
  }

  return (
    <li>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onKeyDown={handleKeyDown}
        onClick={() => onSelect(issue.id)}
        className={cn(
          'focus-visible:ring-ring cursor-grab rounded-md outline-none focus-visible:ring-2',
          selected && 'ring-ring ring-2',
          // 拖曳中：原地留一個淡掉的位置，真正跟著走的是 DragOverlay。
          isDragging && 'opacity-40',
        )}
      >
        <CardFace issue={issue} />
      </div>
    </li>
  );
}
