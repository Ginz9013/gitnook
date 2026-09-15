import * as React from 'react';
import { PanelLeftIcon } from 'lucide-react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn 的 Sidebar，**改寫過的一份，不是原樣抄**——理由記在這裡，改別的
 * 專案時不要照抄回去：
 *
 * 1. **沒有手機版的 Sheet 變體。** studio 只綁 loopback，是本機瀏覽器工具
 *    （ADR-0007），不是要拿去手機瀏覽的頁面；`useIsMobile` 與行動裝置的
 *    覆蓋層分支整段拿掉，收合永遠是「窄成一排圖示」，不是「整個蓋住畫面」。
 * 2. **不用 `fixed`／`inset-y-0` 把自己釘死在整個視窗高度。** shadcn 原本假設
 *    Sidebar 是版面最外層、佔滿整個 viewport；這裡它嵌在 `MainHeader` 底下
 *    （`App.tsx`），只佔剩下的那一段高度，所以改成一般的 flex 子項
 *    （`h-full`），寬度變化直接靠 `transition-[width]`，不需要 shadcn 那個
 *    「先留一塊透明的 gap、再疊一層 fixed 的容器」的動畫手法——那個手法存在
 *    的理由（overlay 不擠壓旁邊的內容）在一般 flex 版面裡不成立，硬套只會
 *    讓版面演算法更難懂。
 * 3. **顏色沿用既有的 token（`bg-card`／`border`／`bg-accent`），不新開一組
 *    `--sidebar-*` 變數。** 這個專案的調色盤刻意收得很窄（`index.css` 的
 *    註解：每加一個 token 就多一個要顧對比度的地方），Sidebar 不是一個
 *    需要自己配色的獨立表面，跟卡片、popover 共用同一階調色足夠分得清楚。
 * 4. **`SidebarInset` 是 `<div>`，不是 `<main>`。** shadcn 原本讓它當
 *    `<main>`，但這個 repo 的內容區塊自己已經有 `<main>`（`Board.tsx`／
 *    `DecisionApp.tsx`，各自帶 `aria-label`）——兩層 `<main>` 對螢幕閱讀器
 *    是兩個一樣的「跳到主要內容」路徑，`BoardHeader.tsx` 的既有註解已經為了
 *    同一個理由拒絕過一次多餘的 landmark。
 * 5. **只保留 `collapsible="icon"` 這一種模式**、只有 `side="left"`——
 *    這批只需要一個固定在左邊、可以收成一排圖示的導覽，`offcanvas`／
 *    `floating`／`inset` 這些變體、`side="right"` 都是目前沒有呼叫端的
 *    Speculative Generality，不預先做。
 *
 * 開合狀態的持久化**不在這個檔案裡**——`SidebarProvider` 維持 shadcn 原本
 * 的 controlled/uncontrolled 雙模式（`open`/`onOpenChange`/`defaultOpen`），
 * 讀寫 `localStorage` 是呼叫端（`App.tsx`）的事，同 `prefs.ts` 既有的
 * `readSidebarOpen`/`writeSidebarOpen`。shadcn 原版用 cookie 存這一格是為了
 * SSR 第一幀就對；這裡沒有 SSR，沿用 cookie 只是多一種不必要的持久化機制。
 *
 * **這裡沒有自動化測試**（spec.md 的測試策略：React 組件不寫測試）。
 */

const SIDEBAR_WIDTH = '15rem';
const SIDEBAR_WIDTH_ICON = '3rem';
/** `Cmd/Ctrl+B` 切換開合——同 shadcn 原版的既有快捷鍵，習慣了不必重學。 */
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

