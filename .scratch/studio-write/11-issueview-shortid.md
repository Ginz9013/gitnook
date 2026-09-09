# 11 `IssueView` 補上 `shortId`

nook ref：`01M22K4QER52HSAMCXBTN52QH4`

## Outcome

票 06 卡住的三條之一。卡片目前只能印完整的 26 碼 ULID。

## Acceptance criteria

- [ ] `IssueView` 增加 `readonly shortId: string`
- [ ] **長度 per-snapshot 算一次，不是 per-issue。** `shortIdLength([issue.id])`
      回的是單張自己跟自己不撞號的下限（6 碼），而那個前綴在整塊 board 上可能
      對應到幾十張 —— 短 ID 正是使用者接著要拿來當 Ref 用的東西
      （ADR-0006）。`src/cli/run.ts` 已經是正確做法，照它
- [ ] 長度要對**整塊 board** 算（`board.refs()`），不是對過濾後的子集 ——
      否則印出的 Ref 會被 `get` 判為有歧義
- [ ] 測試：兩張前綴相同的 issue 在同一份快照裡，`shortId` 必須長到足以區分

## Test seam

`handleRequest(board, req)` + mkdtemp 的真實 board，同票 01/03。

## Write ownership

- `src/server/handler.ts`
- `test/server/handler.test.ts`

**不得碰**：`src/studio/**`（票 10 與票 12 的）、`src/core/**`
（`shortIdLength` 已經存在，直接用）、`src/render/**`。

`src/studio/board/Card.tsx` 顯示 `shortId` 的那一行由**票 12** 改。

## Blocked by

票 01、03（皆已完成）。

## Status

queued
