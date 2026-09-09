import { useCallback, useEffect, useState } from 'react';

import { Board } from '@/board/Board';
import { IssueDrawer } from '@/drawer/IssueDrawer';
import { fetchBoard } from '@/api';
import type { BoardSnapshot, Status } from '@/api';

/**
 * SPA 的殼裡唯一的組件。它做三件事，而且只做這三件：
 * 抓快照、記住 drawer 開在哪一張、把兩個插槽接起來。
 *
 * 看板（票 06）與 drawer（票 07）各自住在自己的目錄裡，介面在
 * `BoardProps` 與 `IssueDrawerProps` —— **那兩張票不需要動這個檔案**。
 * 輪詢與樂觀更新的調和是票 05，它會換掉這裡的 `snapshot` 由誰產生，
 * 兩個插槽的介面不受影響。
 */
export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetchBoard(abort.signal).then(setSnapshot, (err: unknown) => {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    });
    return () => abort.abort();
  }, []);

  const onMove = useCallback((_id: string, _status: Status) => {
    // 票 05 接上：POST 到 /i/<ref>（票 03）並把飛行中的變更交給調和 reducer
    // （票 02）。在那之前，拖曳在 UI 上不會有效果 —— 假裝成功比沒有更糟。
  }, []);

  if (error !== null) {
    return (
      <main className="p-4">
        <p className="text-destructive text-sm">讀不到 board：{error}</p>
      </main>
    );
  }

  if (snapshot === null) {
    return (
      <main className="p-4">
        <p className="text-muted-foreground text-sm">載入中…</p>
      </main>
    );
  }

  const selected = snapshot.issues.find((i) => i.id === selectedId) ?? null;

  return (
    <>
      <Board
        issues={snapshot.issues}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={onMove}
      />
      <IssueDrawer issue={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