interface SidebarContextProps {
  readonly state: 'expanded' | 'collapsed';
  readonly open: boolean;
  readonly toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar(): SidebarContextProps {
  const context = React.useContext(SidebarContext);
  if (context === null) throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  readonly defaultOpen?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;

  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const next = typeof value === 'function' ? value(open) : value;
      if (setOpenProp) setOpenProp(next);
      else setUncontrolledOpen(next);
    },
    [setOpenProp, open],
  );

  const toggleSidebar = React.useCallback(() => setOpen((v) => !v), [setOpen]);

  useKeyboardShortcut(toggleSidebar);

  const state = open ? 'expanded' : 'collapsed';

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({ state, open, toggleSidebar }),
    [state, open, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={{
            '--sidebar-width': SIDEBAR_WIDTH,
            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties}
          className={cn('flex min-h-0 w-full flex-1', className)}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

/** `Cmd`（Mac）／`Ctrl`（其他平台）+B。抽成一個 hook 只是為了讓 `SidebarProvider` 本體短一點。 */
function useKeyboardShortcut(toggleSidebar: () => void): void {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);
}

function Sidebar({ className, children, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  const { state } = useSidebar();

  return (
    <div
      data-slot="sidebar"
      data-state={state}
      // `group`：收合時要隱藏的東西（選單文字標籤）用 `group-data-[state=…]`
      // 認這個祖先的狀態，不必每個呼叫端自己接 `useSidebar()` 再判斷一次。
      className={cn(
        'group bg-card text-card-foreground flex h-full shrink-0 flex-col overflow-hidden border-r transition-[width] duration-200 ease-linear',
        state === 'expanded' ? 'w-(--sidebar-width)' : 'w-(--sidebar-width-icon)',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** 收合／展開的觸發鈕——放在 `SidebarHeader` 裡，兩種狀態下都按得到。 */
function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>): React.JSX.Element {
  const { toggleSidebar, state } = useSidebar();

  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn('size-7', className)}
      aria-label={state === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'}
      onClick={toggleSidebar}
      {...props}
    >
      <PanelLeftIcon />
    </Button>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2', className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>): React.JSX.Element {
  return <ul data-slot="sidebar-menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>): React.JSX.Element {
  return <li data-slot="sidebar-menu-item" className={cn('group/menu-item relative', className)} {...props} />;
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none transition-[color,background-color] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      isActive: {
        true: 'bg-accent text-accent-foreground font-medium',
        false: 'hover:bg-accent hover:text-accent-foreground',
      },
    },
    defaultVariants: { isActive: false },
  },
);

interface SidebarMenuButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  /**
   * 收合成一排圖示時的提示文字，**也是收合時唯一的可及名稱**——文字標籤
   * 那時候用 `group-data-[state=collapsed]:hidden` 藏起來（呼叫端自己在
   * `children` 裡的 `<span>` 上加這個 class），按鈕因此不能只靠 `children`
   * 說出自己是什麼；Radix 的 Tooltip 只掛 `aria-describedby`（補充說明），
   * 不是名稱本身，所以這裡另外接一個 `aria-label`。
   */
  readonly tooltip: string;
}

function SidebarMenuButton({
  className,
  isActive,
  tooltip,
  ...props
}: SidebarMenuButtonProps): React.JSX.Element {
  const { state } = useSidebar();

  const button = (
    // **靠左，兩種狀態都一樣，不靠 `justify-center` 收合時再置中。**
    // 側欄收合是寬度上的 CSS transition（`Sidebar` 的 `w-(--sidebar-width)`
    // → `w-(--sidebar-width-icon)`），文字那個 `<span>` 則是瞬間
    // `display:none`，不參與這個 transition。置中會讓圖示的位置跟著「現在
    // 動畫跑到多寬」算出來的置中點走，於是收合過程中圖示看起來從中間滑向
    // 左邊；靠左則讓圖示從一開始就釘在左邊那個固定的 padding 位置，寬度
    // 怎麼變都不影響它，文字消失後圖示因此「本來就在對的地方」，沒有東西
    // 需要位移。
    <button
      data-slot="sidebar-menu-button"
      data-active={isActive}
      aria-label={state === 'collapsed' ? tooltip : undefined}
      className={cn(sidebarMenuButtonVariants({ isActive, className }))}
      {...props}
    />
  );

  // 展開時不必包 Tooltip——旁邊的文字自己就說完了。
  if (state === 'expanded') return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * 側欄旁邊、佔掉剩餘寬度的那一塊——內容本身（`MainHeader`／模組自己的
 * header／看板或清單）都畫在這裡面。
 *
 * **是 `<div>`，不是 `<main>`**——見本檔開頭的說明。
 */
function SidebarInset({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
};
