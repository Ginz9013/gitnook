/**
 * 第一份 Decisions 快照還沒到的那一刻 —— 同 `board/BoardSkeleton.tsx` 的理由：
 * 已經知道的版面（header 的位置、幾列佔位的清單項）先畫出來，資料到達時只有
 * 內容換掉，版面不跳。
 *
 * **這裡沒有自動化測試**（spec.md：React 組件不寫測試）。沒有 props、沒有
 * state、沒有分支。
 */
export function DecisionListSkeleton(): React.JSX.Element {
  return (
    <main
      className="flex h-full flex-col gap-3 p-4"
      aria-busy="true"
      aria-label="Nook decisions (loading)"
    >
      <div aria-hidden className="flex shrink-0 items-center justify-between">
        <div className="bg-muted h-6 w-40 animate-pulse rounded" />
        <div className="bg-muted h-8 w-32 animate-pulse rounded-md" />
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="bg-card animate-pulse rounded-md border p-3 shadow-xs">
            <div className="bg-muted h-2.5 w-16 rounded" />
            <div className="bg-muted mt-2 h-3 w-2/3 rounded" />
          </li>
        ))}
      </ul>
    </main>
  );
}
