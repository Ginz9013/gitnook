# 02 `nook workspace list`：依子專案分組的彙整清單

## Outcome

在母資料夾底下跑 `nook workspace list`，看到每個子專案各自一段、標著來源
路徑的 issue 清單；篩選旗標（`--all`/`--status`/`--label`/`--json`）與單一
Board 的 `nook list` 語意相同，套用到每個成員上。

## Acceptance criteria

- [ ] 兩個子專案各自有 issue 的樹，`nook workspace list` 印出兩段，各自
      標著路徑（相對於 workspace 根目錄），組間有清楚的視覺分隔
- [ ] `--status`/`--label`/`--all` 對每個成員各自套用，語意與
      `nook list` 完全一致（例如預設隱藏 done/cancelled/archived）
- [ ] 篩選後某個成員一張 issue 都不剩時，那一組**整組不列出**（不印一個
      空表頭）
- [ ] 全部成員篩選後都是空的，印一句彙整版的「沒有 issue」，不是好幾句
      重複的空訊息
- [ ] `--json` 輸出是可解析的 JSON，且看得出哪些 issue 屬於哪個成員路徑
- [ ] 一個母資料夾完全掃不到任何成員時（空 workspace），指令仍然
      exit 0 並印出對應訊息，不是報錯
- [ ] `nook --help` 的指令表出現 `workspace`
- [ ] `AGENT.md` 至少提到一次 `nook workspace`（`test/agent-doc.test.ts`
      雙向比對 HELP 與 AGENT.md，兩邊都要看得到）
- [ ] `npm run bench` 的 CLI bundle 依然零 React/studio 痕跡——
      `src/cli/workspace.ts` 不得 import 任何 `src/studio/*` 或
      `src/server/*` 的東西（這張票不需要，留給票 04）

## Test seam

`dispatchWorkspace(argv, io)`（`test/cli/workspace.test.ts`，新檔），沿用
既有 `test/cli/run.test.ts` 的 `Io` capture adapter 手法，在真實 `mkdtemp`
樹上跑。`renderWorkspaceList()` 的分組/空組略過邏輯另外用純函數測試補在
`test/render/table.test.ts`。

## Write ownership

- `src/cli/run.ts`（新增 `case 'workspace'`、`COMMANDS`、`HELP`；把
  `parseArgs`、`Args`、`VALUED` 三個符號加上 `export`，不改它們的行為）
- `src/cli/workspace.ts`（新檔：`dispatchWorkspace` + `list` 子指令）
- `src/render/table.ts`（新增 `renderWorkspaceList`、`WorkspaceGroup`，
  不改動既有 `renderTable`/`renderSetOps` 的任何行為）
- `AGENT.md`（至少一行提到 `nook workspace`；可以只是最小可行的一句，
  完整章節留給票 05）
- `test/cli/workspace.test.ts`（新檔）
- `test/render/table.test.ts`（擴充，補 `renderWorkspaceList` 的案例）

**不得碰**：`src/core/*`（票 01 已定案的介面）、`src/server/*`。

## Shared resources

None。

## Blocked by

票 01（`openWorkspace`/`Workspace` 型別必須先存在）。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
