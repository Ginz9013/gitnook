/**
 * 對話框關閉之後，鍵盤焦點回哪裡。
 *
 * **為什麼需要這個模組。** Radix 的 modal Dialog 關閉時做的事是「把焦點交給
 * `<Dialog.Trigger>`」（`react-dialog` 的 `onCloseAutoFocus` 內建處理），而
 * studio 裡兩個對話框都是**受控開啟、沒有 Trigger** 的：drawer 由 `selectedId`
 * 決定，blocked 閘門由放手的那一刻決定。沒有 Trigger 時那句話等於「把焦點交給
 * null」，`document.activeElement` 於是落回 `<body>` —— 鍵盤使用者在看板上失去
 * 自己的位置，下一次 Tab 從整份文件的開頭重來。**這不是可以靠不傳 prop 就交給
 * Radix 處理的情況：它的預設行為在這裡就是壞的。**
 *
 * **決定：焦點跟著 Issue 走，不跟著 DOM 節點走。**
 * 使用者在意的是那張 Issue（他剛拖的那一張、他剛打開細節的那一張），而不是某個
 * DOM 節點，也不是某一欄。理由有二：
 *
 * 1. 節點靠不住 —— 改了 Status 之後那張卡片就換了一欄，React 把舊節點拆掉重建，
 *    任何在開啟當下記下來的參照都已經從 document 上脫落，focus() 到它是無聲的
 *    no-op（正是掉回 `<body>` 的另一條路徑）。
 * 2. 卡片是最能回答「我剛做的事成功了嗎」的落點：焦點停在那張 Issue 現在所在的
 *    位置，等於同時把「它移到 blocked 了」念給 screen reader 聽。
 *
 * 那張 Issue 已經不在看板上（被 archived 篩掉、或已從快照消失）時退回看板容器
 * —— 最後一道防線，至少焦點還在看板裡而不是文件開頭。
 *
 * 唯一擁有 `data-issue` / `data-slot="board"` 這兩個 DOM 慣例的地方就是這裡加上
 * `Card.tsx`、`Board.tsx`：查詢與標記不分家，兩邊才不會各自漂走。
 */

/** 看板容器 —— `Board` 的 `<main>`，帶著 `tabIndex={-1}` 才收得下程式化的焦點。 */
const BOARD = '[data-slot="board"]';

/**
 * 把鍵盤焦點放到這張 Issue 的卡片上；卡片不在畫面上就退回看板容器。
 *
 * 查詢在**呼叫的當下**做，不是事先記住一個節點：呼叫點都在對話框關閉之後，
 * 那時 React 已經把卡片重新畫到它新的欄位裡了。
 */
export function focusIssue(id: string): void {
  const card = document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(id)}"]`);
  if (card !== null) {
    card.focus();
    return;
  }
  focusBoard();
}

export function focusBoard(): void {
  document.querySelector<HTMLElement>(BOARD)?.focus();
}
