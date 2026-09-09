/**
 * 依 Label 收攏看板 —— 票 B6 裡可判定的那一小塊。
 *
 * **這不是搜尋。** AGENT.md 的「沒有 search UI」拒絕的是把 nook 變成專案管理
 * 工具的搜尋面；依 Label 收攏用的是 board 已經有的詞彙（Nook 沒有優先級欄位，
 * 優先級用 Label 表達 —— CONTEXT.md），而 CLI 的 `list --label` 早就是同一件事。
 *
 * **純前端，不打 server。** 快照已經在手上（`/api/board` 全量），為了收攏畫面
 * 再往返一趟只會讓「看得見的」與「剛剛送出的」不同步。
 *
 * 住在這裡而不是 `BoardHeader.tsx`：那樣才測得到（`test/studio/filter.test.ts`），
 * 同 `board/path.ts`、`board/collapse.ts` 與 `board/health.ts`。剩下的（多選面板、
 * 篩選中的那條說明）是版面，React 組件不寫測試（spec.md 的測試策略），
 * 所以能推出來的規則要推出來。
 *
 * **選擇本身不住在這裡，也不進 `localStorage`**（D12）—— 一個活過重新整理、又把
 * Issue 藏起來的篩選器，是讓人以為自己弄丟資料的最快方法。這跟主題偏好與欄位
 * 折疊（兩者都該持久化，`@/prefs`）不是同一種東西。
 */

/**
 * 板上出現過的 Label，**去重且依出現順序**。
 *
 * 不排序是刻意的：Label 沒有順序，而排序會讓面板每次資料變動就重排。
 */
export function allLabels(
  issues: readonly { readonly labels: readonly string[] }[],
): readonly string[] {
  const seen = new Set<string>();
  for (const issue of issues) {
    for (const label of issue.labels) seen.add(label);
  }
  return [...seen];
}

/**
 * 這張 Issue 中不中選。**沒有選任何 Label 就是不篩選** —— 空的 `selected` 每一張都中
 * （`every` 對空陣列本來就是 true，不必另外寫一條）。
 *
 * **多選之間是 AND**，與 core `Filter.labels` 同一套收斂語意
 * （`board.ts:141`）—— 過濾應該越加越窄。OR 會讓「再勾一個」把畫面上的 Issue
 * 變多，那與使用者按下第二個勾勾的意圖相反。
 */
export function matchesLabels(
  issue: { readonly labels: readonly string[] },
  selected: readonly string[],
): boolean {
  return selected.every((label) => issue.labels.includes(label));
}

/**
 * 勾選／取消勾選一個 Label。**永遠回一個新的陣列**，同 `collapse.ts` 的
 * `toggleCollapsed` —— 原地 `push`／`splice` 過的陣列，React 的 `useState`
 * 認得出它是同一個參照就不重繪，畫面於是停在上一次的篩選結果上。
 *
 * 順序是勾選的順序，不排序：那份清單只餵給 `matchesLabels`（AND，與順序無關）
 * 與 header 的那句「同時帶著 a + b」，而後者照著人勾的順序念比較好讀。
 */
export function toggleLabel(selected: readonly string[], label: string): readonly string[] {
  return selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label];
}
