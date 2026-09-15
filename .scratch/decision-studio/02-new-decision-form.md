# 02 新增 Decision 表單

nook ref：`01M2HN165D6N3BQCB196QY0A10`

## Outcome

Decisions 視圖的清單 header 上有一個新增入口，仿 Issue 的
`NewIssueForm`：只填標題，Enter 送出，Esc 取消，成功後表單清空但不
關閉（連開好幾筆是真實情境）。

## Acceptance criteria

- [ ] `src/server/handler.ts`：`POST /api/decisions`，body
      `{ title, body?, disposition? }`，對不認得的欄位回 400（同
      `POST /api/issues` 的 `CREATE_FIELDS` 白名單規則），成功回 201
      `DecisionView`
- [ ] `src/studio/api.ts`：`createDecision(title, body?, disposition?)`，
      重用既有 `postJson`（不改）；`body`/`disposition` 省略時就不送
      那個鍵，不是自己填一個預設值——同 `createIssue` 的既有規則
- [ ] `src/studio/decisions/NewDecisionForm.tsx`（新）：比照
      `NewIssueForm.tsx` 逐項規則——只收標題、單行輸入、Enter 隱式送出
      （不自己再聽一次 Enter）、送出中 `aria-busy`、失敗不清空輸入框、
      九個入口那種焦點管理這裡只有一個入口，仍要在關閉時把焦點還給
      觸發它的按鈕
- [ ] `src/studio/decisions/DecisionListHeader.tsx`：加上這個表單的
      觸發按鈕與展開位置（同 `BoardHeader.tsx` 的既有版面節奏）
- [ ] `src/studio/DecisionApp.tsx`：接上 `onCreate` handler——呼叫
      `createDecision`，用 `decisionReconcile.ts`（票 01 已完整實作）
      的 `CREATED` action 把新的一筆接進樂觀快照，失敗時走既有的錯誤
      橫幅路徑（重用 `App.tsx`/`IssueApp.tsx` 既有的失敗橫幅樣式，不
      發明新的）
- [ ] 新增失敗（伺服器說不）：表單不清空，錯誤原因走既有橫幅，不在
      表單裡再顯示第二份錯誤訊息

## Test seam

`handleRequest` 的新路由（server 整合測試）。可判定的那一半（標題
空不空由呼叫端之外的規則決定）沿用既有 `drawer/changes.ts` 的
`titleChange` 空標題規則精神，寫進 `decisionChanges.ts` 之前，這票
只需要在 CLI 層那種「trim 後為空就不送」規則直接寫在
`NewDecisionForm.tsx` 裡（同 `NewIssueForm.tsx` 現在的做法，它也沒有
另外抽一個純函數）。

## Write ownership

- `src/studio/decisions/NewDecisionForm.tsx`（新）
- `src/studio/decisions/DecisionListHeader.tsx`
- `src/server/handler.ts`
- `src/studio/api.ts`
- `src/studio/DecisionApp.tsx`
- 上述各檔對應的測試（`test/server/handler.test.ts` 擴充）

**不得碰**：`src/studio/decisions/DecisionList.tsx`／
`filter.ts`／`EmptyDecisions.tsx`（票 01 已完成，這票不需要動）、
`src/studio/decisionDrawer/**`（票 03 的範圍）。

## Shared resources

暫存目錄（server 測試各自 `mkdtemp`）。

## Blocked by

票 01（`DecisionApp.tsx`／`handler.ts`／`api.ts` 的既有形狀，以及
`decisionReconcile.ts` 的 `CREATED` action）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
