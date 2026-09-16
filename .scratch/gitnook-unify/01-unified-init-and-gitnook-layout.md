# 01 統一 `nook init` 與 `.gitnook/` 佈局

票檔：本檔（spec 同目錄 `spec.md`）

## Outcome

`nook init [--private] [--workspace]` 是唯一的初始化入口，端到端可用：

- 全新目錄：同時建立 `.gitnook/issues/`、`.gitnook/decisions/`，各自冪等寫入自己
  的 `merge=union` 規則（不合併成一條 glob）。
- `--private`：整個 `.gitnook/` 被 `$GIT_DIR/info/exclude` 排除（一條規則涵蓋兩個
  模組），`.gitattributes` 完全不碰。op-log（issues 或 decisions 任一）已被 git
  追蹤時丟 `AlreadySharedBoard`；不在 git work tree 內時丟 `NoGitDir`。
- `--workspace`：`.gitnook/config.json` 寫入 `{ "workspace": true }`。
- 冪等：已存在的 board 重跑 `nook init` 不出錯，且會補齊缺的那一半（例如舊 board
  只有 issues 沒有 decisions，重跑後兩者都在）；已經是 `workspace: true` 的重跑
  維持 `true`；沒有 `--workspace` 的重跑不會把已經是 `true` 的值改回 `false`。
- `nook issue init`、`nook decision init` 兩個指令整個移除，跑了得到指向
  `nook init` 的清楚錯誤（沿用既有 `LEGACY_ISSUE_COMMANDS` 的「明確報錯指向新路
  徑」做法）。

## Acceptance criteria

- [ ] `nook init` 在全新目錄建立 `.gitnook/issues/`、`.gitnook/decisions/` 與各自
      的 `merge=union` 規則
- [ ] `nook init` 對已存在的 board 重跑是 Unchanged（three-way 輸出：
      Created/Unchanged，沿用既有 `cmdInit` 措辭風格），且補齊缺的那一半
- [ ] `nook init --private` 一條 exclude 規則涵蓋 `.gitnook/`；`.gitattributes`
      不被寫入或讀取
- [ ] `nook init --private` 在 issues 或 decisions 任一 op-log 已被 git 追蹤時丟
      `AlreadySharedBoard`；不在 git work tree 內時丟 `NoGitDir`
- [ ] `nook init --workspace` 寫入 `.gitnook/config.json` 的 `workspace: true`；
      對已是 `true` 的目錄重跑是 Unchanged；不帶 `--workspace` 的重跑不會清掉已
      經是 `true` 的值
- [ ] `nook init` 在既有 board 的子目錄執行丟 `NestedBoard`（只檢查一次，涵蓋兩
      個模組，不像現在 `initBoard`/`initDecisionRoot` 各自查一次）
- [ ] shared 模式下既有 `.gitattributes` 有衝突規則時丟 `ConflictingGitAttributes`
      （檢查排在建目錄之前）
- [ ] `nook issue init`、`nook decision init` 不存在，`nook --help` 也不再列出
- [ ] `npx tsc --noEmit` 通過（`ISSUES_DIR`/`DECISIONS_DIR`/`MERGE_RULE`/
      `DECISION_MERGE_RULE`/`OP_LOG_SAMPLE`/`DECISION_LOG_SAMPLE` 全部指向
      `.gitnook/...`）

## Test seam

- `initNook(dir, opts)`（`src/core/gitattributes.ts`，新公開函式）——整合測試，
  真實 `mkdtemp` 目錄樹（ADR-0004）
- `readNookConfig`/`writeNookConfig`（`src/core/nookConfig.ts`，新檔）——整合測試
- `sharing.ts` 六個既有公開函式（簽章不變，內部行為改成 `.gitnook` 為中心）——
  沿用 `test/integration/private-mode.test.ts` 的既有真實 git 子行程手法
- `dispatch(argv, io)` 的 `nook init` 路徑——`test/cli/run.test.ts` 既有的 `Io`
  capture adapter

## Write ownership

- `src/core/gitattributes.ts`
- `src/core/sharing.ts`
- `src/core/nookConfig.ts`（新檔）
- `src/cli/run.ts`
- `src/cli/issue.ts`
- `src/cli/decision.ts`
- `test/core/gitattributes.test.ts`
- `test/core/gitattributes.decision.test.ts`
- `test/core/nookConfig.test.ts`（新檔）
- `test/integration/private-mode.test.ts`
- `test/cli/run.test.ts`
- `test/cli/issue.test.ts`
- `test/cli/decision.test.ts`
- `AGENT.md`（HELP 文字裡 `init`/`issue init`/`decision init` 的異動要跟著更
  新——`test/agent-doc.test.ts` 對 HELP 與 AGENT.md 的指令名做雙向比對）

**執行後追加（board 缺口，整合者驗證時發現並修補）**：`src/core/board.ts` 的
`issuesDir()` 硬編了 `.issues/issues` 字面路徑，沒有被任何票認領——`findBoardRoot`
已經指向新佈局，這一行沒有跟著動就會讓 board 找得到根卻讀不到檔案。已改成
`import { ISSUES_DIR } from './gitattributes.js'` 並重用它。連帶把同樣硬編了
`.issues`/`.decisions` 字面路徑、且不在任何票寫入範圍內的測試檔一併修正（純路徑
字面值替換，不改任何斷言邏輯）：`test/core/board.comments.test.ts`、
`test/core/board.create.test.ts`、`test/core/board.deleted.test.ts`、
`test/core/board.list.test.ts`、`test/core/board.labels.test.ts`、
`test/core/board.oplog.test.ts`、`test/core/board.set.test.ts`、
`test/core/reduce.malformed.test.ts`、`test/integration/forward-compat.test.ts`、
`test/integration/git-merge.test.ts`、`test/server/serveWorkspace.test.ts`、
`test/server/handler.test.ts`。

**不得碰**：`src/core/health.ts`、`src/core/workspace.ts`、`src/core/types.ts`、
`src/core/decisionTypes.ts`、`src/core/decisionLog.ts`、`src/server/*`、
`src/cli/workspace.ts`、`src/render/*`、`src/studio/*`——這些路徑常數字面值仍然
是舊的 `.issues`/`.decisions`，**這張票結束時它們會壞掉，這是預期的**：票 02/03/04
會依序修。不要因為看到別的測試變紅就去改寫入範圍外的檔案。

## Shared resources

None——全部在各自獨立的 `mkdtemp` 暫存目錄裡操作，`sharing.ts` 的 git 子行程測試
各自在自己的暫存 repo 裡跑（同 `test/integration/private-mode.test.ts` 既有手法）。

## Blocked by

None——第一張票。

## Status

in-progress

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests（`npx vitest run test/core/gitattributes.test.ts
  test/core/gitattributes.decision.test.ts test/core/nookConfig.test.ts
  test/integration/private-mode.test.ts test/cli/run.test.ts
  test/cli/issue.test.ts test/cli/decision.test.ts test/agent-doc.test.ts`）
  與 `npx tsc --noEmit` 通過。
- 廣義回歸套件（`npx vitest run`）**不要求全綠**——寫入範圍外的檔案（health/
  workspace/decisionLog/serve/cli-workspace/render/studio）此時仍指向舊路徑，
  會紅。只要求：紅的測試全部落在「不得碰」清單裡列出的檔案範圍內，且失敗原因
  是路徑常數還沒更新（不是這張票自己引入的邏輯錯誤）。整合者在票 04 落地後才
  跑一次全綠驗證。
- Standards and spec review blockers are resolved.
