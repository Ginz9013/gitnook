# 08 「零 runtime 相依」的宣稱收斂到 CLI，並加上 studio 資產的體積閘門

nook ref：`01M224SZA2S09YTQD0K8VNWBSQ`

## Outcome

讓文件與閘門追上實際發生的事。**這張票必須最後做** —— 提早做就會出貨一份描述
尚未發生的狀態的 README。

## Acceptance criteria

**README**

- [ ] 宣稱改為「**the CLI has zero runtime dependencies**」，並在同一段說明
      studio 的資產是預先打包、隨 tarball 出貨的靜態檔
- [ ] 說清楚使用者真正在意的那條承諾仍然成立：`npm i -D gitnook` **不會裝進
      任何一個傳遞套件**（`dependencies` 依然是空的）
- [ ] 也說清楚鬆動的部分：React 與 Radix 的 CVE 面現在住在我們的 tarball 裡，
      更新責任是我們的。**含糊其辭比改寫更糟**
- [ ] 四個硬指標的表格更新為實測值
- [ ] 比較表那一列（「~105 KB npm package」，對照 backlog.md 的 67.5MB Bun binary）
      更新。對照仍然壓倒性有利，沒有理由不誠實
- [ ] studio 一節更新：它不再是「唯讀的會議投影用檢視器」

**src/index.ts 的公開面說明**

- [ ] 第 12 行附近的 docstring 說「刻意**不**在此的東西：三個渲染函式」。
      票 04 之後只剩兩個（`renderTable`、`renderJson`）。純文案，不改匯出

**AGENT.md**

- [ ] `studio` 的描述從「localhost read-only board」更新
- [ ] 加上規則：**studio bundle 不得被 CLI 進入點 import**，必須在 request
      當下才從磁碟讀。理由（每次 `nook list` 多 parse 400KB）要寫出來，
      否則下一個人會覺得這條規則沒道理而拿掉它

**貢獻者文件**

- [ ] 寫明 `npx tsup` 單獨跑會清掉整個 `dist/`，包含只有 `vite build` 會寫的
      `dist/studio/` —— 之後 server 就沒有資產可服務。要用 `npm run build`

**閘門**

- [ ] `bench` 把 studio 資產的體積單獨列一行，讓它的成長看得見而不是混在
      package size 裡
- [ ] **加一個結構性的冷啟守衛**：斷言 `dist/cli/run.js` 裡不含 React 痕跡
      （`react` / `createRoot` / `radix` / `tailwind` 皆為 0 次）。目前這條
      ADR-0008 的硬約束只由 bench 的計時中位數間接守著，而計時會漂；
      直接檢查 bundle 內容才抓得到真正的失效模式
- [ ] 四個硬指標全過。**乾淨 build 的實測值**（2026-09-09，node v22.22.1）：
      package 537,433 B（17% 的 3MB 閘門）／冷啟 27.7ms／合併零衝突／
      token 4,065 B。注意 package size 必須從乾淨的 `dist/` 量 ——
      帶著陳舊產物的 `dist/` 會量出 748KB 這種假數字

## Test seam

`bench` 的新指標沿用既有的 row 結構。README 與 AGENT.md 由既有的
`test/render/token-budget.test.ts` 與 skill 釘住測試涵蓋 —— 確認它們仍綠。

## Write ownership

- `README.md`
- `AGENT.md`
- `bench/index.ts` `bench/size.ts`
- `test/` 底下釘住 AGENT.md 與 CLI 一致性的測試檔（若因文案改動而需要更新）
- `src/index.ts` — **僅限**公開面 docstring 的文案
- `src/cli/run.ts` — **僅限** 218 行附近的 help 文字（`studio [--port <n>]
  localhost 唯讀看板`）。studio 已經不是唯讀的。**不得**改該檔案的任何邏輯

**不得碰**：`src/**` 的其餘部分。這張票是文件與量測，**不改行為**。若發現需要
改行為才能讓文件成真，回報 blocked。

## Shared resources

無。

## Blocked by

票 01、03、04、05、06、07 —— 全部。

## Status

queued
