import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { IssueView } from '@/api';

/**
 * Drawer 的插槽。**這是票 07 要填的空殼** —— 欄位編輯、留言、label 增減、
 * 以及「拖進 blocked 要配一則留言」的配對責任都在那張票。這裡只把 Radix
 * Dialog 為底的 Sheet 接起來（ADR-0008：不裝 vaul），介面定死，票 07 因此
 * 只需要改本目錄底下的檔案。
 */
export interface IssueDrawerProps {
  /** 目前開著的那一張；null 表示關著。 */
  readonly issue: IssueView | null;
  readonly onClose: () => void;
}

export function IssueDrawer({ issue, onClose }: IssueDrawerProps): React.JSX.Element {
  return (
    <Sheet open={issue !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" data-slot="issue-drawer">
        <SheetHeader>
          <SheetTitle>{issue?.title ?? ''}</SheetTitle>
        </SheetHeader>
        <div className="px-4 text-muted-foreground text-sm">drawer 尚未實作（票 07）。</div>
      </SheetContent>
    </Sheet>
  );
}
