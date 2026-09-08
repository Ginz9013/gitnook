# 03 labels 的 OR-Set 與 comments

## Outcome

`apply(ref, { labels: { add: ['bug'] } })` 與 `{ labels: { remove: ['bug'] } }` 遵守 **add-wins** 語意；`apply(ref, { comment: '...' })` 追加一則留言，依 `(t, a)` 排序成時間軸。

呼叫端**永遠不需要知道 `seen` 集合的存在** —— 那是這張票要藏進 `Board` 的複雜度。

## Acceptance criteria

- [ ] `label.add` 產生帶 `v` 的 op；`label.rm` 產生帶 `v` **與 `seen`（它觀察到的 add op id 集合）** 的 op
- [ ] **add-wins 屬性測試**：分支 A 移除 `bug`（`seen` 含 add₁），分支 B 並行新增 `bug`（產生 add₂）。合併後 `bug` **必須存在** —— add₂ 不在 A 的 `seen` 內
- [ ] 循序的 add → rm 後，label 不存在
- [ ] 重複 add 同一個 label 不產生重複項
- [ ] `comment` op 追加後出現在 `Issue.comments`，依 `(t, a)` 排序
- [ ] comment body 接受含換行的 markdown，原樣存回
- [ ] labels 與 comments 的 fold 同樣通過順序無關與冪等的屬性測試

## Test seam

`openBoard()` 整合測試 + `reduce()` 屬性測試。並行情境以「兩個 op 集合交錯合併」在單一檔案內模擬（真實 git 的合併留給票 05）。

## Write ownership

- `src/core/ops.ts`
- `src/core/reduce.ts`
- `src/core/board.ts`
- `src/core/types.ts`
- `test/core/board.labels.test.ts`
- `test/core/board.comments.test.ts`

## Shared resources

暫存目錄。

## Blocked by

02

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
