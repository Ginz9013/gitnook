# gitnook-unify — develop-loop 執行摘要

### Run metadata

- **Feature slug:** `gitnook-unify`
- **Board:** `.scratch/gitnook-unify/spec.md`
- **Start:** 2026-09-16 18:11
- **End:** 2026-09-17 00:08
- **Total tickets:** 6
- **Circuit breaker fired:** no

### Per-ticket table

| Ticket id | Title | Status | Commit sha | Reason |
| --- | --- | --- | --- | --- |
| 01 | 統一 `nook init` 與 `.gitnook/` 佈局 | done | `9d61376` | |
| 02 | doctor 適配 `.gitnook/` 佈局 + `InvalidNookConfig` | done | `29eb91d` | |
| 03 | 舊版佈局偵測 + `git mv` 提示 | done | `fdb06d5` | |
| 04 | Workspace 可選遞迴掃描 + `decisionLog` | done | `4a76d2d` | |
| 05 | `nook workspace decision` 指令家族 | done | `5162f01` | |
| 06 | 文件、ADR-0012 supersede、自己 repo 搬遷 | done | `c8de263` | |

全序依賴（每張票 blocked by 前一張，主因是好幾張票共用 `src/core/types.ts`／
`src/core/decisionTypes.ts`）——這是規劃階段就已知、跟使用者確認過的限制，六張
票沒有一批真的平行跑，每個 round 的 batch 大小都是 1。

### Review findings

兩軸 review（Standards + Spec）跑了 6 輪（每張票一輪），共發現 5 個真實問題，
全部判定為小型發現、自動修好，沒有升級成新票：

- **Auto-fixed：**
  - 票 01 Spec 軸：票板自己的 Done when 描述自相矛盾（要求兩個測試檔全綠，卻
    又把它們列進「不得碰」清單），修正票板文字——`b9392da`
  - 票 02 Standards 軸：`sharingMismatches()` 的錯誤提示訊息還指向舊的
    `.issues` 路徑——`e0abe54`
  - 票 03 Standards 軸：`legacyMoveHint()` 在 `types.ts`／`decisionTypes.ts`
    兩處逐字重複，抽成共用函式——`c9591b0`
  - 票 04 Spec 軸：`serve()` 換掉私有 `lazyDecisionLog` 後，decision 側從未有
    真實 HTTP 測試覆蓋這段接線——補上真的 HTTP 測試——`e62b389`
  - 票 05 worker 自己發現（非 review 軸）：兩個新的 decision workspace 錯誤
    型別沒註冊進 `run.ts` 的 `USER_ERRORS`，會讓使用者錯誤誤判成內部 bug——
    `13b964f`
  - 票 06 Standards 軸：測試檔頂部殘留敘述跟改寫後的斷言自相矛盾、CONTEXT.md
    一句話夾了段落中英混雜——`2a291b7`
- **Escalated：** 無，全部發現都是小範圍、低風險，當場修掉即可。

除此之外，整合者自己在驗證過程中另外發現並修補了兩個**票板本身的缺口**（不是
worker 的錯，是切票階段的疏漏）：
- 票 01：`src/core/board.ts` 硬編了 `.issues/issues`，沒有被任何票的寫入範圍
  涵蓋——連同 9 個同樣硬編舊路徑、沒人認領的測試檔一起修（併入 `9d61376`）。
- 票 01 執行期間：測試套件跑 `npm run bench` 意外重建 `dist/`，導致連整合者
  自己都無法用 CLI 管理這批票——提前把 nook 自己 repo 搬到 `.gitnook/`
  （`c12f027`、`74699d7`）。

### Needs your decision

無——沒有任何票 hard-stop。有一個非 hard-stop 的產品判斷（`forward-compat.
test.ts` 兩條斷言在 breaking change 之後該斷言什麼）在票 06 開始前先問過你、
你已經確認，已經照著做完，不留待辦。

### Next steps

- 全部驗證都綠：`npx tsc --noEmit` 0 錯誤、`npx vitest run` 1055/1055、
  `npm run bench` 六列閘門全綠。
- 目前在 `gitnook-unify` branch 上，尚未 merge 進 `main`，也還沒 push——要不要
  開 PR 或直接 merge，是你的決定。
- 票 06 的 worker report 裡提了一個沒有動手的發現（超出這次板子範圍，留給你
  參考）：`src/index.ts` 只匯出舊的 `initBoard`，沒有匯出新的統一
  `initNook`/`InitResult`——把 gitNook 當 library（不是 CLI）用的呼叫端目前
  拿不到新的統一 init 入口，值得之後單獨開一張票補。
