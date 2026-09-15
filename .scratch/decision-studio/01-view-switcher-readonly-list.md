# 01 視圖切換殼 + 唯讀 Decision 清單

nook ref：`01M2HN164099R34YRVZ8CCPCV9`

## Outcome

`nook studio` 開啟後，畫面上有 Issues／Decisions 頂層切換，選擇會存進
localStorage（重新整理維持上次選的）。切到 Decisions：一份扁平清單
（不是看板），每 2 秒輪詢一次變更，可用 disposition 篩選。這一票**不做**
新增／編輯——那是票 02／03 的範圍，這裡只需要「看得到、會自動更新」。

工具鏈屬於第一個需要它的切片，所以在這張票內建立：`decisionReconcile.ts`
的**完整** reducer（SNAPSHOT/EDIT/CREATED/ACK/FAIL），即使這一票的 UI
只用得到 SNAPSHOT——同 nook-v1 票 01 的先例：「讓後面的票能立刻平行開工」，
避免票 02／03 回頭改 reducer 的形狀。

## Acceptance criteria

- [ ] `src/server/handler.ts`：新增 `DecisionView`（`id`/`shortId`/
      `title`/`disposition`/`body`/`bodyHtml`/`supersededBy?`/
      `legacyRef?`）、`toDecisionView(decision, shortIdLen)`、
      `DecisionBoardSnapshot { decisions, hash }`、
      `decisionHash(log)`（同 `boardHash` 的雜湊規則，量測對象是
      `decisionLog.list({})`——沒有 `all` 概念，Decision 不隱藏任何東西）
- [ ] `GET /api/decisions` → `DecisionBoardSnapshot`（`shortId` 長度對
      `decisionLog.refs()` 算，同 Issue 的 `displayLength` 邏輯）
- [ ] `GET /decision-hash` → 裸文字指紋（同 `/hash` 的形狀）
- [ ] `handleRequest` 的簽章加一個 `decisionLog` 參數（**這是這批唯一
      真的改動既有 Issue 端點介面的地方**）——同步更新 `serve.ts` 呼叫
      它的那一行，以及所有既有 `test/server/handler.test.ts` 的呼叫點
      （改參數不改既有 Issue 路由的行為）
- [ ] `src/studio/api.ts`：`fetchDecisions()`、`fetchDecisionHash()`、
      `isDecisionBoardSnapshot`，重用既有 `getJson`（不改）
- [ ] `src/studio/decisionReconcile.ts`（新）：`ReconcileDecision`、
      `ReconcileDecisionChange`、`ClientDecisionState`、
      `ClientDecisionAction`（`SNAPSHOT | EDIT | CREATED | ACK | FAIL`，
      **沒有** GRAB/RELEASE/DROP）、`clientDecisionReduce`、
      `initialDecisionClient`、`projectDecisions`——同 `reconcile.ts`
      既有的 `seq`／pending-write 認回規則
- [ ] `src/studio/decisions/`（新目錄）：`DecisionList.tsx`（一列一個
      Decision：shortId/title/disposition，點擊之後這票先不做任何事，
      drawer 是票 03 的範圍）、`DecisionListSkeleton.tsx`、
      `EmptyDecisions.tsx`、`DecisionListHeader.tsx`（disposition 篩選，
      這票不含新增入口）、`filter.ts`（純函數
      `filterByDisposition(decisions, disposition?)`）
- [ ] `src/studio/IssueApp.tsx`（新）：現有 `App.tsx` 的內容**原樣搬過去，
      邏輯一行不改**（同 CLI 那批 `dispatchIssue` 的搬遷手法）
- [ ] `src/studio/DecisionApp.tsx`（新）：鏡射 `IssueApp.tsx` 的節奏——
      一份 `ClientDecisionState` ref、輪詢 `/decision-hash`／
      `/api/decisions`（重用 `poll.ts` 既有的泛型 `startPolling`，
      不改那個檔案）、連線中斷橫幅（重用既有 `ConnectionFault`/
      `classifyFailure`）——這票沒有寫入，drawer 開關狀態先宣告但不使用
- [ ] `src/studio/App.tsx`：拆成薄殼，讀/寫 `prefs.ts` 的視圖偏好
      （新增 `readActiveView`/`writeActiveView`，同既有 `readTheme` 的
      模式：讀不懂的值退回預設 `'issues'`），畫頂層切換 UI，依偏好
      **只掛載其中一個** composition root
- [ ] Issue 既有的一切行為（看板、drawer、輪詢、history、拖曳）逐字
      不變——`test/studio/*.test.ts` 全部維持通過

## Test seam

`clientDecisionReduce`/`projectDecisions`（純函數單元測試，同
`reconcile.test.ts` 手法）、`filterByDisposition`（純函數）、
`handleRequest` 的兩個新路由（server 整合測試，真實暫存目錄）、
`prefs.ts` 的新函式（純函數，同既有 `readTheme` 的測試手法）。

## Write ownership

- `src/studio/App.tsx`
- `src/studio/IssueApp.tsx`（新）
- `src/studio/DecisionApp.tsx`（新）
- `src/studio/decisionReconcile.ts`（新）
- `src/studio/decisions/DecisionList.tsx`（新）
- `src/studio/decisions/DecisionListSkeleton.tsx`（新）
- `src/studio/decisions/EmptyDecisions.tsx`（新）
- `src/studio/decisions/DecisionListHeader.tsx`（新）
- `src/studio/decisions/filter.ts`（新）
- `src/studio/prefs.ts`
- `src/server/handler.ts`
- `src/server/serve.ts`
- `src/studio/api.ts`
- 上述各檔對應的測試（`test/studio/*.test.ts`、`test/server/handler.test.ts`、既有 prefs 測試檔擴充）

**不得碰**：`src/studio/drawer/**`（Issue 既有 drawer，票 04 才會碰
`HistoryPanel.tsx`）、`src/studio/board/**`（Issue 既有看板一行不動）、
`src/studio/reconcile.ts`、`src/studio/poll.ts`（兩者都保持原樣，只是
被 `decisionReconcile.ts`/`DecisionApp.tsx` 重用）、`src/core/**`
（Decision 核心已在上一批做完）。

## Shared resources

暫存目錄（server 測試各自 `mkdtemp`），port 綁 0（如需要啟動真實
`serve()`）。

## Blocked by

None——這是第一張票。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
