# 04 Workspace 可選遞迴掃描 + `WorkspaceMember.decisionLog` + `locateDecisionInWorkspace`

票檔：本檔（spec 同目錄 `spec.md`）

## Outcome

- `hasBoard()` 改判斷 `.gitnook/` 存在（不分別問 issues/decisions）。
- `scan()` 找到一個 board 後，讀它的 `.gitnook/config.json` 的 `workspace` 欄
  位：falsy（含檔案不存在、格式錯誤）→ 維持既有「找到就停」；`true` → 繼續往下
  掃子目錄，子目錄裡遇到的 board 遞迴套用同一條規則（這個特性掛在 board 自己身
  上，不特殊化「呼叫端傳入的那個 root」——不管從哪一層 cwd 呼叫
  `openWorkspace()`，同一個 board 的行為都一致）。
- `WorkspaceMember` 多一個 `decisionLog: DecisionLog` 欄位，用新的共用
  `lazyDecisionLog(board)`（從 `src/server/serve.ts` 的私有函式升格為
  `src/core/decisionLog.ts` 的公開匯出）建構——惰性，每次呼叫才問
  `board.root()`，不快取。`serve.ts` 改成 import 這個共用版本，刪掉自己原本的私
  有copy。
- 新增 `locateDecisionInWorkspace(workspace, ref)`，結構對稱於既有的
  `locateInWorkspace()`：要求完整 26 碼 ref，命中 0 個/多個各自丟專屬的新錯誤型
  別。
- 順帶修掉 `decisionLog.ts` 裡殘留的 `nook decision init` 字樣（票 03 已經處理
  `DecisionLogNotInitialized` 建構子本身；這裡指的是 `health()` 內部組裝
  `MissingMergeDriver` 訊息時用的 `initHint` 同款字串）。

## Acceptance criteria

- [ ] `hasBoard(dir)` 只問 `.gitnook/` 存不存在，不再分別問 issues/decisions 兩
      個子目錄
- [ ] 三層目錄樹：root（`--workspace`，有 issue）→ `root/a`（`--workspace`，有
      issue）→ `root/a/b`（沒有 `--workspace`，有 issue）→ `root/a/b/c`（有
      issue，不管有沒有 `--workspace`）：`openWorkspace({dir: root})` 回傳 3 個
      成員（root、root/a、root/a/b），`root/a/b/c` 不出現——`root/a/b` 沒掛
      workspace flag，「找到就停」在它這一層生效
- [ ] `.gitnook/config.json` 不存在，或存在但 `workspace` 是 `false`／缺
      該欄位：行為與今天的「找到就停」逐字相同（既有測試案例必須繼續通過，不
      能因為多了 config.json 讀取就改變沒設定過的目錄的行為）
- [ ] `.gitnook/config.json` 格式錯誤（不是合法 JSON）：`scan()` 視為「找到就
      停」（不當機、不當成 workspace root）——這條同時驗證了 `readNookConfig`
      的「安全失敗成 `{}`」承諾在 `scan()` 這個熱路徑上真的成立
    - `.gitnook/` 不存在的目錄：`openWorkspace()` 不拋錯，回傳空 `members`（既
      有行為，只驗證沒有被這次改動破壞）
- [ ] `WorkspaceMember.decisionLog` 是可用的 `DecisionLog`：對一個真的有
      `.gitnook/decisions/` 的成員呼叫 `member.decisionLog.list()` 能讀到資料
- [ ] `locateDecisionInWorkspace()`：ref 不是完整格式丟 `IncompleteRef`（沿用既
      有型別）；沒有任何成員擁有該 ref 丟新的
      `DecisionRefNotFoundInWorkspace`；多個成員同時擁有丟新的
      `AmbiguousDecisionWorkspaceRef`；剛好一個成員擁有時回傳
      `{ member, decision }`
- [ ] `serve.ts` 的 studio（單一 board）在新佈局下讀寫 decision 正常（既有
      `test/server/serve.test.ts` 對 decisions 相關 API 的既有斷言，換掉私有
      `lazyDecisionLog` 之後照樣通過——這條驗證的是「搬移是重構，不是行為改
      變」）
- [ ] `decisionLog.ts` 的 `health()` 內部不再出現 `nook decision init` 字樣

## Test seam

- `openWorkspace(opts)`／`locateDecisionInWorkspace(workspace, ref)`
  （`src/core/workspace.ts`）——整合測試，真實 `mkdtemp` 目錄樹（ADR-0004，延續
  `test/core/workspace.test.ts` 既有手法）
- `lazyDecisionLog(board)`（`src/core/decisionLog.ts`）——整合測試（延續
  `test/core/decisionLog.test.ts` 既有手法）
- `serve()`（`src/server/serve.ts`）——真實 HTTP（延續 `test/server/serve.test.ts`
  既有手法，這裡只驗證搬移沒有改變可觀察行為）

## Write ownership

- `src/core/workspace.ts`
- `src/core/types.ts`（`WorkspaceMember.decisionLog` 欄位；新的
  `DecisionRefNotFoundInWorkspace`/`AmbiguousDecisionWorkspaceRef` 兩個錯誤型
  別——放在這裡還是 `src/core/decisionTypes.ts` 由這張票決定，spec.md 的 Risks
  段已記錄兩者皆可）
- `src/core/decisionTypes.ts`（如果上面兩個新錯誤型別決定放這裡；`health()` 的
  `nook decision init` 字樣修正一定在這裡）
- `src/core/decisionLog.ts`（`lazyDecisionLog` 新匯出）
- `src/server/serve.ts`（改用共用的 `lazyDecisionLog`，刪掉私有版本）
- `test/core/workspace.test.ts`
- `test/core/decisionLog.test.ts`
- `test/server/serve.test.ts`

**不得碰**：`src/cli/workspace.ts`、`src/render/*`——票 05 的範圍，這張票只做
core 層，CLI 還沒接上新能力。

## Shared resources

None。

## Blocked by

01、02、03（`src/core/types.ts`／`src/core/decisionTypes.ts` 同一批檔案，前三張
票都動過，必須排在它們之後才不會同批次撞寫）

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests（`npx vitest run test/core/workspace.test.ts
  test/core/decisionLog.test.ts test/server/serve.test.ts`）與
  `npx tsc --noEmit` 通過。
- 廣義回歸套件（`npx vitest run`）**這裡要求全綠**——票 01/02/03 刻意延後的
  workspace/decisionLog/serve 這條線到這張票應該全部接上，`src/cli/workspace.ts`
  與 `src/render/*` 仍然是舊介面（下一票才動），但它們不依賴這張票改動的任何
  型別簽章，所以不應該紅。如果全套件還有紅燈，先確認是不是真的落在票 05/06 的
  範圍，不是的話要修。
- Standards and spec review blockers are resolved.
