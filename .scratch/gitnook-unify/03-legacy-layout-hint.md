# 03 舊版佈局偵測：錯誤訊息附上可執行的 `git mv` 指令

票檔：本檔（spec 同目錄 `spec.md`）

## Outcome

找不到 `.gitnook/` 但沿路找到舊版 `.issues/issues/`（或 `.decisions/
decisions/`）時，`BoardNotInitialized`／`DecisionLogNotInitialized` 的訊息附上
使用者可以直接複製貼上執行的 `git mv` 指令，而不是只說「這裡不是 board」。沒有
自動搬移——nook 不執行任何會寫入的 git 指令，這是既有原則（`AlreadySharedBoard`/
`NoGitDir` 訊息的既有做法），這張票延續同一條紀律，只是這次要動手把指令組出來給
使用者看。

順帶修掉一個票 01 造成的既有訊息漂移：`DecisionLogNotInitialized` 目前的訊息裡有
`run nook decision init first`／`run nook decision init at the project root`——
這個指令已經被票 01 移除，這兩句話這次要改成指向 `nook init`。

## Acceptance criteria

- [ ] 一個目錄底下有 `.issues/issues/`（舊版）、沒有 `.gitnook/`：對它跑任何需要
      board 的操作（例如 `nook list`），`BoardNotInitialized` 的訊息附上
      `git mv .issues/issues .gitnook/issues`（相對於實際找到舊版 marker 的那個
      目錄，不是寫死的相對路徑字面值——board 可能不在呼叫端的 cwd）
- [ ] 同一個目錄如果**同時**有舊版 `.decisions/decisions/`，訊息也附上對應的
      `git mv .decisions/decisions .gitnook/decisions`（兩條指令都要看得到，使
      用者一次搬完，不必先後執行兩次不同指令兩次失敗）
- [ ] 只有 `.issues/issues/`、沒有 `.decisions/decisions/`（舊版本來就只用過
      issue）：只附 issues 那一條 `git mv`，不憑空造一條 decisions 的指令
- [ ] 完全沒有找到任何舊版 marker（真的從來沒 init 過）：訊息維持現有的
      「run nook init」／「run nook init at the project root」，不附加任何
      `git mv`——不要把這條新邏輯套用到「真的沒有 board」這個既有、正常的情境
- [ ] `DecisionLogNotInitialized` 的訊息不再出現 `nook decision init` 字樣，改
      成 `nook init`（`decisionLog.ts` 呼叫端與訊息本身兩處都要對齊，`--in`/`at
      the project root` 的既有措辭結構不變）
- [ ] `BoardNotInitialized`／`DecisionLogNotInitialized` 各自對稱處理（同一份邏
      輯，兩份具名薄包裝——延續 `gitattributes.ts` 既有的
      `findBoardRoot`/`findDecisionRoot` 共用內部實作、只是 marker 不同的既有
      設計語言，不要為兩者各寫一套偵測邏輯）

## Test seam

- `findBoardRoot(dir)`／`findDecisionRoot(dir)`（`src/core/gitattributes.ts`）
  的回傳形狀（`BoardRoot`，如果需要新增欄位描述「沿路看到的舊版 marker 在哪」，
  型別擴充在這裡）——整合測試，真實 `mkdtemp` 目錄樹
- `BoardNotInitialized`／`DecisionLogNotInitialized` 建構出來的 `.message`——
  單元測試（純字串斷言）
- CLI 端到端：對一個只有舊版佈局的目錄跑 `nook list`／`nook decision list`，
  stderr 附帶 `git mv` 指令——沿用 `test/cli/run.test.ts`/`test/cli/decision.test.ts`
  既有的 `Io` capture adapter

## Write ownership

- `src/core/gitattributes.ts`（`BoardRoot` 型別與 `findMarkerRoot` 的偵測邏輯，
  若需要新增描述舊版 marker 位置的欄位）
- `src/core/types.ts`（`BoardNotInitialized` 的訊息組裝）
- `src/core/decisionTypes.ts`（`DecisionLogNotInitialized` 的訊息組裝 + 移除
  `nook decision init` 字樣）
- `src/core/board.ts`（`BoardNotInitialized` 的呼叫端，若訊息組裝需要的資訊改由
  這裡傳入）
- `src/core/decisionLog.ts`（`DecisionLogNotInitialized` 的呼叫端，同上）
- `test/core/gitattributes.test.ts`
- `test/core/gitattributes.decision.test.ts`
- `test/core/board.root.test.ts`（`BoardNotInitialized` 的既有測試集中在這裡）
- `test/core/decisionTypes.test.ts`
- `test/cli/run.test.ts`
- `test/cli/decision.test.ts`

**不得碰**：`src/core/health.ts`、`src/core/workspace.ts`、
`src/cli/workspace.ts`、`src/render/*`、`src/server/*`——票 02 已經動過
health.ts，票 04 才會動 workspace.ts/decisionLog.ts 的其餘部分。

## Shared resources

None。

## Blocked by

01（`.gitnook/` 佈局要存在才能判斷「有沒有搬過家」）、02（`src/core/types.ts` 同
一個檔案，避免同批次撞寫）

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests（`npx vitest run test/core/gitattributes.test.ts
  test/core/gitattributes.decision.test.ts test/core/decisionTypes.test.ts
  test/core/board.root.test.ts test/cli/run.test.ts test/cli/decision.test.ts`）
  與 `npx tsc --noEmit` 通過。
- 廣義回歸套件：同前兩票的收斂邏輯，workspace/decisionLog 其餘部分/
  cli-workspace/render 此時仍可能紅，整合者在票 04 落地後統一驗證全綠。
- Standards and spec review blockers are resolved.
