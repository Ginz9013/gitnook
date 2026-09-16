import { useCallback, useEffect, useState } from 'react';
import { ListTodoIcon, ScrollTextIcon } from 'lucide-react';

import { DecisionApp } from '@/DecisionApp';
import { IssueApp } from '@/IssueApp';
import { readActiveView, readSidebarOpen, writeActiveView, writeSidebarOpen } from '@/prefs';
import type { ActiveView } from '@/prefs';
import { fetchBoardInfo } from '@/api';
import type { BoardInfo } from '@/api';
import { MainHeader } from '@/components/MainHeader';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

/**
 * SPA 的殼 —— 版面由上而下、由左而右：
 *
 * 1. **`MainHeader`（跨模組固定，滿版）**——logo、「Git Nook」、board 路徑/
 *    分支/actor、主題切換。不管現在切到哪個視圖都畫同一條，因此常駐在殼
 *    最上層，不受側欄收合影響。
 * 2. **側欄（可收合成一排圖示）**——視圖切換（Issues／Decisions），
 *    shadcn 的 Sidebar（`components/ui/sidebar.tsx`，這個 repo 改寫過的
 *    一份，理由見那個檔案開頭）。收合的意義：導覽本身不會擠壓右邊的內容
 *    寬度，比原本橫排的 Tabs 更省版面。
 * 3. **依偏好只掛載其中一個** composition root，畫在側欄旁邊的
 *    `SidebarInset` 裡——`IssueApp`／`DecisionApp` 自己的 header
 *    （`BoardHeader.tsx`／`DecisionListHeader.tsx`）住在這一層，只有屬於
 *    那個模組的功能。
 *
 * **一次只掛一個 composition root，不是兩個都渲染、CSS 藏起一個**
 * （spec.md Domain decisions）：兩份輪詢與兩份樂觀狀態同時活著，換來的是
 * 「沒人在看的那個視圖也每 2 秒打一次伺服器」——ADR-0002 的全量掃描代價
 * 不貴，但沒理由替不會被看見的畫面付這筆錢。切換的瞬間因此會有一次跟開場
 * 一樣的載入骨架，這是刻意接受的代價。
 *
 * **`BoardInfo` 在這裡自己抓一次，`IssueApp` 也還留著自己那一份。** 兩份
 * 讀的是同一個唯讀端點（`/api/board-info`，不進輪詢迴圈），重複一次開場的
 * GET 換來的是兩個 composition root 彼此不必知道對方存在——同這個殼一直
 * 以來的規則：`IssueApp`／`DecisionApp` 是各自獨立的 composition root，
 * 不共用樂觀狀態也不共用資料，`MainHeader` 需要 `info` 的理由（顯示路徑）
 * 跟 `IssueApp` 需要它的理由（`BoardHeader` 的健康警示）並不是同一件事。
 *
 * **這個檔案沒有自動化測試**（spec.md：React 組件不寫測試）。可判定的邏輯
 * （偏好讀寫）在 `prefs.ts`，那裡有測試；這裡只剩接線與版面。
 */
export function App(): React.JSX.Element {
  // 開場讀一次 localStorage——同 `ThemeToggle.tsx` 的 `storedTheme` 既有模式。
  const [view, setView] = useState<ActiveView>(() => readActiveView(window.localStorage));
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => readSidebarOpen(window.localStorage));
  // 還沒抓到就是 null——`MainHeader` 自己會少畫路徑那一行，不卡住畫面。
  const [info, setInfo] = useState<BoardInfo | null>(null);

  const switchTo = useCallback((next: ActiveView) => {
    setView(next);
    writeActiveView(window.localStorage, next);
  }, []);

  const onSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
    writeSidebarOpen(window.localStorage, open);
  }, []);

  // 開場抓一次，永遠不進輪詢迴圈——同 `IssueApp.tsx` 對 `fetchBoardInfo` 的
  // 既有理由：這個端點會 spawn 子行程，答案又幾乎不會變。抓不到就整條路徑
  // 資訊不畫，殼照常渲染。
  useEffect(() => {
    const abort = new AbortController();
    fetchBoardInfo(abort.signal).then(
      (fetched) => {
        if (!abort.signal.aborted) setInfo(fetched);
      },
      () => {
        // 見上：MainHeader 少一行，畫面照跑。
      },
    );
    return () => abort.abort();
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <MainHeader info={info} />

      <SidebarProvider open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
        <Sidebar>
          {/*
            `mt-1.5`：側欄這一列（`p-2`）跟旁邊 `BoardHeader`/
            `DecisionListHeader` 那一列（`p-3` + `h-8` 的按鈕列）天生不等
            高——後者的行高被裡面 `size="sm"` 的按鈕撐高，收合鈕自己只有
            `size-7`。這裡不改共用元件的預設 padding（收合成一排圖示時
            橫向空間只有 `size-7` 那麼寬，加不了 `p-3` 的橫向 padding），
            只補一點上緣間距讓兩邊視覺對齊。
          */}
          <SidebarHeader className="mt-1.5 flex-row items-center justify-between">
            <SidebarTrigger />
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  tooltip="Decisions"
                  isActive={view === 'decisions'}
                  onClick={() => switchTo('decisions')}
                >
                  <ScrollTextIcon aria-hidden />
                  <span className="group-data-[state=collapsed]:hidden">Decisions</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  tooltip="Issues"
                  isActive={view === 'issues'}
                  onClick={() => switchTo('issues')}
                >
                  <ListTodoIcon aria-hidden />
                  <span className="group-data-[state=collapsed]:hidden">Issues</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>

        <SidebarInset>{view === 'issues' ? <IssueApp /> : <DecisionApp />}</SidebarInset>
      </SidebarProvider>
    </div>
  );
}
