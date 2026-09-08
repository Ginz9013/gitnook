# 01 建立一張 issue 並讀回來

## Outcome

`openBoard().create({ title })` 寫出一個合法的 NDJSON op-log 檔，`get(ref)` 把它 fold 回一個 `Issue`。這是貫穿儲存層到領域層的第一顆曳光彈。

工具鏈屬於第一個需要它的切片，所以在這張票內建立。

## Acceptance criteria

- [ ] `create({ title })` 產生 `.issues/issues/<ULID>.ndjson`，內含**恰好一行** `create` op 且**以 `\n` 結尾**
- [ ] `get(fullUlid)` 回傳含該 title 的 `Issue`
- [ ] 未 `init` 的目錄呼叫 `create` 拋出 `BoardNotInitialized`
- [ ] 注入種子化 `IdSource` 時，ULID 與 lamport 值可完全重現
- [ ] `src/core/types.ts` 一次定義**完整**的 `Issue` / `Status` / `Change` / `Filter` / `Diagnostic` / `IdSource` 型別（含 labels、comments、archived），即使本票尚未填入 —— 這讓渲染層的票能立刻平行開工
- [ ] `Board` 的其餘方法宣告存在但拋出 `NotImplemented`，由各自的票填入

## Test seam

`openBoard()` —— 整合測試，真實檔案系統、暫存目錄。`IdSource` 注入種子化 adapter。

不使用 in-memory storage fake（見 spec 的「兩個刻意不設的接縫」）。

## Write ownership

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `.gitignore`
- `src/core/types.ts`
- `src/core/ops.ts`
- `src/core/reduce.ts`
- `src/core/board.ts`
- `src/core/ids.ts`
- `src/core/actor.ts`
- `src/index.ts`
- `test/core/board.create.test.ts`

同時建立以下**空殼**（`throw new NotImplemented()`），供後續票填入而不必回頭改 `board.ts`：
`src/core/gitattributes.ts`、`src/core/health.ts`

## Shared resources

暫存目錄（每個測試用例獨立 `mkdtemp`）。

## Blocked by

None

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
