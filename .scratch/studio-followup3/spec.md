# Spec — 500 這條路徑說得清楚

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`）。

## 問題

前一批讓 server 的未預期例外回 500 而不是帶掉 process，也讓前端分得出
「連不上」與「伺服器回了錯誤」。但那條路徑上還有三個洞，全部由票 02 的
worker 在做的當下發現、並刻意不越界處理：

1. **studio 的 500 什麼都沒 log。** 除了那份 HTTP 回應之外不留任何痕跡。
2. **server 的 500 訊息到不了畫面。** `serverError` 刻意送了一則可行動的
   訊息，橫幅卻只說「最可能的原因」。
3. **200 但 body 解析不了會被歸類成「連不上」。** 伺服器確實答了。

三張 issue 收成兩張票：後兩者都要動 `api.ts` / `poll.ts` / `poll.test.ts`，
而且 YK 提的修法（`ConnectionFault` 變成帶得動訊息的形狀）正是 YM 需要的
前置 —— 分開必然碰撞。

## 已定案，不得重新討論

- **`handleRequest` 是純函數，不接觸 `node:http`。** 前一批才剛為了這個理由
  把 500 的兜底放進它裡面而不是 `serve.ts` 的 callback 外圍（那裡接不到
  `.then()` 續行拋的東西）。log 是副作用，**不得**放進 `handleRequest`。
- **`serve.ts` 的 `createServer` callback 裡刻意沒有 try/catch**，而且那段
  註解明說不要加一個。理由同上。
- 只綁 loopback，`--host` 永遠不做（ADR-0007）。
- 只測純邏輯，React 組件不寫測試；**不得**引入 jsdom / `@testing-library/*` /
  playwright；**不得**為了可 mock 而發明只有單一 adapter 的假接縫（ADR-0004）。
- 輪詢門檻不變：連續三次失敗進入中斷、一次成功解除。那個不對稱是刻意的。

## 非目標

- 不改 `src/core/**`、`src/render/**`
- 不新增任何相依
- 不改輪詢間隔、不改 `/hash` 契約

## 硬指標

六列閘門全綠，**CLI bundle 的 React 痕跡必須是 0**。

## 驗證指令

```bash
npx vitest run <該票的測試檔>
npx vitest run
npx tsc --noEmit
npx vite build
```

`npm run bench` 由整合者最後統一跑 —— 它會 `npm pack` 進而重建 `dist/`。

## 基線（實測）

**380 tests passed / 25 files、0 型別錯誤、六列閘門全綠。**

## 共用資源與環境風險

- 使用者可能正在 `127.0.0.1:4780` 跑 studio，從 `dist/studio/` 讀資產。
  **不要跑 `npx tsup`**（會清掉整個 `dist/`）**也不要跑 `npm run bench`**。
  `npx vite build` 可以。
- **不得寫入這個 repo 的 `.issues/`。** 測試自己 `mkdtemp`。
- Port 一律綁 0。
- **`package.json` 沒有人可以動。**

## 批次計畫

| 批次 | 票 | 平行度 |
|---|---|---|
| B1 | 01 ∥ 02 | **2** |

兩張互斥：票 01 只碰 `src/server/`，票 02 只碰 `src/studio/`。

## 寫入所有權矩陣

| 票 | 擁有的檔案 |
|---|---|
| 01 | `src/server/serve.ts` `test/server/serve.test.ts` |
| 02 | `src/studio/api.ts` `src/studio/poll.ts` `src/studio/App.tsx` `test/studio/poll.test.ts` |
