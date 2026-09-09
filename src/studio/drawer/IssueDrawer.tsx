import { useRef } from 'react';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { IssueView } from '@/api';
import { IssueDetail } from './IssueDetail';

/**
 * 點卡片開出來的詳情與內編輯面板。Radix Dialog 為底的 Sheet
 * （ADR-0008：**不裝 vaul**）。
 *
 * focus trap、`aria-modal`、scroll lock、Esc 關閉、關閉後把焦點還給觸發的
 * 元素 —— **全部交給 Radix**，這個檔案裡一行都沒有。手寫這些是 ADR-0008
 * 願意接受這個相依的主要理由；在上面補一層自己的處理只會跟它打架
 * （所以刻意不傳 `onEscapeKeyDown` / `onCloseAutoFocus`）。
 */
export interface IssueDrawerProps {
  /** 目前開著的那一張；null 表示關著。 */
  readonly issue: IssueView | null;
  readonly onClose: () => void;
}

export function IssueDrawer({ issue, onClose }: IssueDrawerProps): React.JSX.Element {
  // 關閉之後 Radix 還要放退場動畫，那段期間 issue 已經是 null。留住最後一張，
  // 否則 Sheet 會在動畫中途少掉 Title —— Radix 會抱怨對話框沒有可及名稱。
  const last = useRef<IssueView | null>(null);
  if (issue !== null) last.current = issue;
  const shown = issue ?? last.current;

  return (
    <Sheet
      open={issue !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" data-slot="issue-drawer" className="gap-4 overflow-y-auto sm:max-w-xl">
        {shown === null ? (
          <SheetHeader>
            <SheetTitle>Issue</SheetTitle>
          </SheetHeader>
        ) : (
          // key：換一張 issue 就把飛行中的樂觀編輯整批丟掉 —— 它們屬於前一張。
          <IssueDetail key={shown.id} issue={shown} />
        )}
      </SheetContent>
    </Sheet>
  );
}
