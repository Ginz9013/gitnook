import { useDroppable } from '@dnd-kit/core';
import type { UniqueIdentifier } from '@dnd-kit/core';
import { ChevronsLeftRight, ChevronsRightLeft, PlusIcon } from 'lucide-react';

import type { IssueView, Status } from '@/api';
import type { ProjectedIssue } from '@/reconcile';
import { Button } from '@/components/ui/button';
import { STATUS_ORDER } from '@/statuses';
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
   * 這一欄**現在**折著嗎 —— 已經是「偏好扣掉拖曳掀開的」那個差集
   * （`collapse.ts` 的 `collapsedNow`），這裡不再自己判斷一次。
   *
   * 折起來只是不畫內容，**不是不能放東西**：`useDroppable` 照樣掛著，40px 的
   * 直立條仍然是合法的 drop target，鍵盤的左右鍵也照樣停在它上面。
   */
  readonly collapsed: boolean;
  /** 欄頭那顆切換鈕按下去了。偏好由 `Board.tsx` 持有並寫進 `localStorage`。 */
  readonly onToggleCollapsed: () => void;
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

/**
 * 任何一欄改變寬度時，**八欄的 rect 全部重量一次**。
 *
 * `@dnd-kit` 預設只在拖曳開始時量一次（`MeasuringStrategy.WhileDragging`），
 * 而 `useDroppable` 掛的 ResizeObserver 預設只重量它自己那一格。折疊欄位被
 * 掀開時它自己變寬了（觀察得到），右邊那幾欄卻只是**被推走**——尺寸沒變，
 * 沒有任何 observer 會響，於是它們的 rect 停在舊位置。接下來 `pointerWithin`
 * 與 `columnKeyboardCoordinates` 都拿那份舊座標做事：滑鼠指著第六欄卻進了
 * 第五欄，右方向鍵一次跳過一整欄。兩個都是安靜的錯。
 *
 * 這一格把「重量誰」從自己一個換成全部八個，代價是掀開之後多量七個 rect，
 * 一次，而且只在拖曳中（observer 本身只在 `active` 時才接上）。
 */
const ALL_COLUMNS: UniqueIdentifier[] = [...STATUS_ORDER];

/** 折起來之後那一條的寬度。40px（`w-10`）—— 直立的欄名加上一顆切換鈕剛好。 */
const COLLAPSED = 'w-10';

/** 看板上的一個直排 —— 一個 Status 的全部 Issue。名字講的是版面，`status` 講的是內容。 */
export function Column({
  status,
  issues,
  selectedId,
  onSelect,
  dragging,
  collapsed,
  onToggleCollapsed,
  onCreate,
}: ColumnProps): React.JSX.Element {
  const entry = useNewIssueEntry();
  // droppable 的 id 就是 Status —— 放下時不必再查表。
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    resizeObserverConfig: { updateMeasurementsFor: ALL_COLUMNS },
  });
  const targeted = isOver && dragging !== null;
  // 放回原本那一欄不是一次移動（`Board.tsx` 的 `handleDragEnd` 送的是 `onRelease`），
  // 所以它也不該長得像一次移動。這是唯一的判斷，而它問的是這次拖曳，不是這一欄。
  const moves = dragging !== null && dragging.status !== status;

  // 八欄的可及名稱只有這一份 —— 折起來的那一條唸出來要與展開時是同一件東西，
  // 否則螢幕閱讀器使用者折疊之後會以為那一欄不見了。
  const label = `${status}，${issues.length} 張 Issue`;
  const frame = cn(
    'bg-muted/40 flex shrink-0 flex-col rounded-lg border transition-colors',
    collapsed ? COLLAPSED : 'w-64',
    targeted && (moves ? TARGET_MOVE : TARGET_STAY),
  );

  if (collapsed) {
    return (
      // `setNodeRef` 仍然掛著：**折疊是「我現在不看它」，不是「我不能往裡面放」**。
      // 這一條 40px 收得下拖過來的卡片，而拖曳指到它時 `Board.tsx` 會把它暫時
      // 掀開（`collapse.ts` 的 `revealOver`）—— 否則使用者看不到自己放進去的
      // 東西掉在哪。
      <section ref={setNodeRef} aria-label={label} className={frame}>
        {/*
          整條就是那顆切換鈕。40px 寬的目標太細，只放一顆 24px 的圖示鈕等於
          要使用者瞄準 —— 而這一欄現在能做的事就只有「打開」這一件。
        */}
        <button
          type="button"
          onClick={onToggleCollapsed}
          // 名稱**不隨狀態變**（兩邊都是「<status> 欄」），狀態由 `aria-expanded`
          // 講。把動詞寫進名稱（「展開 backlog」／「折疊 backlog」）的話，按下去
          // 的瞬間使用者剛按的那顆鈕改了名字，而 `aria-expanded` 已經把同一件事
          // 講過一次了。
          aria-label={`${status} 欄`}
          aria-expanded={false}
          title={`展開 ${status}`}
          className="hover:bg-accent focus-visible:ring-ring/50 flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg py-2 outline-none focus-visible:ring-[3px]"
        >
          <ChevronsLeftRight aria-hidden className="size-3.5 shrink-0" />
          {/*
            直立的欄名。`writing-mode: vertical-rl` —— 同 A7 刪掉的 `LaneBoundary`
            用過的那一招。`flex-1` 讓它把整條撐滿，於是點哪裡都打得開。
          */}
          <span
            className="flex-1 font-mono text-xs font-medium whitespace-nowrap"
            style={{ writingMode: 'vertical-rl' }}
          >
            {status}
          </span>
          {/*
            張數留在水平方向：一兩位數字橫著看得懂，跟著轉 90 度只是為了整齊。
            `aria-hidden` —— 上面 `aria-label` 已經唸過「N 張 Issue」。
          */}
          <span aria-hidden className="text-muted-foreground text-xs">
            {issues.length}
          </span>
        </button>
      </section>
    );
  }

  return (
    <section ref={setNodeRef} aria-label={label} className={frame}>
      <header className="flex flex-col gap-2 border-b px-3 py-2">
        {/* 八個欄頭長得一模一樣：名字、張數，加上一顆 `+` 與一顆折疊鈕。沒有
            任何一欄多一個東西，也沒有任何一欄少一個（ADR-0010）。 */}
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleCollapsed}
            aria-label={`${status} 欄`}
            aria-expanded={true}
            title={`折疊 ${status}`}
            className="size-6"
          >
            <ChevronsRightLeft />
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
