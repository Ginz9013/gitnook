/**
 * 一張 Issue 都沒有的看板 —— 疊在八欄之上的一段話。
 *
 * **八欄照樣在**：它們是版面，不是內容。空的看板拿掉欄位等於在使用者開第一張
 * Issue 之前先把畫面換成另一個樣子，開完之後再換回來。
 *
 * **兩條路都講。** header 那顆「新增 Issue」是這個畫面上的路，`nook new` 是
 * 終端機上的路 —— 而使用者很可能正是從 CLI 過來的（studio 是 `nook studio`
 * 開的）。只講按鈕，等於告訴一個手上開著終端機的人回頭找滑鼠。
 *
 * `pointer-events-none`：它蓋在整塊看板上，包括 header 那顆按鈕與八個欄頂的
 * `+`。**攔得住點擊的空狀態會攔掉它自己叫人去按的那顆按鈕。**
 *
 * **住在 `App.tsx` 的那一層而不是 `Board.tsx` 裡**（`fixed` 而不是 `absolute`）：
 * 這批票並行進行，`Board.tsx` 由另一張票持有。代價是它對齊的是視窗中央而不是
 * 欄位那條帶子的中央 —— 差的是 header 的高度。日後有人動 `Board.tsx` 時，
 * 把它移進欄位容器裡改成 `absolute inset-0` 就對齊了，這個組件本身不必改。
 *
 * **這裡沒有自動化測試**（spec.md：React 組件不寫測試）。沒有 props、沒有
 * state、沒有分支 —— 該不該畫它是呼叫端的一個 `length === 0`。
 */
export function EmptyBoard(): React.JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-6">
      <div className="bg-card text-card-foreground max-w-md rounded-lg border p-6 text-center shadow-lg">
        <p className="text-sm font-medium">這塊 board 還沒有任何 Issue</p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          按上面的「新增 Issue」開第一張，或在終端機跑{' '}
          <code className="text-foreground font-mono whitespace-nowrap">nook new &lt;標題&gt;</code>。
        </p>
      </div>
    </div>
  );
}
