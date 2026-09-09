import { useDraggable } from '@dnd-kit/core';

import type { IssueView } from '@/api';
import type { ProjectedIssue } from '@/reconcile';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { announceIssueState, pendingLabel, pendingParts } from './announce';

/**
 * 一張 Issue 在看板上的樣子。抽出來是因為拖曳中的 `DragOverlay` 要畫同一張，
 * 兩處各畫一次遲早會長歪。
 *
 * 收的是 `project()` 的投影而不是 `IssueView`：畫面上要畫的不只是「這張現在
 * 長什麼樣」，還有「這張上面有沒有東西還沒落地」，而後者只有投影帶得動。
 */
export function CardFace({
  projected,
  className,
}: {
  readonly projected: ProjectedIssue<IssueView>;
  readonly className?: string;
}): React.JSX.Element {
  const issue = projected.shown;
  const pending = pendingLabel(projected.optimistic, projected.unconfirmed);

  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-md border p-2 text-left shadow-xs',
        // 還在飛的那張畫虛線邊框。**刻意不新增顏色**（index.css 那份 token 是
        // 票 01 的）—— 已落地與未落地的差別畫在邊框的形狀上，而形狀在任何
        // 主題、任何色覺底下都成立。
        pending !== null && 'border-dashed',
        className,
      )}
    >
      <div className="text-muted-foreground font-mono text-[10px] break-all">
        {/*
          短 Ref 的長度是「整批 Issue」的性質，唯一來源是 core 的 shortIdLength，
          所以它由 server 算好隨 `IssueView` 一起送（票 11）。前端自己截一個長度
          會在別的分支上撞號，而撞號的短 Ref 比 26 碼更糟 —— 使用者接著就是拿
          它去當 Ref 用。
        */}
        {issue.shortId}
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
      {pending !== null && (
        // `aria-hidden`：同一件事由 `Card` 的 sr-only 句子完整講一次，這一行
        // 只是它的縮寫。兩份都念出來就是把每張飛行中的 Issue 唸兩遍。
        <div aria-hidden className="text-muted-foreground mt-2 text-[10px]">
          {pending}
        </div>
      )}
    </div>
  );
}

export interface CardProps {
  /** 快照 + 樂觀覆蓋。與 drawer 拿的是同一份投影 —— 兩邊不可能講出不同的話。 */
  readonly projected: ProjectedIssue<IssueView>;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

/**
 * 一張可拖曳的 Issue，一個 tab stop：**Space 抓起、Enter 開細節**。
 *
 * 名字講的是版面（畫在螢幕上的那個方框），裝的是 Issue —— 所以 props 與播報
 * 一律說 Issue。
 *
 * `@dnd-kit` 預設 Space 與 Enter 都是「開始拖曳」，這裡把 Enter 讓出來給
 * 開啟細節（見 `Board.tsx` 的 sensor 設定）—— 否則每個方框上就得多長一顆按鈕，
 * 四十張 Issue 就是八十個 tab stop。
 *
 * 整個方框都是拖曳把手，所以指標可以從任何地方拖起。拖完那一下的 click 由
 * `@dnd-kit` 自己在 document 上攔掉，不會誤開 drawer。
 */
export function Card({ projected, selected, onSelect }: CardProps): React.JSX.Element {
  const issue = projected.shown;
  // 看得見的那一套區別必須同時用字講出來（announce.ts 的開場）：虛線邊框與
  // ring 對看不見畫面的人不存在，而鍵盤無障礙是 ADR-0008 選 React 的唯一理由。
  const state = announceIssueState(projected.optimistic, projected.unconfirmed, projected.held);
  const pending = pendingParts(projected.optimistic, projected.unconfirmed).length > 0;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: { title: issue.title, status: issue.status },
    attributes: { roleDescription: '可拖曳的 Issue' },
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
        // 顯示的已經是樂觀值；還在飛就讓輔助技術知道這裡尚未定案（同 drawer 的欄位）。
        aria-busy={pending}
        className={cn(
          'focus-visible:ring-ring cursor-grab rounded-md outline-none focus-visible:ring-2',
          selected && 'ring-ring ring-2',
          // 抓著的那張。`held` 不等於 `isDragging`：放開之後 blocked 閘門還開著
          // 的那段期間，指標已經放掉了但這張仍然被押著不接受伺服器的更新
          // （Board 那時刻意不送 RELEASE），而那正是最需要看得出來的一刻。
          projected.held && 'ring-primary cursor-grabbing ring-2',
          // 拖曳中：原地留一個淡掉的位置，真正跟著走的是 DragOverlay。
          isDragging && 'opacity-40',
        )}
      >
        <CardFace projected={projected} />
        {/* 接在可及名稱後面 —— Tab 過來就會連著標題一起聽到。`aria-describedby`
            不能用：@dnd-kit 已經把拖曳說明掛在那裡，蓋掉它等於拿走操作指示。 */}
        {state !== null && <span className="sr-only">{state}</span>}
      </div>
    </li>
  );
}
