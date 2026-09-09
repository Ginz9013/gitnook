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
 * **這裡沒有自動化測試**（spec.md：React 組件不寫測試）。沒有 props、沒有
 * state、沒有分支 —— 該不該畫它是呼叫端的一個 `length === 0`。
 *
 * `absolute inset-0` 對齊的是**欄位帶**（`Board.tsx` 裡那個 `relative` 的捲動
 * 容器），不是視窗 —— 對齊視窗會讓這段話比欄位帶的中線高出半個 header。
 * 量過：1400px 視窗、空 board，欄位帶中心 524、這段話中心 517，差的 7px 是
 * 橫向捲軸的高度（八欄 2132px 一定溢出），不是定位錯誤。
 */
export function EmptyBoard(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
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
