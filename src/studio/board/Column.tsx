import { useDroppable } from '@dnd-kit/core';
import { PlusIcon } from 'lucide-react';

import type { IssueView, Status } from '@/api';
import type { ProjectedIssue } from '@/reconcile';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { Card } from './Card';
import type { DraggedIssue } from './dnd';
import { NewIssueForm, useNewIssueEntry } from './NewIssueForm';

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
  /**
   * 在**這一欄**開一張 Issue。欄頂的 `+` 把 `status` 當預設值送出去 —— 那是
   * 看板這個版面唯一比 CLI 好的地方，所以八欄都有，含 `queued`（D15，使用者
   * 明確裁決）。八欄一視同仁，這裡不例外（ADR-0010）。
   *
   * **必填。** 同 `Board` 的 `onGrab`：可選的接線少傳時編得過、跑得動、沒有
   * 任何錯誤，只是那一欄的 `+` 從此什麼都不會發生。
   */
  readonly onCreate: (title: string, status: Status | undefined) => Promise<boolean>;
}

/**
 * 被拖到這一欄上方時，這一欄長什麼樣。**只有兩種，而且與是哪一欄無關**：
 * 放下去會換 Status（`TARGET_MOVE`），或不會（`TARGET_STAY`）。
 *
 * 兩個常數而不是一個以 `'stay' | 'move'` 為鍵的表：那個聯集在 ADR-0010 把
 * `dropEffect` 整個刪掉之後就沒有主人了 —— 沒有任何函式產出它、以它為型別，
 * 它只是在一行三元運算式與一次查表之間活了兩步。`from === to` 不是領域規則，
 * 是一次相等比較，替它的兩個結果命名是儀式。
 *
 * 沒有第三格。`queued` 曾經有（實心 ring 加 primary 底色，外加一行「放開＝授權
 * agent 不再詢問、直接動手」），`blocked` 更早之前也有（destructive 的 ring 加
 * 「放開後要說明卡住的原因」）。兩個都拆了 —— 看板不替任何 Status 預設解讀
 * （ADR-0010），而 `blocked` 就只是八個 Status 之一（ADR-0003）。授權語意留在
 * CLI 與 AGENT.md，那是工作流的約定，不是這裡的一格 CSS。
 */
const TARGET_STAY = 'border-muted-foreground/40 border-dashed';
const TARGET_MOVE = 'border-primary/40 bg-accent';

/** 看板上的一個直排 —— 一個 Status 的全部 Issue。名字講的是版面，`status` 講的是內容。 */
export function Column({
  status,
  issues,
  selectedId,
  onSelect,
  dragging,
  onCreate,
}: ColumnProps): React.JSX.Element {
  const entry = useNewIssueEntry();
  // droppable 的 id 就是 Status —— 放下時不必再查表。
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const targeted = isOver && dragging !== null;
  // 放回原本那一欄不是一次移動（`Board.tsx` 的 `handleDragEnd` 送的是 `onRelease`），
  // 所以它也不該長得像一次移動。這是唯一的判斷，而它問的是這次拖曳，不是這一欄。
  const moves = dragging !== null && dragging.status !== status;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${status}，${issues.length} 張 Issue`}
      className={cn(
        'bg-muted/40 flex w-64 shrink-0 flex-col rounded-lg border transition-colors',
        targeted && (moves ? TARGET_MOVE : TARGET_STAY),
      )}
    >
      <header className="flex flex-col gap-2 border-b px-3 py-2">
        {/* 八個欄頭長得一模一樣：名字、張數，加上一顆 `+`。沒有任何一欄多一個
            東西，也沒有任何一欄少一個（ADR-0010）。 */}
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-xs font-medium">{status}</h2>
          <span className="text-muted-foreground text-xs">{issues.length}</span>
          <Button
            {...entry.trigger}
            type="button"
            variant="ghost"
            size="icon"
            // 八顆按鈕都叫「新增」時，螢幕閱讀器唸出來的是八個一模一樣的東西，
            // 使用者分不出自己按的是哪一欄 —— 而「哪一欄」正是這顆按鈕全部的
            // 意義所在。
            aria-label={`在 ${status} 新增 Issue`}
            className="ml-auto size-6"
          >
            <PlusIcon />
          </Button>
        </div>
        {entry.open && (
          <NewIssueForm status={status} onCreate={onCreate} onCancel={entry.close} />
        )}
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
