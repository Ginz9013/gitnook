# 02 把「500 的 log 只有 message」寫成刻意的決定

nook ref：`01M233AA2P9R8FD3D1GTEEJD1C`

## Outcome

**決定是「不做」。** 這張票的交付物是理由，不是程式碼。

`logUnexpected` 取自 `out.body`，而 `serverError` 只保留 `err.message`，
所以未預期的 500 在終端機上只留下一行沒有位置資訊的訊息。

要取回 stack 就得讓 `handleRequest` 在回應之外另外保留原本的 error ——
決定是**不划算**：`handleRequest` 的純函數性質這一批貨了很多次（500 兜底
能不綁 port 就測、rejection 路徑在構造上不存在、`logUnexpected` 靠狀態碼
而不必看到原始 Error）。而且 studio 只綁 loopback，真出事時使用者就在那台
機器上，造得出重現步驟。

## Acceptance criteria

- [ ] 在 `logUnexpected` 的註解裡寫明：只有 message、沒有 stack，**這是刻意的**
- [ ] 寫出為什麼取回更多的代價太高（上面那兩個理由）
- [ ] 註解要符合這個 repo 的標準：解釋**為什麼**、以及不這樣做會壞掉什麼。
      先讀 `src/core/board.ts` 與 `src/render/table.ts` 校準
- [ ] **零行為改動。** 一行程式碼都不要改

## Test seam

無 —— 這是註解。既有測試必須維持全綠且**一條都不改**。

## Write ownership

- `src/server/serve.ts`

**不得碰**任何其他檔案，包括 `src/server/handler.ts`。

## Blocked by

無。

## Status

queued
