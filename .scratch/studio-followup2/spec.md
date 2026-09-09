# Spec — studio 收尾批

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`）。

## 問題

前兩批（`studio-write` 12 張、`studio-followup` 7 張）留下的五個 backlog 項目。
全部來自 worker 回報與兩軸審查，沒有一張是規劃時就知道的。

五張 issue 收成四張票：用詞一致性與 `STATUSES` 別名合併（都只碰註解層，
且共用 `board/dnd.ts`，分開必然碰撞）。

## 已定案，不得重新討論

沿用 `docs/adr/0001`–`0008`、`CONTEXT.md`、以及前兩批 spec 的測試策略。

**但這一批要修正那條測試策略被我寫壞的部分。** 原文是「只測純邏輯，
**React 組件**不寫測試」，我在多張票面寫成「本片段無自動化測試」，
把純模組也一起豁免掉了。票 03 就是在補這個洞 —— 它**不是**放寬策略，
而是回到策略原本的樣子：純函式要測，React 組件仍然不測，
仍然不得引入 jsdom / `@testing-library/*` / playwright。

## 非目標

- 不改行為（票 02 除外，它本來就是行為決定）
- 不動 `src/core/**`、`src/server/**`、`src/render/**`
- 不引入任何新的測試框架或相依

## 硬指標

六列閘門全綠。特別注意 **CLI bundle 的 React 痕跡必須是 0**。

## 驗證指令

```bash
npx vitest run <該票的測試檔>
npx vitest run
npx tsc --noEmit
npx vite build
npm run bench          # 最後跑，且不要與別人同時跑
```

## 基線（2026-09-09 實測）

**313 tests passed / 24 files、0 型別錯誤、六列閘門全綠。** 基線乾淨。

## 共用資源與環境風險

- **使用者正在 `127.0.0.1:4780` 跑 studio**，從 `dist/studio/` 讀資產。
  單獨跑 `npx tsup` 會清掉整個 `dist/` 讓它壞掉。要 build 用 `npx vite build`；
  **不要跑 `npm run bench`**（它會 `npm pack` 進而重建 dist）——
  由整合者最後統一跑。
- **不得寫入這個 repo 的 `.issues/`。**
- Port 一律綁 0，暫存目錄各自 `mkdtemp`。
- **`package.json` 這一批沒有人可以動。** 需要新相依就回報 blocked。

## 批次計畫

| 批次 | 票 | 平行度 |
|---|---|---|
| B1 | 01 ∥ 02 ∥ 03 ∥ 04 | **4** |

四張兩兩互斥，一輪跑完。

## 寫入所有權矩陣

| 票 | 擁有的檔案 |
|---|---|
| 01 | `src/studio/reconcile.ts` `test/studio/reconcile.test.ts` |
| 02 | `src/studio/poll.ts` `src/studio/api.ts` `src/studio/App.tsx` `test/studio/poll.test.ts` |
| 03 | `test/studio/board.test.ts`（新，**只寫這一個檔**） |
| 04 | `src/studio/board/{Card,dnd,focus,Board}.*` `src/studio/drawer/changes.ts` `src/studio/drawer/StatusPicker.tsx` |
