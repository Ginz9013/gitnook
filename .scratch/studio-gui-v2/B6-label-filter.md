# B6 —— 依 Label 篩選

**批次**：B ｜ **阻擋**：B2（header）、B5（`Board.tsx`／`App.tsx` 寫入所有權）

## 目標

40 張以上時看板就開始不能用了。

**這不違背 AGENT.md 的「沒有 search UI」**：那句話拒絕的是把 nook 變成專案管理
工具的搜尋面。依 Label 收攏看板是用**既有的詞彙**（Nook 沒有優先級欄位，
優先級用 Label 表達 —— CONTEXT.md），而且 CLI 的 `list --label` 已經有同一件事。

## 介面

```ts
// src/studio/board/filter.ts（新，純函式）
export function allLabels(issues: readonly { readonly labels: readonly string[] }[]): readonly string[];
export function matchesLabels(
  issue: { readonly labels: readonly string[] },
  selected: readonly string[],
): boolean;
```

多選之間是 **AND**，與 core `Filter.labels` 的收斂語意一致 —— 過濾應該越加越窄。
純前端，不打 server。

## 先寫紅燈

1. `allLabels` 去重、**依出現順序**（不排序 —— Label 沒有順序，而排序會讓
   面板每次資料變動就重排）。
2. `allLabels` 對零張 Issue 回空陣列。
3. `matchesLabels(issue, [])` → true（沒有篩選就是全部）。
4. `matchesLabels` 是 AND：兩個 label 都有才算中。
5. 大小寫敏感（Label 是自由文字，不是 Ref —— Ref 才大小寫不敏感）。

## 綠燈

header 一顆按鈕開出多選面板（shadcn 的 DropdownMenu，已經在用）。

**不持久化到 `localStorage`**（D12）—— 一個活過重新整理、又把 Issue 藏起來的
篩選器，是讓人以為自己弄丟資料的最快方法。這跟主題偏好（該持久化）不是同一種東西。

**生效時 header 必須顯眼地說「篩選中，N 張被隱藏」，並提供一鍵清除。**
這一句是這張票真正的驗收條件，不是那個面板。

篩選與「顯示已封存」是兩個獨立的維度，兩者都套用在同一份 `issues` 上。

## 寫入所有權

```
src/studio/board/filter.ts          （新）
src/studio/board/BoardHeader.tsx
src/studio/board/Board.tsx
test/studio/filter.test.ts          （新）
```
