# 06 nook doctor 涵蓋 decisions 的 gitattributes 檢查

nook ref：`01M2HBAFM2SEK2CMEWWQG4007B`

## Outcome

ADR-0001 的硬規則：「`.gitattributes` 中的那一行是整個系統的唯一單點
失效，`doctor` 必須檢查它。」Decision 用同一套 union-merge 機制，這條
規則對它同樣成立。`nook doctor` 現在也會檢查
`.decisions/decisions/*.ndjson merge=union` 這一行——但只在
`.decisions/` 目錄存在時才檢查（同 private-mode 的既有哲學：這個診斷
在「這個 repo 根本沒有 Decision Log」的情境下不存在，不是被壓掉的
真問題）。

## Acceptance criteria

- [ ] `src/core/health.ts` 的 `diagnose()` 泛化成掃描一份「已知實體
      pattern 清單」（目前兩項：Issue 的 `.issues/issues/*.ndjson`、
      Decision 的 `.decisions/decisions/*.ndjson`），而不是硬編一個
      pattern
- [ ] `.decisions/` 目錄不存在 → 完全不檢查、不回報任何 Decision 相關
      Diagnostic（沉默）
- [ ] `.decisions/` 存在但缺少 `merge=union` 那一行 → 回報
      `MissingMergeDriver`（或等義的既有 `DiagnosticKind`，重用不新增，
      除非你判斷兩種實體的訊息真的需要分開——若分開，說明為什麼)
- [ ] `.decisions/` 存在且 `merge=union` 齊全 → 沉默，同 Issue 側既有
      行為
- [ ] Issue 側既有的所有 `health.test.ts` 案例一行不改，全部維持通過
- [ ] `nook doctor --fix` 的既有行為（修復黏合行）不受影響——這張票
      不擴大 `--fix` 的範圍到 Decision，除非 Decision 的黏合行修復邏輯
      已經在票 01 的 `decisionLog.ts` 裡實作好，此時只需要接上檢查

## Test seam

`diagnose()`——整合測試，真實 `mkdtemp`，同 ADR-0004。

## Write ownership

- `src/core/health.ts`
- `test/core/health.test.ts`

**不得碰**：`src/cli/run.ts`（`doctor` 指令本身的接線不變，若
`diagnose()` 簽章沒變就不需要動它）、`src/core/gitattributes.ts`
（票 01 已經把泛化的 pattern 定義做完，這裡只是消費它）。

## Shared resources

None。

## Blocked by

票 01（`.decisions/` 的 marker 目錄名稱與 gitattributes pattern 字串
定義）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
