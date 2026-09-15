# 04 Decision 修改紀錄面板

nook ref：`01M2HN1686HM3P3BCDZKBJHYKY`

## Outcome

Decision drawer 底部有一個收合的 History 面板，展開才 fetch，顯示每一
次欄位寫入（field/value/actor/t），跟 CLI 的 `nook decision history`
同一份資訊，不做 restore。**這票同時是這一批的最後一張**，落地後統一
跑一次 `npm run bench`。

## Acceptance criteria

- [ ] `src/server/handler.ts`：`DecisionWriteView { field:
      DecisionSetKey; value: string; actor: string; t: number }`、
      `DecisionHistory { writes }`、`GET /api/decision-history/<ref>`——
      篩選走 core 的 `decisionFieldWrites`（票 01 decision-module 已經
      做好），**與 `nook decision history` 是同一份**，不重寫一次
      `create` 折成 title 第一次寫入的邏輯；已刪的 Decision 概念不存在
      （Decision 沒有 deleted 欄位），不需要處理那個既有 Issue 端點才有
      的特例
- [ ] `src/studio/api.ts`：`fetchDecisionHistory(ref)`、
      `isDecisionHistory`（同既有 `isIssueHistory` 的「只看頂層」規則）
- [ ] **泛化 `src/studio/drawer/HistoryPanel.tsx` 與 `history.ts`**（同
      spec.md Domain decisions）：
  - `history.ts` 的 `historyRows()` 改吃一個比 `WriteView` 更寬的結構
    型別（`field: string` 不收窄成 `SetKey`），新增匯出型別
    `HistoryWrite`
  - `HistoryPanelProps` 從 `{ issueId }` 換成 `{ id, fetchWrites }`，
    `fetchWrites: (id, signal) => Promise<{ writes: readonly
    HistoryWrite[] }>`
  - **Issue 既有呼叫端（`IssueDetail.tsx` 或其呼叫處）改傳
    `{ id: issue.id, fetchWrites: fetchHistory }`，行為逐字不變**——
    這是驗收的關鍵：既有 `test/studio/history.test.ts`（若有）與 Issue
    drawer 的既有行為不能有任何觀察得到的差異
- [ ] `src/studio/decisionDrawer/DecisionDetail.tsx`：接上
      `<HistoryPanel id={decision.id} fetchWrites={fetchDecisionHistory} />`
- [ ] `npm run bench` 六列全綠（`npm run build` 後跑），特別記錄 studio
      assets 那一列相對票 01 之前的基線變化

## Test seam

`historyRows()` 泛化後的行為（純函數單元測試，涵蓋 Issue 與 Decision
兩種欄位名稱的輸入，確認同一份邏輯對兩者都正確）、`handleRequest` 的
新路由（server 整合測試）。

## Write ownership

- `src/studio/drawer/HistoryPanel.tsx`
- `src/studio/drawer/history.ts`
- `src/server/handler.ts`
- `src/studio/api.ts`
- `src/studio/decisionDrawer/DecisionDetail.tsx`
- 上述各檔對應的測試

**不得碰**：`src/studio/decisionDrawer/{DecisionDrawer,
DispositionPicker,decisionChanges}.{tsx,ts}`（票 03 已完成，這票只碰
`DecisionDetail.tsx` 接線那一行）。

## Shared resources

暫存目錄（server 測試各自 `mkdtemp`）。

## Blocked by

票 01（`DecisionApp.tsx`／`handler.ts`／`api.ts` 的既有形狀）、票 03
（`DecisionDetail.tsx` 由 03 建立，這票才有地方接線）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
