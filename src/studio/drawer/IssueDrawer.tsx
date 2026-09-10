import { useRef } from 'react';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { IssueView } from '@/api';
import type { ProjectedIssue } from '@/reconcile';
import { IssueDetail } from './IssueDetail';
import type { DrawerChange } from './changes';

/**
 * 點卡片開出來的詳情與內編輯面板。Radix Dialog 為底的 Sheet
 * （ADR-0008：**不裝 vaul**）。
 *
 * focus trap、`aria-modal`、scroll lock、Esc 關閉 —— 交給 Radix。手寫這些是
 * ADR-0008 願意接受這個相依的主要理由。
 *
 * **一個例外：關閉後的焦點。** 原本這裡連 `onCloseAutoFocus` 都不傳，寫著
 * 「關閉後把焦點還給觸發的元素也交給 Radix」。那句話是錯的，而且是在真的瀏覽器
 * 裡按 Esc 才看得出來錯：Radix 的 modal Dialog 關閉時做的事是
 * `context.triggerRef.current?.focus()`，而這個 drawer 由 `selectedId` 受控開啟、
 * **沒有 `<Dialog.Trigger>`** —— 於是那一行等於「把焦點交給 null」，
 * `document.activeElement` 掉回 `<body>`。不傳 prop 不是「交給 Radix」，
 * 是「接受一個對受控 Dialog 而言壞掉的預設」。見 `board/focus.ts`。
 */
export interface IssueDrawerProps {
  /**
   * 目前開著的那一張，**已經是調和過的投影**（快照 + 樂觀覆蓋）；null 表示關著。
   * 拖曳與 drawer 走同一份樂觀模型，所以這裡拿的跟看板上那張是同一個東西。
   */
  readonly issue: ProjectedIssue<IssueView> | null;
  readonly onClose: () => void;
  /**
   * 送出一份編輯。`undefined`（`changes.ts` 的規則判定「這一下沒有東西要送」）
   * 時什麼都不做並回傳 false —— 呼叫端用它決定要不要清空輸入框。
   *
   * **持有者是 `App`**：它同時擁有調和 reducer 與 `POST /i/<ref>`，drawer 這
   * 一側因此沒有自己的 pending 狀態可以跟看板分歧。
   */
  readonly onSubmit: (id: string, change: DrawerChange | undefined) => boolean;
  /**
   * 關閉之後鍵盤焦點要去哪，帶著剛才顯示的那張 Issue 的 id。
   *
   * drawer 不自己決定 —— 它不知道看板長什麼樣，也不該知道。它知道的只有
   * 「剛才在看的是哪一張 Issue」，而那正是這個決定唯一需要的輸入。
   */
  readonly onCloseFocus: (id: string) => void;
}

export function IssueDrawer({
  issue,
  onClose,
  onSubmit,
  onCloseFocus,
}: IssueDrawerProps): React.JSX.Element {
  // 關閉之後 Radix 還要放退場動畫，那段期間 issue 已經是 null。留住最後一張，
  // 否則 Sheet 會在動畫中途少掉 Title —— Radix 會抱怨對話框沒有可及名稱。
  const last = useRef<ProjectedIssue<IssueView> | null>(null);
  if (issue !== null) last.current = issue;
  const shown = issue ?? last.current;

  // 開啟時焦點的落點（見下面的 onOpenAutoFocus）。
  const panel = useRef<HTMLDivElement>(null);

  return (
    <Sheet
      open={issue !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        data-slot="issue-drawer"
        ref={panel}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          // Radix 的預設是「焦點給第一個可聚焦的元素」，在這個 drawer 裡那是
          // 標題輸入框 —— 於是每次點開卡片都變成「準備改標題」，而使用者多數
          // 時候只是想讀。改成把焦點放在面板本身（`tabIndex={-1}` 就是為了讓
          // 它收得下）：focus trap、Esc、Tab 的起點都還在 drawer 裡，但沒有
          // 任何輸入框被搶進編輯狀態。
          event.preventDefault();
          panel.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // 一律接手（見上）。`preventDefault` 擋掉的是 Radix 那句
          // `triggerRef.current?.focus()` —— `composeEventHandlers` 看到
          // `defaultPrevented` 就不再跑它內建的處理。
          event.preventDefault();
          if (shown !== null) onCloseFocus(shown.id);
        }}
        // 圓角只給左側兩角：drawer 貼著右緣、上下滿版，右邊兩角圓不起來（也
        // 沒有東西看得到它）。用 `rounded-l-lg`（`--radius`，0.625rem）——
        // 跟 AlertDialog、看板的欄位同一級，主題裡「一塊面板」就是這個圓角。
        // 寬度：桌面上固定佔螢幕的 2/5（`sm:max-w-none` 是為了解除 sheet.tsx
        // 那道 `sm:max-w-lg` 上限，否則 2/5 在寬螢幕上會被夾回 32rem）。窄螢幕
        // 維持 3/4 —— 2/5 在手機上放不下一行標題。
        // 關閉鈕跟著內距一起往內縮，才不會孤零零貼在角落。
        className="w-3/4 gap-4 rounded-l-lg overflow-y-auto sm:w-2/5 sm:max-w-none [&>[data-slot=sheet-close]]:top-8 [&>[data-slot=sheet-close]]:right-8"
      >
        {shown === null ? (
          <SheetHeader>
            <SheetTitle>Issue</SheetTitle>
          </SheetHeader>
        ) : (
          // key：換一張 issue 就把草稿（正在打字的標題、還沒送出的留言）整批
          // 丟掉 —— 它們屬於前一張。飛行中的樂觀編輯不在這裡，它在 App 的
          // reducer 上，換一張 issue 不會、也不該把它們扔掉。
          <IssueDetail key={shown.id} projected={shown} onSubmit={onSubmit} />
        )}
      </SheetContent>
    </Sheet>
  );
}
