# 01 Workspace 核心：遞迴掃描找出全部成員 Board

nook ref：`01M26B1D69HPMJV7DSTSR33PC6`

## Outcome

`openWorkspace({ dir })` 能對一棵真實的目錄樹，掃出全部含 `.issues/issues/`
的子目錄，各自包成一個已經 `openBoard()` 好的成員，且不會誤把
`node_modules`／`.git`／symlink 環路／巢狀更深處的 Board 算進來。

## Acceptance criteria

- [ ] 三層巢狀樹（`a/.issues/issues`、`a/b/.issues/issues`、
      `a/b/c/.issues/issues`）——只有 `a` 是成員，找到就停止往下鑽，`a/b`、
      `a/b/c` 都不出現在 `members` 裡
- [ ] 起始目錄自己含 `.issues/issues/` 時，它本身也出現在 `members` 裡
- [ ] `node_modules/foo/.issues/issues/`、`.git/foo/.issues/issues/` 這種
      刻意造出來的路徑不被列為成員（用真實檔案系統造出這兩個目錄名，
      不是靠白名單比對路徑字串以外的邏輯）
- [ ] 造一個指回上層目錄的 symlink，掃描要正常結束（不卡死、不重複列出
      同一個成員兩次）
- [ ] 完全沒有任何成員時 `openWorkspace()` **不拋錯**，`members` 是空陣列
- [ ] 讀某個子目錄失敗時（例如用 `chmod` 造一個不可讀的子目錄，POSIX 環境
      下可測）跳過那一支，掃描其餘部分照常完成，不整個中止
- [ ] `members` 依 `path`（絕對路徑）字典序排序，同一棵樹多次呼叫結果穩定
- [ ] `Workspace.root()` 回傳呼叫時傳入的 `dir`（預設 `process.cwd()`）的
      絕對路徑
- [ ] 每個 `WorkspaceMember.board` 是一個功能完整的 `Board`（用它
      `create()` 一張 issue、再用它 `list()` 讀回來，驗證不是空殼）

## Test seam

`openWorkspace()`（`test/core/workspace.test.ts`，新檔）。沿用 ADR-0004與
既有 `test/core/board.root.test.ts` 的手法：每個測試案例一棵獨立的
`mkdtemp` 樹，真實 `mkdirSync` 造拓撲，不引入 mock 檔案系統。

## Write ownership

- `src/core/types.ts`（新增 `Workspace`、`WorkspaceMember`、
  `OpenWorkspaceOptions` 三個型別，不動既有型別）
- `src/core/workspace.ts`（新檔）
- `src/index.ts`（新增 `openWorkspace` 與三個型別的匯出）
- `test/core/workspace.test.ts`（新檔）

**不得碰**：`src/cli/*`、`src/render/*`、`src/server/*`——這票純粹是
core，沒有任何指令看得到它。

## Shared resources

None。全部在各自獨立的 `mkdtemp` 暫存目錄裡操作。

## Blocked by

None——這是第一張票，沒有共用檔案的前置依賴。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
