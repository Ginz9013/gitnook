import { ChevronDownIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Disposition } from '@/api';
import { dispositionChange } from './decisionChanges';
import type { DecisionDrawerChange } from './decisionChanges';

/**
 * 四個固定 Disposition，順序即畫面上的順序。**這裡自己抄一份，不
 * `import { DISPOSITIONS } from '../../core/decisionTypes.js'`** —— 那會是
 * 第一個從 core 進 studio bundle 的**值** import（同 `statuses.ts` 的
 * `STATUS_ORDER` 對 core `STATUSES` 的既有理由，ADR-0008）。只有這個組件
 * 用得到這份清單，因此不像 `STATUS_ORDER` 那樣抽成 `studio/` 底下共用的
 * 一個檔案 —— 那裡只有一個真正的呼叫端。
 */
const DISPOSITION_ORDER = ['proposed', 'accepted', 'superseded', 'rejected'] as const satisfies readonly Disposition[];

type MissingDisposition = Exclude<Disposition, (typeof DISPOSITION_ORDER)[number]>;
/** 成員必須恰好是四個 Disposition —— 少一個時這一行編不過（同 `statuses.ts` 的既有守衛）。 */
const _members: [MissingDisposition] extends [never] ? true : ['成員與 Disposition 不一致'] = true;
void _members;

export interface DispositionPickerProps {
  readonly disposition: Disposition;
  /** 這個值還在飛（尚未被伺服器確認）。 */
  readonly pending: boolean;
  readonly onSubmit: (change: DecisionDrawerChange | undefined) => boolean;
}

/**
 * Disposition 選單。比照 `StatusPicker.tsx` 的下拉選單節奏，挑一個就送出去，
 * 四個值走同一條路。
 *
 * **沒有任何值需要「選到就先問原因」的特例。** `StatusPicker.tsx` 那條規則
 * （改成 `blocked` 要先問卡住的原因）已經整條拿掉了（ADR-0003 已改寫），而
 * Disposition 從來沒有過這種東西 —— 四個值（`proposed`/`accepted`/
 * `superseded`/`rejected`）一視同仁，不要重新發明。
 */
export function DispositionPicker({
  disposition,
  pending,
  onSubmit,
}: DispositionPickerProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">disposition</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="font-mono">
            {disposition}
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={disposition}
            // value 來自上面那份 DISPOSITION_ORDER，不可能是別的東西。
            onValueChange={(value) => onSubmit(dispositionChange(value as Disposition, disposition))}
          >
            {DISPOSITION_ORDER.map((d) => (
              <DropdownMenuRadioItem key={d} value={d} className="font-mono">
                {d}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {pending ? <span className="text-muted-foreground text-xs">Sending…</span> : null}
    </div>
  );
}
