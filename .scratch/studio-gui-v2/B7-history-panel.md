# B7 —— drawer 底部的變更歷史，預設收合

**批次**：B ｜ **阻擋**：B1（`/api/history/<ref>`）、A9（`IssueDetail.tsx` 寫入所有權）
**本片段無自動化測試**

## 目標

被 LWW 蓋掉的舊值目前只有 CLI 的 `nook history` 撈得回來，而 studio 是人的
主要操作介面（ADR-0007）。

## 位置與形狀

**接在 comment 時間軸下面，預設收合。** 它是「出事才會去看」的東西，
不該跟每天在用的編輯欄位搶版面。**不做**「每個欄位旁邊各一個小小的歷史入口」——
那會在 drawer 上撒五個幾乎不會被按的圖示。

展開時才 fetch（`GET /api/history/<ref>`），不要在開 drawer 時就抓 ——
多數人不會展開它。

## 內容

一列一次寫入：**欄位 · 新值 · actor · `t`**。與 CLI 的 `nook history` 同一份資訊。

- 依 `t` 由新到舊。`opLog` 給的是由舊到新的全序（`board.ts:113`），**這裡反轉顯示，
  不重新排序** —— 全序只有一份（`reduce.ts` 的 `orderOps`）。
- `description` 的舊值可能很長：截斷並可展開。**顯示原文，不渲染 markdown** ——
  前端不得有第二份 markdown 渲染器（ADR-0008），而歷史要看的是原文本身。
- `deleted` 也會出現在這裡（它是第五個 LWW 欄位）。**這正是誤刪的救生索**，
  A9 的刪除確認框就是這樣跟使用者說的。

## 空的時候

一張只被 `create` 過、從沒 `set` 過的 Issue，`writes` 是空的。
要說「這張 Issue 的欄位還沒被改過」，不是畫一個空清單。

## 寫入所有權

```
src/studio/drawer/HistoryPanel.tsx    （新）
src/studio/drawer/IssueDetail.tsx
src/studio/api.ts
```
