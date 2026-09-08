# 02 LWW 欄位更新（status / title / description / archived）

## Outcome

`apply(ref, { status: 'in_progress' })` 追加一個 `set` op，fold 後回傳更新的 `Issue`。並行的兩個 `set` 依 `(t, a, id)` 全序收斂，不論檔案內順序如何。

## Acceptance criteria

- [ ] `apply(ref, { status })` / `{ title }` / `{ description }` / `{ archived }` 各自產生一個 `set` op 並正確 fold
- [ ] 8 個合法 status 之外的值拋出 `InvalidStatus`
- [ ] status 接受無歧義前綴（`in_p` → `in_progress`）；8 個值之間無前綴撞號
- [ ] **屬性測試**：同一組 `set` op 以任意順序寫入檔案，fold 結果恆等 —— 交換律
- [ ] **屬性測試**：同一個 op 重複注入 N 次，fold 結果恆等 —— 冪等性（dedupe by `id`）
- [ ] 相同 `t` 時以 `a` 再以 `id` 決勝，結果確定
- [ ] 每次 append 後檔案仍以 `\n` 結尾
- [ ] description 接受含換行的 markdown 字串，原樣存回（資料層不解析其內容）

## Test seam

`openBoard()` 整合測試 + `reduce()` 內部接縫的屬性測試。

## Write ownership

- `src/core/ops.ts`
- `src/core/reduce.ts`
- `src/core/board.ts`
- `src/core/types.ts`
- `test/core/board.set.test.ts`
- `test/core/reduce.convergence.test.ts`

## Shared resources

暫存目錄。

## Blocked by

01

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
