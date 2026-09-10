# 03 `nook workspace doctor`：跨子專案的健康檢查

nook ref：`01M26B1WJ8S8KT5D0C50X0TVAR`

## Outcome

`nook workspace doctor` 一次檢查母資料夾底下每個子專案的資料健康狀態，
任一個不健康就讓整個指令 exit 非 0；`--fix` 能一次修復每個需要修的成員。

## Acceptance criteria

- [ ] 三個成員、其中一個有 diagnostic（例如缺 `merge=union`）——指令印出
      那個成員的路徑與它的 diagnostic，其餘兩個健康的成員不印任何東西，
      exit 1
- [ ] 全部成員健康時完全沉默、exit 0（同單一 Board `doctor` 的既有慣例：
      沒消息就是好消息）
- [ ] `--fix` 對每個有 diagnostic 的成員各自呼叫既有、未經修改的
      `repair(member.path)`，修完印出對應的 `Repaired ...` 行，且**沿用
      現有 `repair()`，不新增或修改它的行為**
- [ ] 空 workspace（掃不到任何成員）時 `doctor` 沉默、exit 0
- [ ] 每一行輸出都清楚標出是哪個成員路徑的 diagnostic，不會讓人誤以為
      是母資料夾自己的問題

## Test seam

`dispatchWorkspace(['doctor', ...], io)`（`test/cli/workspace.test.ts`，
延續票 02 的檔案），真實 `mkdtemp` 樹 + 真實 git repo（沿用
`test/core/health.test.ts`／`test/core/gitattributes.test.ts` 造健康/不健康
board 的既有手法，對多個子目錄各造一份）。

## Write ownership

- `src/cli/workspace.ts`（延續票 02 的檔案，新增 `doctor` 子指令與
  `--fix` 處理）
- `test/cli/workspace.test.ts`（延續票 02 的檔案，新增 `doctor` 案例）

**不得碰**：`src/core/health.ts`（`repair()`/`diagnose()` 原封不動重用）、
`src/render/table.ts`、`src/server/*`。

## Shared resources

暫存 git repo（多個，各自獨立）。不得寫入這個 repo 自己的 `.issues/`。

## Blocked by

票 02——同一個檔案 `src/cli/workspace.ts` 與 `test/cli/workspace.test.ts`，
且需要票 02 建好的 `dispatchWorkspace` 框架與子指令分派結構。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
