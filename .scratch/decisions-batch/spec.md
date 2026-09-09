# Spec — 十個已定案決定的執行

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`）。

## 這一批的性質，讀完再動手

十張票的決定**全部已經定案**，逐張寫在該票的 nook comment 裡。
**不要重新討論任何一個決定** —— 你的工作是執行它們。

**十張裡有四張的決定是「不做」。** 它們不是實作票：交付物是把「為什麼決定
不做」寫進註解或 ADR，讓下一個讀到的人知道**這是想過的，不是漏掉的**。
把它們當成實作票硬做是這一批最容易犯的錯。

## 最大的一個決定

`blocked` 那條「必須同時留下 Comment 說明原因」的規則**整條拿掉**。

使用者的原話：**「沒有這一條，都拿掉，他就只是一個狀態，不應該還要有額外效果。」**

這比原本列的三個選項（硬規則／提醒／刻意不同）更上游 —— 它一次解掉了 CLI
與 studio 的行為分歧、`dropEffect` 的一個分支、blocked 閘門的存在理由，
以及 ADR-0003 的內部矛盾。

連帶：ADR-0003 用那條規則 justify「`blocked` 留在 Status 而 `archived` 被拆
成欄位」，論證因此垮掉。決定是**改寫 ADR 接受資訊遺失**，`blocked` 維持是
Status —— ADR-0003 另一條理由（八個固定值讓 agent 不必先查詢這個專案有哪些
狀態）不受影響。

## 已定案，不得重新討論

沿用 `docs/adr/0001`–`0008`（0001 / 0003 / 0006 這一批會被改寫）、
`CONTEXT.md`、以及前幾批 spec 的測試策略：

- **只測純邏輯，React 組件不寫測試。** 不得引入 jsdom、`@testing-library/*`、
  playwright
- **不得為了可 mock 而發明只有單一 adapter 的假接縫**（ADR-0004）
- **studio bundle 不得被 CLI 進入點 import**（ADR-0008）
- 只綁 loopback，`--host` 永遠不做（ADR-0007）

## 硬指標

六列閘門全綠，**CLI bundle 的 React 痕跡必須是 0**。

## 驗證指令

```bash
npx vitest run <該票的測試檔>
npx vitest run
npx tsc --noEmit
npx vite build
```

`npm run bench` 由整合者最後統一跑。

## 基線（實測）

**393 tests passed / 25 files、0 型別錯誤、六列閘門全綠。**

## 共用資源與環境風險

- 使用者可能正在 `127.0.0.1:4780` 跑 studio。**不要跑 `npx tsup`**（會清掉
  整個 `dist/`）**也不要跑 `npm run bench`**。`npx vite build` 可以。
- **不得寫入這個 repo 的 `.issues/`。**
- Port 一律綁 0，暫存目錄各自 `mkdtemp`。

## 批次計畫

| 批次 | 票 | 平行度 |
|---|---|---|
| B1 | 01 ∥ 02 ∥ 03 ∥ 04 | **4** |
| B2 | 05 ∥ 06 ∥ 07 ∥ 08 | **4** |
| B3 | 09 | 1 |

十張 issue 收成九張票：`01M233A9Y`（形狀檢查）與 `01M233AA0`（fetchHash
註解）合併成票 04 —— 都只碰 `src/studio/api.ts`。

序列化的原因是檔案不是邏輯：**`src/cli/run.ts` 被三張票搶**（票 01 拿掉
blocked 的提醒、票 05 init 說話、票 09 history），**`AGENT.md` 被兩張搶**
（票 01、票 06）。

## 寫入所有權矩陣

| 票 | 擁有的檔案 |
|---|---|
| 01 | `src/cli/run.ts` `src/studio/board/**` `src/studio/drawer/{changes.ts,StatusPicker.tsx}` `CONTEXT.md` `AGENT.md` `docs/adr/0003-*.md` `test/cli/run.test.ts` `test/studio/board.test.ts` |
| 02 | `src/server/serve.ts` |
| 03 | `src/render/html.ts` `test/render/html.test.ts` |
| 04 | `src/studio/api.ts` `src/studio/poll.ts` `test/studio/poll.test.ts` |
| 05 | `src/cli/run.ts` `test/cli/run.test.ts` |
| 06 | `AGENT.md` `package.json` |
| 07 | `docs/adr/0006-*.md` `.scratch/nook-v1/spec.md` |
| 08 | `docs/adr/0001-*.md` |
| 09 | `src/core/{types,board}.ts` `src/index.ts` `src/cli/run.ts` `src/render/table.ts` + 其測試 |
