import type { Status } from '@/api';

/**
 * 折疊集合的算術 —— 票 B3 裡可判定的那一小塊。
 *
 * **折疊有兩個來源，而它們的壽命不一樣**：使用者按下欄頭那顆切換鈕記在
 * `localStorage`（`@/prefs` 的 `readCollapsed`／`writeCollapsed`），一次拖曳掀開的
 * 則活在那次拖曳裡、放開就沒了。畫面上「這一欄現在折著嗎」是兩者的差集，而
 * 這個檔案就是那三條規則。
 *
 * 住在這裡而不是 `Board.tsx`：那樣才測得到（`test/studio/collapse.test.ts`），
 * 同 `board/path.ts`。剩下的折疊（40px 的直立條、`writing-mode`、切換鈕）是版面，
 * React 組件不寫測試（spec.md 的測試策略），所以能推出來的規則要推出來。
 */

/**
 * 一欄的折疊開關。**永遠回一個新的 Set。**
 *
 * 就地 `add`／`delete` 再把同一個 Set 交回 React 的話，`useState` 看到的是同一個
 * 參照，於是不重繪 —— 按鈕按下去畫面什麼都不會發生，而程式沒有任何錯誤。
 */
export function toggleCollapsed(
  collapsed: ReadonlySet<Status>,
  status: Status,
): ReadonlySet<Status> {
  const next = new Set(collapsed);
  if (!next.delete(status)) next.add(status);
  return next;
}

/**
 * 這次拖曳掀開了哪些欄位 —— `over` 那一欄加進來，**已經掀開的不再收回**。
 *
 * 只加不減：收回是 `onDragEnd` 整份丟掉的事（`Board.tsx`）。指標一離開就收的話，
 * 右邊每一欄會同時往左跳約 216px，而 `dnd.ts` 的 `columnKeyboardCoordinates`
 * 剛剛才照著掀開時的版面把卡片放到某一欄的中心 —— 欄距 268px、跳動 216px，
 * 於是「最近的中心」變成隔壁那一欄。鍵盤使用者按一次右鍵走兩欄，而畫面上
 * 看不出任何異狀。
 */
export function revealOver(
  revealed: ReadonlySet<Status>,
  over: Status | null,
): ReadonlySet<Status> {
  if (over === null || revealed.has(over)) return revealed;
  return new Set([...revealed, over]);
}

/**
 * 畫面上現在真的折著的是哪幾欄 —— 偏好折起來的，扣掉這次拖曳掀開的。
 *
 * **差集而不是就地改偏好**：一次拖曳不該動到使用者的偏好。掀開的那一欄放開
 * 之後要照樣折回去，而 `localStorage` 裡那一格從頭到尾沒被碰過。
 */
export function collapsedNow(
  preferred: ReadonlySet<Status>,
  revealed: ReadonlySet<Status>,
): ReadonlySet<Status> {
  if (revealed.size === 0) return preferred;
  return new Set([...preferred].filter((s) => !revealed.has(s)));
}
