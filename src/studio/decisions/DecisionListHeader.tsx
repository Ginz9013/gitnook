import { ListFilter, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * 四個固定 Disposition，字面照抄 core 的 `DISPOSITIONS`
 * （`core/decisionTypes.ts`）。**這裡不 import 那份常數**——那會是第一個從
 * core 進 studio bundle 的值 import（同 `statuses.ts` 的 `STATUS_ORDER` 對
 * `STATUSES` 的既有規則：Vite 不會把 repo 的 `.js` specifier 重新對應到
 * `.ts`，build 當場就壞，ADR-0008）。四個值本身極少變動，值得為了那道守衛
 * 付第二份抄寫的代價。
 */
const DISPOSITIONS = ['proposed', 'accepted', 'superseded', 'rejected'] as const;

/**
 * Decisions 扁平清單最上面那一條 —— 這一票只有 disposition 篩選，**沒有
 * 新增入口**（那是票 02 的範圍，spec.md 的票面）。
 *
 * **這裡沒有自動化測試**（spec.md：React 組件不寫測試）。可判定的規則
 * （哪些筆數中選）在 `decisions/filter.ts`，那裡有測試。
 */
export interface DecisionListHeaderProps {
  /** 目前選中的 disposition，`undefined` = 不篩選（全部）。 */
  readonly disposition: string | undefined;
  readonly onChangeDisposition: (disposition: string | undefined) => void;
  /** 現在畫得出來的筆數 —— 已經套過篩選的那一份。 */
  readonly visibleCount: number;
}

export function DecisionListHeader({
  disposition,
  onChangeDisposition,
  visibleCount,
}: DecisionListHeaderProps): React.JSX.Element {
  const filtering = disposition !== undefined;

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b p-3">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-tight">Decisions</h1>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">{visibleCount} decisions</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filtering ? 'default' : 'ghost'}
                size="sm"
                aria-label={filtering ? `Filter by disposition, filtering: ${disposition}` : 'Filter by disposition'}
              >
                <ListFilter aria-hidden className="size-4" />
                Filter
                {filtering && `（${disposition}）`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filter by disposition</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={disposition ?? 'all'}
                onValueChange={(value) => onChangeDisposition(value === 'all' ? undefined : value)}
              >
                <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                {DISPOSITIONS.map((d) => (
                  <DropdownMenuRadioItem key={d} value={d}>
                    {d}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {filtering && (
        <div
          role="status"
          className="border-primary bg-primary/10 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-sm"
        >
          <ListFilter aria-hidden className="text-primary size-4 shrink-0" />
          <span className="font-medium">Filtering</span>
          <span>
            with <span className="font-mono font-semibold">{disposition}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => onChangeDisposition(undefined)}
          >
            <X aria-hidden className="size-4" />
            Clear filter
          </Button>
        </div>
      )}
    </header>
  );
}
