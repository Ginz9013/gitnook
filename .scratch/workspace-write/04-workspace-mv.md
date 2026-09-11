# 04 `nook workspace mv <ref> <status>`

## Outcome

`nook workspace mv <ref> <status>` 找到擁有 `<ref>` 的成員並搬動它的
status，是 `set <ref> status <value>` 的捷徑，同單一 Board 版本的既有
定位。

## Acceptance criteria

- [ ] 完整 ULID 對到正確的成員時，status 被正確更新，其餘成員不受影響
- [ ] `<status>` 接受無歧義前綴（`que` → `queued`），同單一 Board 版本
- [ ] 短前綴 ref、任何成員都不擁有的 ref，行為與票 03 的 `set` 一致（同一套
      `requireFullRef`/`locateInWorkspace` 錯誤路徑，不重新設計）
- [ ] 不合法的 status → 既有的 `InvalidStatus` 原樣冒出

## Test seam

`dispatchWorkspace(['mv', ...], io)`（`test/cli/workspace.test.ts`，延續
既有檔案）。

## Write ownership

- `src/cli/workspace.ts`（延續既有檔案，新增 `mv` 子指令——重用票 03的
  `requireFullRef`，不重寫）
- `test/cli/workspace.test.ts`（延續既有檔案）

**不得碰**：`src/cli/run.ts`（這張票不需要新的 export）、`src/core/*`、
`src/render/*`、`src/server/*`。

## Shared resources

None。

## Blocked by

票 03——同一個檔案 `src/cli/workspace.ts`，且需要它已經定案的
`requireFullRef()` 輔助函式。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
