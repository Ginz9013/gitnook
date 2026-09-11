# 07 `nook workspace rm <ref>`

nook ref：`01M279924WJD2JAEDWSF0VR5SX`

## Outcome

`nook workspace rm <ref>` 找到擁有 `<ref>` 的成員並刪除它，確認句與最終
輸出都標示是哪個成員，因為救援步驟需要先知道那個資訊。

## Acceptance criteria

- [ ] 確認句格式類似「刪除 `<相對路徑>` 底下的 `<title>`？(y/N)」——重用
      既有 `confirmed(io, title)`，不改它的簽章，只是把組好的字串當
      `title` 傳進去
- [ ] 非 TTY 且未給 `--yes` → 拒絕，同單一 Board 版本的既有規則
- [ ] `--yes` 或確認 `y` 之後，正確的成員被寫入 `deleted: true`，其餘成員
      不受影響；最終輸出也標示成員路徑
- [ ] 對已經刪除的 issue 呼叫 → 印出的訊息標示成員路徑，並指向
      `nook workspace set <ref> deleted false` 復原（不是單一 Board 版本
      的 `nook set`）、以及提示要看寫過的值得先 `cd` 進那個成員用
      `nook history`（這次沒有 workspace 版的 `history`）
- [ ] 短前綴、找不到、找到多個的錯誤路徑同票 03（重用同一套機制）

## Test seam

`dispatchWorkspace(['rm', ...], io)`（`test/cli/workspace.test.ts`，延續
既有檔案，含互動確認與 `--yes` 兩條路徑，同 `test/cli/run.test.ts` 既有
測 `rm` 的手法）。

## Write ownership

- `src/cli/run.ts`（把 `confirmed` 加上 `export`，不改它的簽章或行為）
- `src/cli/workspace.ts`（延續既有檔案，新增 `rm` 子指令與
  `workspaceDeletedMessage()` 這個新函式——內容與單一 Board 版本的
  `deletedMessage` 不同，不是重用）
- `test/cli/workspace.test.ts`（延續既有檔案）

**不得碰**：`src/core/*`、`src/render/*`、`src/server/*`。

## Shared resources

None。

## Blocked by

票 06——同一個檔案 `src/cli/workspace.ts`。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
