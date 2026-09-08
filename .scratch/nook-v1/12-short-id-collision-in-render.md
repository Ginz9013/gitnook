# 12 短 ID 碰撞的渲染側接線

## Outcome

看板卡片的連結與表格的短 ID 欄，長度足以讓該批 Issue 彼此無歧義。core 的能力（`shortIdLength`）已於票 04 就位，這張票只做接線。

## 背景

票 08 發現、票 04 驗證：`src/render/table.ts` 與 `src/render/html.ts` 各有一個 `shortId()` 盲取 6 碼且不檢查碰撞。`html.ts` 的 `card()` 用它組 `href="/i/${short}"` —— 兩張前綴相同的 Issue 會產生**一模一樣的連結**，點進去必然有一張永遠打不開。票 08 的 golden fixture 曾意外撞上這個情況。

## Acceptance criteria

- [ ] `renderTable(issues)` 的短 ID 欄以 `shortIdLength(issues.map(i => i.id))` 決定長度，而非寫死 6
- [ ] `renderBoardHtml(issues)` 的卡片連結同樣如此
- [ ] 兩張前綴相同的 Issue 在同一個看板上產生**不同**的連結，且各自能被 `board.get()` 解析回正確的 Issue
- [ ] 沒有碰撞時長度仍為 6，既有 golden 檔不變（若變了，那是 bug）
- [ ] 詳情視圖（單張 Issue）無從得知整批的情況 —— 明確決定它顯示什麼並寫進註解
- [ ] 兩處的 `shortId()` 不得各自保留一份長度邏輯。重複的比較器正是 comment 排序分歧的成因（見 commit 463343d）
- [ ] token 預算閘門仍需通過：短 ID 變長會直接增加 `list` 的輸出，而 `list` 已佔 69% 的預算、餘裕僅 386B

## Test seam

`renderTable()` 與 `renderBoardHtml()` 純函數，直接單元測試，輸入為 `Issue[]` 字面值。

## Write ownership

- `src/render/table.ts`
- `src/render/html.ts`
- `test/render/table.test.ts`
- `test/render/html.test.ts`
- `test/render/__golden__/`（既有檔案；若輸出改變需確認差異合理後才更新）

## Shared resources

None

## Blocked by

04, 09（票 09 會窄幅修改 `src/render/html.ts`，不可同批）

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
