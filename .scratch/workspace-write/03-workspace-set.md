# 03 `nook workspace set <ref> <field> <value>`

## Outcome

`nook workspace set <ref> <field> <value>` 找到擁有 `<ref>` 的成員並更新
它的一個欄位，不必知道也不必先 `cd` 進那個成員。

## Acceptance criteria

- [ ] 完整 ULID 對到正確的成員時，欄位被正確更新，其餘成員完全不受
      影響；回印的是更新後那一行（同單一 Board 版本，不加成員路徑）
- [ ] 給短前綴（哪怕在某個成員裡其實無歧義）→ 拒絕，訊息講清楚跨 board
      操作需要完整 ULID
- [ ] 給一個任何成員都不擁有的完整 ULID → `RefNotFoundInWorkspace`
- [ ] `--editor` 語意與單一 Board 版本一致（以現值開場、非 TTY 報錯）
- [ ] 欄位驗證（`title|description|status|archived|deleted`）與非法欄位
      的錯誤訊息跟單一 Board 版本一致
- [ ] 對已刪除的 issue 寫入（`deleted` 除外）→ 既有的 `IssueDeleted`
      錯誤原樣冒出

## Test seam

`dispatchWorkspace(['set', ...], io)`（`test/cli/workspace.test.ts`，延續
既有檔案）。

## Write ownership

- `src/cli/run.ts`（把 `asChange`、`SETTABLE`、`isSettable`、
  `BOOLEAN_FIELDS` 加上 `export`；`USER_ERRORS` 加入 `IncompleteRef`、
  `RefNotFoundInWorkspace`、`AmbiguousWorkspaceRef`）
- `src/cli/workspace.ts`（延續既有檔案，新增 `set` 子指令與
  `requireFullRef()` 輔助函式）
- `test/cli/workspace.test.ts`（延續既有檔案）

**不得碰**：`src/core/*`、`src/render/*`、`src/server/*`。

## Shared resources

None。

## Blocked by

票 02——同一個檔案 `src/cli/workspace.ts` 與 `src/cli/run.ts`。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
