# 05 `nook workspace comment <ref> <body>`

## Outcome

`nook workspace comment <ref> <body>` 找到擁有 `<ref>` 的成員並幫它加一則
留言，不必先 `cd` 進那個成員。

## Acceptance criteria

- [ ] 完整 ULID 對到正確的成員時，留言被正確加上，其餘成員不受影響
- [ ] `<body>` 接受 `-` 從 stdin 讀，同單一 Board 版本（多行內容不必處理
      shell 跳脫）
- [ ] 短前綴、找不到、找到多個的錯誤路徑同票 03（重用同一套機制）

## Test seam

`dispatchWorkspace(['comment', ...], io)`（`test/cli/workspace.test.ts`，
延續既有檔案）。

## Write ownership

- `src/cli/workspace.ts`（延續既有檔案，新增 `comment` 子指令）
- `test/cli/workspace.test.ts`（延續既有檔案）

**不得碰**：`src/cli/run.ts`（`longText`/`STDIN` 已在票 02 export 過）、
`src/core/*`、`src/render/*`、`src/server/*`。

## Shared resources

None。

## Blocked by

票 04——同一個檔案 `src/cli/workspace.ts`。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
