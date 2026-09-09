# A8 —— GUI 新增 Issue：header 一顆按鈕 ＋ 八欄各一個 `+`

**批次**：A ｜ **阻擋**：A4（端點）、A5（`CREATED`）、A7（看板檔案）
**本片段無自動化測試** —— React 組件不寫測試（spec 的測試策略）。
可判定的部分已經在 A5 的 reducer 裡測過了。

## 目標

在 studio 上開一張 Issue，**不必回終端機**。

## 介面

```ts
// src/studio/api.ts
export function createIssue(title: string): Promise<IssueView>;   // POST /api/issues
```

`App.tsx` 收到回應後 `apply({ type: 'CREATED', issue })`。
失敗走既有的 `failed` 橫幅（`postChange` 那條路徑同款）。

## 表單

**只收標題**（D15）：單行輸入、Enter 送出、Esc 取消、送出後保持開啟並清空
（連開三張是真實情境）。其餘欄位留給 drawer —— `nook new` 之後接著就是
`nook set description`，而一個開場就要求填五個欄位的對話框，會讓「快速記下
一件事」這個唯一的使用情境變慢。

## 入口

- header 一顆按鈕（本批先放在 `Board.tsx` 現有的那條 header 上；B1 會重整）。
- **八個欄頂各一個 `+`**，含 `queued`。欄頂的 `+` 把那一欄的 Status 當預設值 ——
  這是看板這個版面唯一比 CLI 好的地方。
- 欄頂的 `+` 把那一欄的 Status 當 `POST /api/issues` 的 `status` 送出去
  （A4 已經收這個欄位）。header 那顆不帶 `status`，落在 `backlog`。

## 空白處理

- 空標題不送（沿用 `changes.ts` 的 `titleChange` 同一條規則：空標題不是一次
  編輯，是一次誤觸）。
- 送出中不得重複送。

## 無障礙

- 表單開啟時焦點進輸入框；Esc 關閉後焦點回到觸發的那個 `+`（沿用 `focus.ts` 的
  模型 —— Radix 對受控元件的預設焦點是壞的，見 `IssueDrawer.tsx` 的註解）。
- 每個 `+` 要有可及名稱，八個不能都叫「新增」（`aria-label={`在 ${status} 新增 Issue`}`）。

## 寫入所有權

```
src/studio/api.ts
src/studio/App.tsx
src/studio/board/Board.tsx
src/studio/board/Column.tsx
src/studio/board/NewIssueForm.tsx    （新）
```

## 驗證

```bash
npm run typecheck && npm test && npm run build
npm run nook -- studio     # 人工：header 開一張、queued 欄的 + 開一張、Esc、Enter、空標題
```
