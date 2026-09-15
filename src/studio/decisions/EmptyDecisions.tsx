/**
 * 一筆 Decision 都沒有的清單 —— 同 `board/EmptyBoard.tsx` 的理由：用講的，
 * 不畫一片空表格。
 *
 * **這裡沒有自動化測試**（spec.md：React 組件不寫測試）。沒有 props、沒有
 * state、沒有分支 —— 該不該畫它是呼叫端的一個 `length === 0`。
 *
 * 新增入口是票 02 的範圍，這裡因此不提「按這裡新增」——那個按鈕這一批還不存在。
 */
export function EmptyDecisions(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="bg-card text-card-foreground max-w-md rounded-lg border p-6 text-center shadow-lg">
        <p className="text-sm font-medium">No decisions yet</p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Run <code className="text-foreground font-mono whitespace-nowrap">nook decision new &lt;title&gt;</code>{' '}
          in the terminal to record the first one.
        </p>
      </div>
    </div>
  );
}
