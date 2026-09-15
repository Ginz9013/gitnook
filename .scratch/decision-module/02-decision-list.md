# 02 nook decision list（title list 快速搜尋）

nook ref：`01M2HBAFFPKAMSMZ4DYHKG8GPM`

## Outcome

`nook decision list [--disposition <d>]` 印出一張 compact table
（ref／title／disposition），這就是需求裡「title list 快速搜尋是否有
特定決策」的答案——沒有索引、沒有快取（ADR-0002 的既有取捨），掃描
`.decisions/decisions/` 全部檔案摺疊出來，人或 agent 直接讀或 `| grep`。

## Acceptance criteria

- [ ] `DecisionLog.list(filter?)` 已在票 01 實作完（純 core），這張票
      只需要把 CLI 動詞接上
- [ ] `nook decision list`：印出全部 Decision 的 ref（同 Issue 既有的
      短 ID／無歧義前綴顯示規則，沿用 `displayLength`／`shortIdLength`
      既有邏輯，不重寫比較器）、title、disposition
- [ ] `nook decision list --disposition <d>`：`d` 接受無歧義前綴（同
      `resolveDisposition`），只回傳符合的 Decision
- [ ] `--json` 支援（若支援，沿用 `renderJson` 既有形狀，不另創一種
      JSON shape）
- [ ] 空的 Decision Log（剛 init、還沒 new 過任何一篇）印出空表格而非
      報錯
- [ ] `npm run bench` 的 token 預算閘門：量測 `nook decision list` 的
      輸出 byte 數，確認沒有意外撞上既有 4.5KB 的 40 票情境預算（若這張
      票新增的渲染邏輯讓既有 Issue 的 `list` 輸出多印一個位元組，那是
      迴歸，不是本票的預期行為）

## Test seam

`render/table.ts` 的 decision table 渲染函式——純函數單元測試。
`dispatchDecision(argv, io)` 的 `list` 分支——CLI 整合測試，既有 `Io`
capture adapter。

## Write ownership

- `src/cli/decision.ts`（擴充 `list`）
- `src/render/table.ts`（新增 decision 用的 compact table 渲染函式）
- `test/cli/decision.test.ts`（擴充）
- `test/render/table.test.ts`（擴充）

**不得碰**：`src/core/decisionLog.ts`（`list()` 已在票 01 做完，這裡
純接線）、`src/render/json.ts`（除非你決定支援 `--json` 且真的需要）。

## Shared resources

None。

## Blocked by

票 01（`openDecisionLog().list()` 與 `DecisionLog` 型別）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
