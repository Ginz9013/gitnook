# 02 `doctor` 適配 `.gitnook/` 佈局 + `InvalidNookConfig` 診斷

票檔：本檔（spec 同目錄 `spec.md`）

## Outcome

`nook doctor`／`board.health()` 在新的 `.gitnook/` 佈局下正常運作：既有診斷
（`MissingMergeDriver`/`GluedLine`/`UnparsableLine`/`UnknownOp`/`SharingMismatch`/
`NotAGitRepo`）路徑常數改指向 `.gitnook/issues`、`.gitnook/decisions`，行為不變；
`repair()` 黏合行修復維持只修 issue 側（既有、與這次改動無關的落差，不擴大範
圍）。新增一種診斷：`.gitnook/config.json` 存在但不是合法 JSON（或不是物件）時，
`doctor` 報一條 `InvalidNookConfig`，exit 非 0，訊息講清楚檔案壞在哪、workspace
掃描會因此在這個目錄停住。

## Acceptance criteria

- [ ] `board.health()` 對新佈局（`.gitnook/issues`、`.gitnook/decisions`）的既有
      六種診斷行為與舊佈局下逐字相同（沿用既有測試案例，只換路徑）
- [ ] `repair()` 對 `.gitnook/issues/` 底下的黏合行照樣修得好，寫回的檔案守住
      硬規則 1（trailing newline）
- [ ] `.gitnook/config.json` 不存在時**不**產生 `InvalidNookConfig`（沒有檔案不是
      壞掉，是還沒設定過 workspace）
- [ ] `.gitnook/config.json` 存在且是合法 `{ "workspace": boolean }` 時不產生
      `InvalidNookConfig`
- [ ] `.gitnook/config.json` 存在但不是合法 JSON（例如截斷的檔案）時產生
      `InvalidNookConfig`，`file`/`message` 講得出是哪個檔案
- [ ] `.gitnook/config.json` 是合法 JSON 但不是物件（例如整個檔案是 `"hello"`
      或 `42`）也算 `InvalidNookConfig`——不是「合法設定值裡沒有 workspace 欄
      位」那種情況
- [ ] `src/studio/board/health.ts` 的 `ADVICE`（`Record<Exclude<DiagnosticKind,
      'NotAGitRepo'>, ...>`）補上 `InvalidNookConfig` 這一鍵，`npx tsc --noEmit`
      通過（少這一鍵會直接型別錯誤，這是抓到這張票沒做完的訊號）
- [ ] `boardAlerts()` 對 `InvalidNookConfig` 產生一條警示（同其餘診斷的既有處理
      方式，不需要特殊排序——只有 `MissingMergeDriver` 排第一是既有規則，不動）
- [ ] `health.ts` 裡 `knownEntities` 陣列 decisions 那一條的 `initHint: 'nook
      decision init'` 改成 `'nook init'`——`nook decision init` 這個指令已經被
      票 01 移除，這則診斷訊息不能繼續指向一個不存在的指令

## Test seam

- `diagnose(dir)`／`repair(dir)`（`src/core/health.ts`）——整合測試，真實
  `mkdtemp` 目錄樹
- `boardAlerts(diagnostics)`（`src/studio/board/health.ts`）——純函式單元測試
  （既有 `test/studio/health.test.ts` 的既有手法：environment: 'node'，不碰 DOM）

## Write ownership

- `src/core/health.ts`
- `src/core/types.ts`（僅 `DiagnosticKind` 加一個 `'InvalidNookConfig'` 值；不碰
  這個檔案的其他內容——`WorkspaceMember`/新的 Decision workspace 錯誤型別屬於票
  04）
- `src/core/nookConfig.ts`（如果需要，補一個比 `readNookConfig` 更細的內部判斷
  給 `diagnose()` 用——例如 `inspectNookConfig()` 回傳 `absent`/`valid`/
  `malformed`，`readNookConfig()` 疊在它上面；精確形狀留給這張票的紅燈測試決
  定，spec.md 的 Risks 段已經記錄這個開放問題）
- `src/studio/board/health.ts`
- `test/core/health.test.ts`
- `test/studio/health.test.ts`
- `test/core/nookConfig.test.ts`（如果新增了 `inspectNookConfig()`，補對應測試）

**不得碰**：`src/core/workspace.ts`、`src/core/decisionTypes.ts`、
`src/core/decisionLog.ts`、`src/cli/workspace.ts`——那些是票 03/04 的範圍。

## Shared resources

None。

## Blocked by

01（依賴 `.gitnook/` 佈局與 `nookConfig.ts` 已經存在）

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests（`npx vitest run test/core/health.test.ts
  test/studio/health.test.ts test/core/nookConfig.test.ts`）與
  `npx tsc --noEmit` 通過。
- 廣義回歸套件：同票 01 的收斂邏輯——寫入範圍外、還沒被後續票修到的檔案
  （workspace/decisionLog/serve/cli-workspace/render）預期仍然紅，整合者在票 04
  落地後統一驗證全綠。
- Standards and spec review blockers are resolved.
