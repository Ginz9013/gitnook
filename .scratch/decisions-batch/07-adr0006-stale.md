# 07 ADR-0006 說 `list` 的短 ID 尚未修，但它已經修了

nook ref：`01M233WYK2K9969H95BEK8YP8C`

## Outcome

純文件。ADR-0006 的 `## Consequences` 最後一段寫著「同源但尚未修的一處記在
spec 的 Risks：`list` 對**過濾後**的集合算長度…所以它印出的 ref 可能被 `show`
判為有歧義。正確的解是讓 `Board` 提供一個只列舉、不摺疊的廉價 id 來源。」

**已經修了。** `src/cli/run.ts` 的 `cmdList` 傳的是 `displayLength(board)`，
而它是 `shortIdLength(board.refs())` —— 整塊 board。六個 CLI 呼叫點全都明確傳入。

而且**實際修法與 ADR 的預測不同**：ADR 說「要修得把解析用的候選集合傳進渲染層，
會改變 `renderTable` 的簽章」，實際上是傳一個算好的長度進去（`renderTable` 的
第二個參數本來就存在）。`board.refs()` 就是 ADR 說的那個「只列舉、不摺疊的廉價
id 來源」，它在 v1 的票 15 就加上了。

## Acceptance criteria

- [ ] **先自己查證再改。** 讀 `src/cli/run.ts` 的 `displayLength` 與 `cmdList`，
      確認上面說的成立。若發現我說錯了，**回報而不是照抄** —— 這一批已經有
      三次 worker 修正我的描述
- [ ] ADR-0006 的最後一段改寫：說明它已經修了、以及實際修法與當初預測的不同。
      不要把段落刪掉 —— 記錄預測與實際的落差本身就是有價值的
- [ ] `.scratch/nook-v1/spec.md` 的 Risks 裡「渲染層的短 ID 無歧義只在它拿到
      的那一批之內成立」是同一件事的另一個說法，一併標為已解決
- [ ] `.scratch/nook-v1/spec.md` 裡若還有其他已被這一批決定推翻的條目
      （例如 blocked 那條規則），**回報但不要動** —— 那超出這張票

## Test seam

無 —— 純文件。既有測試必須維持全綠。

## Write ownership

- `docs/adr/0006-short-refs-are-for-display-full-ulids-for-delivery.md`
- `.scratch/nook-v1/spec.md`

**不得碰**：`src/**`、`test/**`、其他 ADR。

## Blocked by

無。

## Status

queued
