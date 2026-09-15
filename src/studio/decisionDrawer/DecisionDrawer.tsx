import { useRef } from 'react';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DecisionView } from '@/api';
import type { ProjectedDecision } from '@/decisionReconcile';
import { DecisionDetail } from './DecisionDetail';
import type { DecisionDrawerChange } from './decisionChanges';

/**
 * 點清單開出來的詳情與內編輯面板。比照 `IssueDrawer.tsx` 的 Sheet 外殼 ——
 * Radix Dialog 為底（ADR-0008：**不裝 vaul**），focus trap、`aria-modal`、
 * scroll lock、Esc 關閉交給 Radix。
 *
 * **`onCloseAutoFocus` 一律接手，理由逐字同 `IssueDrawer.tsx`。** 這個
 * drawer 由 `selectedId` 受控開啟、沒有 `<Dialog.Trigger>`，Radix 的預設
 * 「關閉後把焦點交給 trigger」在這裡等於交給 `null`，`document.activeElement`
 * 會靜靜掉回 `<body>`——不傳這個 prop 不是「交給 Radix」，是接受一個對受控
 * Dialog 而言壞掉的預設。
 *
 * **退回的目標比 `IssueDrawer.tsx` 弱一截：只到視圖容器，不到那一列。**
 * `IssueDrawer.tsx` 接的是 `board/focus.ts` 的 `focusIssue`——Issue 的看板
 * 每張卡片有 `data-issue` 這個可以查到的焦點目標。Decision 的扁平清單
 * （`decisions/DecisionList.tsx`）還沒有對應的逐列焦點工具，而那個檔案不在
 * 這一批的寫入所有權裡，所以這裡只做得到 `focusBoard()` 那一半：焦點退回
 * `DecisionApp.tsx` 的 `[data-slot="decisions"]` 容器——至少留在這個視圖裡，
 * 不是掉回文件開頭。之後要補「回到剛編輯的那一列」，屬於 `decisions/` 那邊
 * 的後續。
 */
function focusDecisionsView(): void {
  document.querySelector<HTMLElement>('[data-slot="decisions"]')?.focus();
}
export interface DecisionDrawerProps {
  /**
   * 目前開著的那一筆，**已經是調和過的投影**（快照 + 樂觀覆蓋）；null 表示關著。
   * 同 `IssueDrawer.tsx` 的既有理由：drawer 與清單走同一份樂觀模型。
   */
  readonly decision: ProjectedDecision<DecisionView> | null;
  readonly onClose: () => void;
  /**
   * 送出一份編輯。`undefined`（`decisionChanges.ts` 的規則判定「這一下沒有
   * 東西要送」）時什麼都不做並回傳 false —— 呼叫端用它決定要不要清空輸入框。
   *
   * **持有者是 `DecisionApp`**：它同時擁有調和 reducer 與 `POST /d/<ref>`，
   * drawer 這一側因此沒有自己的 pending 狀態可以跟清單分歧。
   */
  readonly onSubmit: (id: string, change: DecisionDrawerChange | undefined) => boolean;
}

export function DecisionDrawer({ decision, onClose, onSubmit }: DecisionDrawerProps): React.JSX.Element {
  // 關閉之後 Radix 還要放退場動畫，那段期間 decision 已經是 null。留住最後
  // 一筆，否則 Sheet 會在動畫中途少掉 Title —— 同 `IssueDrawer.tsx` 的既有理由。
  const last = useRef<ProjectedDecision<DecisionView> | null>(null);
  if (decision !== null) last.current = decision;
  const shown = decision ?? last.current;

  // 開啟時焦點的落點（見下面的 onOpenAutoFocus）。
  const panel = useRef<HTMLDivElement>(null);

  return (
    <Sheet
      open={decision !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        data-slot="decision-drawer"
        ref={panel}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          // Radix 的預設是「焦點給第一個可聚焦的元素」，在這個 drawer 裡那是
          // 標題輸入框 —— 同 `IssueDrawer.tsx` 的既有理由：多數時候使用者
          // 只是想讀，不該每次點開就被推進編輯狀態。
          event.preventDefault();
          panel.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // 一律接手（見上面的模組註解）。`preventDefault` 擋掉的是 Radix 那句
          // `triggerRef.current?.focus()`。
          event.preventDefault();
          focusDecisionsView();
        }}
        // 圓角與寬度比照 `IssueDrawer.tsx`：貼著右緣、上下滿版、桌面固定佔
        // 螢幕的 2/5，窄螢幕維持 3/4，關閉鈕跟著內距一起往內縮。
        className="w-3/4 gap-4 rounded-l-lg overflow-y-auto sm:w-2/5 sm:max-w-none [&>[data-slot=sheet-close]]:top-8 [&>[data-slot=sheet-close]]:right-8"
      >
        {shown === null ? (
          <SheetHeader>
            <SheetTitle>Decision</SheetTitle>
          </SheetHeader>
        ) : (
          // key：換一筆 decision 就把草稿（正在打字的標題、還沒送出的
          // supersededBy）整批丟掉 —— 它們屬於前一筆。飛行中的樂觀編輯不在
          // 這裡，它在 App 的 reducer 上，換一筆不會、也不該把它們扔掉。
          <DecisionDetail key={shown.id} projected={shown} onSubmit={onSubmit} />
        )}
      </SheetContent>
    </Sheet>
  );
}
