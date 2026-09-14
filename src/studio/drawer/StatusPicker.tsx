import { ChevronDownIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Status } from '@/api';
import { STATUS_ORDER } from '@/statuses';
import { statusChange } from './changes';
import type { DrawerChange } from './changes';

export interface StatusPickerProps {
  readonly status: Status;
  /** 這個值還在飛（尚未被伺服器確認）。 */
  readonly pending: boolean;
  readonly onSubmit: (change: DrawerChange | undefined) => boolean;
}

/**
 * Status 選單。挑一個就送出去，八個 Status 走同一條路。
 *
 * 這裡曾經多一塊只為 `blocked` 存在的介面：選到它會先展開一個輸入框問卡住的
 * 原因，填了才送得出去。那條規則整條拿掉了（ADR-0003 已改寫）—— `blocked`
 * 就只是一個 Status，不該帶有額外效果。要說明原因的人照樣可以留 Comment，
 * 那是 drawer 上本來就有的一格。
 */
export function StatusPicker({ status, pending, onSubmit }: StatusPickerProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">status</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="font-mono">
            {status}
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={status}
            // value 來自下面那份 STATUS_ORDER，不可能是別的東西。
            onValueChange={(value) => onSubmit(statusChange(value as Status, status))}
          >
            {STATUS_ORDER.map((s) => (
              <DropdownMenuRadioItem key={s} value={s} className="font-mono">
                {s}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {pending ? <span className="text-muted-foreground text-xs">Sending…</span> : null}
    </div>
  );
}
