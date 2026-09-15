import { useCallback, useState } from 'react';

import { DecisionApp } from '@/DecisionApp';
import { IssueApp } from '@/IssueApp';
import { readActiveView, writeActiveView } from '@/prefs';
import type { ActiveView } from '@/prefs';
import { Button } from '@/components/ui/button';

/**
 * SPA 的殼 —— 票 01 之後這裡不再是 composition root，是頂層視圖切換
 * （Issues／Decisions）加上**依偏好只掛載其中一個** composition root。
 *
 * **一次只掛一個，不是兩個都渲染、CSS 藏起一個**（spec.md Domain decisions）：
 * 兩份輪詢與兩份樂觀狀態同時活著，換來的是「沒人在看的那個視圖也每 2 秒打一次
 * 伺服器」——ADR-0002 的全量掃描代價不貴，但沒理由替不會被看見的畫面付這筆錢。
 * 切換的瞬間因此會有一次跟開場一樣的載入骨架，這是刻意接受的代價。
 *
 * **這個檔案沒有自動化測試**（spec.md：React 組件不寫測試）。可判定的邏輯
 * （偏好讀寫）在 `prefs.ts`，那裡有測試；這裡只剩接線與版面。
 */
export function App(): React.JSX.Element {
  // 開場讀一次 localStorage——同 `ThemeToggle.tsx` 的 `storedTheme` 既有模式。
  const [view, setView] = useState<ActiveView>(() => readActiveView(window.localStorage));

  const switchTo = useCallback((next: ActiveView) => {
    setView(next);
    writeActiveView(window.localStorage, next);
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <div
        role="tablist"
        aria-label="Nook views"
        className="flex shrink-0 items-center gap-1 border-b px-3 py-2"
      >
        <Button
          type="button"
          role="tab"
          aria-selected={view === 'issues'}
          variant={view === 'issues' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => switchTo('issues')}
        >
          Issues
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={view === 'decisions'}
          variant={view === 'decisions' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => switchTo('decisions')}
        >
          Decisions
        </Button>
      </div>

      <div className="min-h-0 flex-1">{view === 'issues' ? <IssueApp /> : <DecisionApp />}</div>
    </div>
  );
}
