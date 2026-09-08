# 07 緊湊表格與 JSON 輸出（含 token 預算閘門）

## Outcome

`renderTable(issues)` 產生**人與 agent 共用**的預設輸出。這是四個硬指標中 agent token 成本的量測對象。

## Acceptance criteria

- [ ] `renderTable(issues)` 輸出對齊的緊湊表格：短 ID（6 碼）、status、title、labels
- [ ] `renderTable(issue)` 的詳情視圖含 description 與 comments 時間軸
- [ ] 欄寬依內容自適應；title 過長時截斷且不破壞對齊
- [ ] 空清單輸出簡短訊息，非空表頭
- [ ] `renderJson()` 輸出穩定排序的 JSON（供程式化串接）
- [ ] **golden file 測試**：固定的種子化輸入產生完全一致的輸出
- [ ] **token 預算閘門**：spec 定義的 40 票情境（`list` → `show` → `mv` → `comment` 的全部輸出，加上 agent skill 文件）總和 **< 4KB**，超過即 CI fail
- [ ] 該閘門測試在訊息中印出實際 byte 數與餘裕，讓超標時能立刻看出是哪一部分膨脹

## Test seam

純函數，直接單元測試。輸入是 `Issue[]` 字面值，不需要 `Board`。

## Write ownership

- `src/render/table.ts`
- `src/render/json.ts`
- `test/render/table.test.ts`
- `test/render/token-budget.test.ts`
- `test/render/__golden__/`

## Shared resources

None

## Blocked by

01

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
