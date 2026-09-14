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
        // 還在飛的那張畫虛線邊框。**刻意不新增顏色** —— 已落地與未落地的差別
        // 畫在邊框的形狀上，而形狀在任何主題、任何色覺底下都成立。顏色做不到
        // 這件事，這是選形狀而不是選顏色的理由。
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
 * 名字講的是版面（畫在螢幕上的那張卡片），裝的是 Issue —— 所以 props 與播報
 * 一律說 Issue。
 *
 * `@dnd-kit` 預設 Space 與 Enter 都是「開始拖曳」，這裡把 Enter 讓出來給
 * 開啟細節（見 `Board.tsx` 的 sensor 設定）—— 否則每張卡片上就得多長一顆按鈕，
 * 四十張 Issue 就是八十個 tab stop。
 *
 * 整張卡片都是拖曳把手，所以指標可以從任何地方拖起。拖完那一下的 click 由
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
    attributes: { roleDescription: 'draggable issue' },
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
        // 「這個節點代表哪一張 Issue」—— `focus.ts` 靠它把焦點放回這張卡片。
        // 用 data 屬性而不是往上傳一份 ref 登記表：卡片會因為換 Status 而被
        // React 拆掉重建，登記表要在對的時機更新才不會拿到脫落的節點，而查詢
        // 是在需要的當下才做，本來就沒有這個問題。
        data-issue={issue.id}
        onKeyDown={handleKeyDown}
        onClick={() => onSelect(issue.id)}
        // 顯示的已經是樂觀值；還在飛就讓輔助技術知道這裡尚未定案（同 drawer 的欄位）。
        aria-busy={pending}
        className={cn(
          'focus-visible:ring-ring cursor-grab rounded-md outline-none focus-visible:ring-2',
          selected && 'ring-ring ring-2',
          // 抓著的那張：抬高一階再加上游標。`held` 不等於 `isDragging` —— 前者
          // 來自調和 state（`GRAB` 到 `RELEASE`／`DROP` 之間），後者是 @dnd-kit
          // 自己的旗標，兩個不同的來源。它講的是「這張不接受伺服器的更新」。
          //
          // **刻意不是 `ring-primary`。** 那層預設的解讀拆掉之後主色沒有語意
          // （ADR-0010），拿它當通用的反白會稀釋它的意思；而 `ring` 這個記號
          // 已經被上面的 `selected` 用掉了。抬高則接得上拖曳中的 `shadow-lg`
          // （見 Board 的 DragOverlay）：靜止是 `shadow-xs`，抓著在中間。
          projected.held && 'cursor-grabbing shadow-md',
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
