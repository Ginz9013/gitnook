import { useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { Announcements, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';

import type { BoardInfo, IssueView, Status } from '@/api';
import { readCollapsed, writeCollapsed } from '@/prefs';
import type { ProjectedIssue } from '@/reconcile';
import { STATUS_ORDER, groupByStatus } from '@/statuses';
import { cn } from '@/lib/utils';

import { BoardHeader } from './BoardHeader';
import { CardFace } from './Card';
import { Column } from './Column';
import { EmptyBoard } from './EmptyBoard';
import type { DragState } from './Column';
import { announceCancel, announceDrop, announceGrab, announceOver, dragInstructions } from './announce';
import { collapsedNow, revealOver, toggleCollapsed } from './collapse';
import { boardCollision, columnKeyboardCoordinates, draggedIssue, statusOf } from './dnd';
import { allLabels, matchesLabels, toggleLabel } from './filter';
import { PAN_SLOP, panStarted, panTo } from './pan';
import type { PanOrigin } from './pan';

/**
 * 沒有任何欄位被拖曳掀開。**一個模組層級的常數而不是每次 `new Set()`** ——
 * 每次拖曳結束都放一個新的空集合進 state，等於每次放手都重繪八欄，而
 * 「掀開的是哪幾欄」根本沒變。
 */
const NONE: ReadonlySet<Status> = new Set();

/** 按著左鍵的那一隻指標，以及它有沒有已經走過門檻。 */
interface PanGesture extends PanOrigin {
  /** 只跟著這一隻指標走 —— 第二隻手指按下去不該接管別人的平移。 */
  readonly pointerId: number;
  /** 走過 `panStarted` 的門檻、指標已經抓住了嗎。 */
  started: boolean;
}

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
  /**
   * 勾起來的 Label。**多選之間是 AND**（`board/filter.ts`）。
   *
   * **刻意不進 `localStorage`**（D12）—— 折疊與主題該記住，這一個不該：一個活過
   * 重新整理、又把 Issue 藏起來的篩選器，是讓人以為自己弄丟資料的最快方法。
   * 折起來的欄位還看得到欄名，被篩掉的那張則是整個不見了。
   */
  const [selectedLabels, setSelectedLabels] = useState<readonly string[]>([]);
  /**
   * 使用者折起來的欄位。**這一份是偏好，記在 `localStorage`**（D11：只影響這台
   * 機器上這個人怎麼看，不進 op-log），開場讀一次，預設全展開。讀壞了退回空
   * 集合而不是拋 —— 那條規則在 `@/prefs`，有測試。
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<Status>>(() =>
    readCollapsed(window.localStorage),
  );
  /**
   * 這次拖曳掀開的欄位。**與偏好分開的第二份**：折起來的欄位照樣收得下卡片，
   * 但使用者得看得到自己放進去的東西掉在哪，所以拖曳指過去時要暫時展開 ——
   * 而放開之後那一欄要照樣折回去，偏好一格都不能動。
   */
  const [revealed, setRevealed] = useState<ReadonlySet<Status>>(NONE);
  /**
   * 那個橫向捲動的容器。八欄加間距超過 2100px，多數筆電放不下，於是右邊幾欄
   * 在畫面外 —— 平移與拖曳自動捲動動的都是這一個節點的 `scrollLeft`。
   */
  const scroller = useRef<HTMLDivElement>(null);
  /**
   * 這次按著的那一隻指標。**放 ref 而不是 state**：一次平移是每一格指標移動改一次
   * `scrollLeft`，走 state 等於每個 frame 重繪八欄，而畫面上會動的只有捲動位置
   * ——瀏覽器自己就會畫。
   */
  const pan = useRef<PanGesture | null>(null);
  /**
   * 真的在平移了。**這一格值得一次重繪**：它只換游標，而游標是 CSS，非得經過
   * React 不可。一次平移總共重繪兩次（開始與結束）。
   */
  const [panning, setPanning] = useState(false);

  const sensors = useSensors(
    // 門檻讓「點一下開細節」與「拖走」分得開。**與空白處平移共用同一個常數**
    // （`pan.ts` 的 `PAN_SLOP`）—— 兩邊問的是同一件事，而分歧的樣子是同樣穩的
    // 一下按得動卡片、按不動欄頂的 `+`。抄一個字面量的話沒有東西擋得住那件事。
    useSensor(PointerSensor, { activationConstraint: { distance: PAN_SLOP } }),
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
  // **第二個、獨立的維度**：Label 篩選與「顯示已封存」套的是同一份 `issues`，
  // 兩者不互相折進對方。分成兩步是為了算得出「Label 現在藏了幾張」—— 那個數字
  // 是這張票的驗收條件（D12），而合成一次 filter 就再也分不出哪一張是誰藏的。
  const shown = visible.filter((i) => matchesLabels(i.shown, selectedLabels));
  // 面板列的 Label 對**整份投影**算，不是對 `shown`：否則勾了一個之後面板自己
  // 會縮到只剩與它共存的那幾個，而使用者正要在同一個面板上勾第二個。
  const labels = allLabels(issues.map((i) => i.shown));
  const byStatus = groupByStatus(shown, (i) => i.shown.status);
  // 畫面上現在真的折著的是哪幾欄：偏好扣掉這次拖曳掀開的（`collapse.ts`）。
  const foldedNow = collapsedNow(collapsed, revealed);
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

  /**
   * 折疊一欄或把它打開。**寫進 `localStorage` 與更新 state 在同一個地方**，
   * 走的是 `ThemeToggle` 的同一條路（`prefs.ts` 的另一個使用者）。
   *
   * 不在 `setCollapsed` 的 updater 裡寫 storage：那個 function 會被 React 呼叫
   * 不只一次（StrictMode 會刻意重跑它），而 updater 應該是純的。
   */
  function toggleColumn(status: Status): void {
    const next = toggleCollapsed(collapsed, status);
    writeCollapsed(window.localStorage, next);
    setCollapsed(next);
  }

  /** 規則在 `filter.ts` 的 `toggleLabel`，這裡只是把它接上 state。 */
  function onToggleLabel(label: string): void {
    setSelectedLabels((s) => toggleLabel(s, label));
  }

  /**
   * 拖曳指到的欄位換了。折起來的那一欄要**暫時掀開** —— 而且掀開之後在這次
   * 拖曳結束之前不再收回（`collapse.ts` 的 `revealOver` 寫著為什麼）。
   */
  function handleDragOver(event: DragOverEvent): void {
    setRevealed((r) => revealOver(r, statusOf(event.over)));
  }

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
    // 掀開的欄位全部收回去 —— 折疊偏好本身從頭到尾沒被碰過。
    setRevealed(NONE);
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
    setRevealed(NONE);
    onRelease();
  }

  /**
   * 在欄位之間的空白按下左鍵 —— 記下起點，但**先不動**。
   *
   * 真的開始平移是在 `handlePanMove` 裡走過門檻之後（`pan.ts` 的 `panStarted`）：
   * 捲動容器裡面還有欄頂的 `+` 與八顆折疊鈕，按下去就抓住指標的話那些按鈕會
   * 永遠按不動。
   */
  function handlePanDown(event: React.PointerEvent<HTMLDivElement>): void {
    const el = scroller.current;
    if (el === null) return;
    // 只收主要指標的左鍵：右鍵是選單，中鍵是瀏覽器自己那套捲動。
    if (!event.isPrimary || event.button !== 0) return;
    // 觸控本來就會用手指推著捲，兩份一起動的話一次會走兩倍遠。
    if (event.pointerType !== 'mouse') return;
    const target = event.target;
    // **卡片上按下去是要拖那張卡片，不是拉看板。** 卡片自己是 draggable，門檻
    // 4px 的 `PointerSensor`（見上面的 sensors）；兩邊都接的話卡片跟著手走、
    // 看板也跟著手走。`data-issue` 是卡片既有的屬性（`focus.ts` 靠它找卡片），
    // 不必為了這件事再加一個記號。
    if (!(target instanceof Element) || target.closest('[data-issue]') !== null) return;
    pan.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      scrollLeft: el.scrollLeft,
      started: false,
    };
  }

  /** 拉著走。走過門檻的那一下才抓指標、才換游標。 */
  function handlePanMove(event: React.PointerEvent<HTMLDivElement>): void {
    const gesture = pan.current;
    const el = scroller.current;
    if (gesture === null || el === null || event.pointerId !== gesture.pointerId) return;
    // 左鍵已經放掉了 —— 那次 `pointerup` 沒有回到這裡（門檻還沒過、指標也還沒
    // 抓住時，放在容器外面就收不到）。丟掉那次手勢，否則接下來只是把滑鼠移過
    // 看板，看板就會自己跟著跑。
    if ((event.buttons & 1) === 0) {
      pan.current = null;
      return;
    }

    if (!gesture.started) {
      if (!panStarted(gesture, event.clientX)) return;
      gesture.started = true;
      // 抓住指標有兩個作用：拉出容器（甚至拉出視窗）之後還收得到移動，而且
      // 這一下的 `click` 會改派到容器上 —— 放手時停在哪張卡片上都不會開 drawer。
      el.setPointerCapture(event.pointerId);
      setPanning(true);
    }
    el.scrollLeft = panTo(gesture, event.clientX);
  }

  /**
   * 放手（或指標被系統收走）。**不自己 `releasePointerCapture`** —— `pointerup`
   * 之後瀏覽器本來就會隱式釋放，而搶在 `click` 之前手動放掉，正好會讓上面那句
   * 「click 改派到容器」失效。
   */
  function handlePanEnd(event: React.PointerEvent<HTMLDivElement>): void {
    const gesture = pan.current;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    pan.current = null;
    if (gesture.started) setPanning(false);
  }

  return (
    <main
      className="flex h-full flex-col gap-3 p-4 outline-none"
      data-slot="board"
      // 焦點的最後退路（`focus.ts`）：對話框關掉時那張 Issue 已經不在畫面上
      // （被 archived 篩掉、從快照消失）就 focus 到這裡。`-1` 是「程式可以給它
      // 焦點，但 Tab 不會停在這」。
      tabIndex={-1}
      // 這個 landmark 一定要有可及名稱，因為焦點**會**退回它，而且正是在最需要
      // 交代狀況的時候：那張 Issue 剛從看板上消失了。沒有名稱時 screen reader
      // 唸到的只有「main」，使用者不知道自己被丟到哪裡。`data-slot` 是給 CSS
      // 與測試看的，輔助技術讀不到它。
      aria-label="Nook board"
    >
      {/* 整條 header 在 `BoardHeader.tsx` —— B5 與 B6 都還要往上加東西，而這個
          檔案已經是 DndContext 的持有者。 */}
      <BoardHeader
        info={info}
        visibleCount={shown.length}
        archivedCount={archivedCount}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        labels={labels}
        selectedLabels={selectedLabels}
        onToggleLabel={onToggleLabel}
        onClearLabels={() => setSelectedLabels([])}
        // 只算 Label 這一刀藏掉的：被封存藏起來的那些由「顯示已封存（N）」
        // 自己交代。兩個維度各自說自己藏了什麼。
        hiddenByLabel={visible.length - shown.length}
        onCreate={onCreate}
      />

      {/*
        **拖曳自動捲動用 `@dnd-kit` 的預設值，這裡刻意沒有 `autoScroll` 設定。**
        它找得到下面那個 `overflow-x-auto` 的 div（`useScrollableAncestors` 從被拖
        的那張卡片往上找），實測：900px 視窗、八欄共 2132px，把 backlog 的卡片
        拖到右緣按著不動，0.75 秒內 `scrollLeft` 從 0 走到底 1264，`cancelled`
        接著就是 drop target。預設的 threshold 0.2 與 acceleration 10 在這個版面
        上是夠的，調它只會讓行為離 dnd-kit 的文件更遠。
      */}
      <DndContext
        sensors={sensors}
        collisionDetection={boardCollision}
        accessibility={{ announcements, screenReaderInstructions: { draggable: dragInstructions } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={scroller}
          onPointerDown={handlePanDown}
          onPointerMove={handlePanMove}
          onPointerUp={handlePanEnd}
          onPointerCancel={handlePanEnd}
          // 指標被別人搶走（或隱式釋放）也要收尾，否則游標會一直卡在 grabbing。
          onLostPointerCapture={handlePanEnd}
          className={cn(
            // `relative` 是空看板那段話的定位基準（`EmptyBoard`）—— 它要對齊
            // 欄位帶的中線，不是視窗的。
            'relative flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2',
            // 平移中的游標。**整個子樹一起換**：卡片自己是 `cursor-grab`，不蓋掉
            // 的話手拉過卡片上方時游標會變回「可以抓」，而那一刻抓著的是看板。
            // `select-none` 是同一件事的另一半 —— 拉過欄名時不該一路反白。
            panning && 'cursor-grabbing [&_*]:cursor-grabbing select-none',
          )}
        >
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
              collapsed={foldedNow.has(status)}
              onToggleCollapsed={() => toggleColumn(status)}
              onCreate={onCreate}
            />
          ))}

          {/*
            一張都沒有的看板。**條件是整份投影是空的**，不是「某一欄是空的」——
            被封存或被篩掉而看不見的那些不算沒有，那種情況 header 自己會說
            「顯示已封存（N）」。

            疊在欄位帶**裡面**（容器是 `relative`）而不是取代它：八欄是版面，
            它們照樣在，而這段話對齊的是欄位的中線而不是視窗的。
          */}
          {issues.length === 0 && <EmptyBoard />}
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

