# 04 nook decision history（唯讀修改紀錄）

nook ref：`01M2HBAFHWW91F0S5HWDVYHAV3`

## Outcome

`nook decision history <ref> [field]`：列出某個 Decision 某個欄位（或
全部欄位）曾經被寫過的所有值，帶 actor 與 lamport `t`。同票 09（Issue
的 `history`）的先例：**唯讀，不做 restore**——看得到就拿得回來（手動
`nook decision set` 貼回去），restore 的語意留給真的痛了再定。

## Acceptance criteria

- [ ] `decisionFieldWrites(ops, field?)`（票 01 已定義介面）：`create`
      op 帶的 `title` 折成第一筆 `set` write，不折的話「這個欄位從沒
      被寫過」會是假話
- [ ] `DecisionLog.opLog(ref)`（票 01 已實作）：回傳唯讀、依全序排好
      的原始 op——排序沿用 `oplog.ts` 的 `orderOps`，**不在 CLI 或渲染層
      另寫一份比較器**（這正是這個 repo commit 463343d 那個 bug 的
      成因，`decisionReduce.ts`/`decisionLog.ts` 的相關程式碼應該已經
      註明這一點）
- [ ] `nook decision history <ref>`：不帶欄位時列出全部欄位的寫入紀錄
      （行為由你決定，比照 Issue `history` 既有的選擇並說明理由）
- [ ] `nook decision history <ref> disposition`：只列 disposition 欄位
      的寫入
- [ ] 輸出走既有的 compact table 風格（ADR-0005）
- [ ] `history` 不寫入任何 op——純讀取
- [ ] **不做 restore**——不要順手加，那是另一個決定

## Test seam

`decisionFieldWrites()`——純函數單元測試。`dispatchDecision(argv, io)`
的 `history` 分支——CLI 整合測試。

## Write ownership

- `src/cli/decision.ts`（擴充 `history`）
- `src/render/table.ts`（decision history 的呈現，可能與票 02 的
  decision table 共用底層 helper，但這張票落地時票 02 應該已經合併，
  照當時的 `table.ts` 現狀擴充）
- `test/cli/decision.test.ts`（擴充）
- `test/render/table.test.ts`（擴充）

**不得碰**：`src/core/decisionReduce.ts`（`decisionFieldWrites` 的介面
已在票 01 定義，這裡只是使用它；若發現介面需要調整，先確認不影響票 01
已經落地的行為）。

## Shared resources

None。

## Blocked by

票 01（`decisionFieldWrites`／`opLog`）。**與票 02、03 對
`src/cli/decision.ts` 是同一個檔案，三張票必須序列化執行**，建議排在
02、03 之後執行以降低衝突。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
