import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Status } from '@/api';
import { STATUSES, needsReason, statusChange } from './pending';
import type { DrawerChange } from './pending';

export interface StatusPickerProps {
  readonly status: Status;
  /** 這個值還在飛（尚未被伺服器確認）。 */
  readonly pending: boolean;
  readonly onSubmit: (change: DrawerChange | undefined) => boolean;
}

/**
 * Status 選單，外加「改成 blocked 要當場給理由」那條規則的介面。
 *
 * 理由與 status 進同一份 Change，因此是同一次 append —— 不會出現「已經
 * blocked 但沒有人知道為什麼」的中間狀態，那正是 CONTEXT.md 要那則 comment
 * 的原因（卡住前在做什麼，在扁平 Status 中會遺失）。
 */
export function StatusPicker({ status, pending, onSubmit }: StatusPickerProps): React.JSX.Element {
  // 已經選好、但還在等理由的那個 status。null 表示沒有人在等。
  const [asking, setAsking] = useState<Status | null>(null);
  const [reason, setReason] = useState('');

  function pick(value: string): void {
    // value 來自下面那份 STATUSES，不可能是別的東西。
    const next = value as Status;
    if (needsReason(next, status)) {
      setAsking(next);
      setReason('');
      return;
    }
    setAsking(null);
    onSubmit(statusChange(next, status, ''));
  }

  const ready = asking !== null && statusChange(asking, status, reason) !== undefined;

  return (
    <div className="flex flex-col gap-2">
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
            <DropdownMenuRadioGroup value={status} onValueChange={pick}>
              {STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s} className="font-mono">
                  {s}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {pending ? <span className="text-muted-foreground text-xs">送出中…</span> : null}
      </div>

      {asking === null ? null : (
        <div className="border-muted flex flex-col gap-2 rounded-md border border-dashed p-2">
          <label className="text-xs" htmlFor="blocked-reason">
            改成 <span className="font-mono">blocked</span> 要同時說明原因（會成為一則 comment）
          </label>
          <Textarea
            id="blocked-reason"
            autoFocus
            rows={3}
            value={reason}
            placeholder="卡在哪裡？"
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!ready}
              onClick={() => {
                if (asking !== null && onSubmit(statusChange(asking, status, reason))) {
                  setAsking(null);
                  setReason('');
                }
              }}
            >
              改成 blocked
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
