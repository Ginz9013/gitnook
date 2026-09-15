/**
 * Decisions 扁平清單上的 disposition 篩選 —— 純函式，同 `board/filter.ts` 的
 * `matchesLabels`。**沒有指定就是不篩選**：`undefined` 原樣回傳全部，而不是
 * 回空陣列（那會讓第一次進到 Decisions 視圖的人看到一片空白）。
 *
 * 型別參數而非釘死 `DecisionView`：這個模組不 import `server/handler.ts`，
 * 同 `decisionReconcile.ts` 的既有規則 —— 純邏輯不依賴 server 的形狀。
 */
export function filterByDisposition<D extends { readonly disposition: string }>(
  decisions: readonly D[],
  disposition?: string,
): readonly D[] {
  return disposition === undefined ? decisions : decisions.filter((d) => d.disposition === disposition);
}
