# 06 `nook workspace label <ref> +bug -ui`

nook ref：`01M2798TATRSZ1GAG65EBPGHTZ`

## Outcome

`nook workspace label <ref> +bug -ui` 找到擁有 `<ref>` 的成員並加減它的
label，不必先 `cd` 進那個成員。

## Acceptance criteria

- [ ] 完整 ULID 對到正確的成員時，label 的 add/remove 被正確套用，其餘
      成員不受影響
- [ ] 缺少正負號或空 label（例如 `bug` 而不是 `+bug`）→ 拒絕，訊息同單一
      Board 版本
- [ ] 短前綴、找不到、找到多個的錯誤路徑同票 03（重用同一套機制）
- [ ] 加減 token 的解析邏輯不在這張票裡重寫一份——如果單一 Board 版本
      （`cmdLabel`）目前是把解析邏輯寫死在函式內，這張票要順手把它抽成
      一個小的匯出函式（例如 `parseLabelTokens(tokens)`）供兩邊重用，
      而不是複製貼上同一段迴圈

## Test seam

`dispatchWorkspace(['label', ...], io)`（`test/cli/workspace.test.ts`，
延續既有檔案）。

## Write ownership

- `src/cli/run.ts`（把 label token 解析邏輯抽成匯出函式，單一 Board 版本
  的 `cmdLabel` 改呼叫它，行為不變）
- `src/cli/workspace.ts`（延續既有檔案，新增 `label` 子指令）
- `test/cli/workspace.test.ts`（延續既有檔案）

**不得碰**：`src/core/*`、`src/render/*`、`src/server/*`。

## Shared resources

None。

## Blocked by

票 05——同一個檔案 `src/cli/workspace.ts`。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
