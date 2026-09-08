# 04 list 過濾與 ref 前綴解析

## Outcome

`list()` 掃描整個 `.issues/issues/`、fold 每一份、依過濾條件回傳 `Issue[]`。`get('01JBX7')` 以無歧義前綴解析到完整 ULID。

## Acceptance criteria

- [ ] `list()` **預設隱藏** `archived` 為 true 者，以及 status 為 `done` / `cancelled` 者
- [ ] `list({ all: true })` 回傳全部
- [ ] `list({ status: 'queued' })` 只回傳該狀態；status 接受無歧義前綴
- [ ] `list({ labels: [...] })` 依 label 過濾
- [ ] 回傳順序確定（建議依 ULID，即建立時間）
- [ ] `get('01JBX7')` 前綴唯一時解析成功
- [ ] 前綴撞到多筆時拋出 `AmbiguousRef`，訊息列出候選的短 ID
- [ ] 前綴無對應時拋出 `RefNotFound`
- [ ] **短 ID 的顯示長度必須考慮碰撞**（票 08 發現）：`shortId()` 目前盲取 6 碼且不檢查碰撞，兩張前綴相同的 Issue 會產生一模一樣的卡片連結。渲染層是使用者最先察覺的地方，但解析責任在 core。請提供一個能回答「這批 Issue 需要幾碼才無歧義」的函式供渲染層使用
- [ ] 空的 board 回傳 `[]`，不拋錯
- [ ] 目錄含非 `.ndjson` 檔時忽略之，不拋錯
- [ ] 500 張票的 `list()` 在 100ms 內完成（spec 實測基準為 14ms，此處留寬裕餘裕以免成為脆弱測試）

## Test seam

`openBoard()` 整合測試，真實檔案系統。

## Write ownership

- `src/core/board.ts`
- `src/core/ids.ts`
- `src/core/types.ts`
- `test/core/board.list.test.ts`
- `test/core/ids.prefix.test.ts`

## Shared resources

暫存目錄。500 票的測試需產生對應檔案，應在單一 `mkdtemp` 內完成後清除。

## Blocked by

03

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
