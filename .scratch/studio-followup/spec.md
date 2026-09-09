# Spec — studio 審查後續

> **執行模式：parallel。** worker 看不到規劃時的對話，board 因此寫成檔案。
> 發布目標：既有的 nook board（`.issues/`），八張 issue 已在 `queued`。

## 問題

studio 改版（`.scratch/studio-write/`，12 張票、26 個 commit）已全數落地並簽核。
這一批是**它留下的帳**：八張 issue 全部來自 worker 回報與兩軸審查，沒有一張是
規劃時就知道的工作。

其中兩條是實際的行為缺陷（`blocked` 不強制留言、Esc 之後鍵盤焦點消失），
兩條是既有的陷阱（例外帶掉 process、ACK 吃掉未知 issue），其餘是文件洩漏、
詞彙違規與清理。

## 已定案，不得重新討論

沿用前一批的全部決定：`docs/adr/0001`–`0008`、`CONTEXT.md` 的領域語彙、
以及 `.scratch/studio-write/spec.md` 的測試策略。特別重申三條最容易被違反的：

| 決定 | 出處 |
|---|---|
| **只測純邏輯，React 組件不寫測試。** 不得引入 jsdom、`@testing-library/*`、playwright | studio-write spec.md |
| **不得為了可 mock 而發明假接縫** —— 只有單一 adapter 的介面是掩體不是接縫 | ADR-0004 |
| **studio bundle 不得被 CLI 進入點 import**，必須 request 當下才從磁碟讀 | ADR-0008 |
| `queued` 是授權邊界；`blocked` 必須同時留下說明原因的 Comment | CONTEXT.md、ADR-0003 |
| 沒有快取、沒有索引、沒有衍生狀態 | ADR-0002 |

## 這一批的核心事實

**平行度只有第一輪有。** `src/studio/board/` 底下六個檔案被五張票搶，而其中一張
是大範圍機械改名。這是事實記錄，不是可以靠重畫切片消除的問題 —— 硬拆成不同
檔案只為了製造平行度會扭曲設計（同 studio-write spec.md 對 `src/core/` 的記錄）。

## 非目標

- 不改 op-log 格式、不改合併行為、不新增 Status
- 不做多人協作、不做驗證、**永遠不做 `--host`**（ADR-0007）
- studio 仍然不能建立 Issue
- 不重寫已經通過審查的設計 —— 這一批是補洞，不是第二次改版

## 硬指標（每一輪 commit 前都要過）

| 指標 | 預算 | 現值 |
|---|---|---|
| package size | < 3 MB | 542,919 B |
| studio 資產 | < 768 KB | 412,686 B |
| 冷啟 `nook --version` | < 500 ms | 26 ms |
| **CLI bundle 的 React 痕跡** | **0** | **0** |
| 並行 merge | 零衝突 | 0 |
| agent token（40 票情境） | < 4.5 KB | 4,065 B |

## 驗證指令

```bash
npx vitest run <該票的測試檔>   # 聚焦
npx vitest run                   # 全套
npx tsc --noEmit                 # 型別
npx vite build                   # studio 前端建得起來
npm run bench                    # 六個閘門（最後跑，且不要與別人同時跑）
```

## 基線（2026-09-09 實測，node v22.22.1）

**既有失敗測試 0、既有型別錯誤 0。** 305 tests passed / 24 files。
六列閘門全綠。基線乾淨 —— 任何失敗都是本次工作造成的，
**不要「順手修好」範圍外的東西**。

## 共用資源與環境風險

- **使用者正在 `127.0.0.1:4780` 跑 studio**，它從 `dist/studio/` 讀資產。
  單獨跑 `npx tsup` 會清掉整個 `dist/`（包含只有 `vite build` 會寫的 studio
  資產），使用者的瀏覽器當場壞掉。**要 build 一律用 `npm run build`，
  而且非必要不要 build。**
- **不得寫入這個 repo 的 `.issues/`。** 需要真實 board 的測試自己 `mkdtemp`。
- **Port** —— 一律綁 0 由 OS 指派。
- **`package.json`** —— 只有票 07 會動。其餘票需要新相依時**回報 blocked**。
- **`npm run bench`** —— 會跑 `npm pack` 進而重建 `dist/`。不要與其他 worker
  同時跑。

## 批次計畫

| 批次 | 票 | 平行度 | 說明 |
|---|---|---|---|
| B1 | 01 ∥ 02 ∥ 03 | **3** | Tailwind 來源／server 例外／reconcile ACK，三者互斥 |
| B2 | 04 | 1 | 大範圍機械改名，依 batching 硬規則不得同批。**刻意排早**，讓後面三張直接用改正後的詞彙 |
| B3 | 05 | 1 | 放寬 `BoardProps` 到 `ProjectedIssue`，是票 06 的地基 |
| B4 | 06 | 1 | blocked 閘門的完整流程 |
| B5 | 07 | 1 | 清理。**放最後**，順便掃掉前四輪新產生的過期註解 |

## 阻擋關係

```
01 ─┐
02 ─┼─（互不相干）
03 ─┘

04 改名 ──► 05 BoardProps ──► 06 閘門流程 ──► 07 清理
```

票 04–07 序列的原因是檔案，不是邏輯：四張都改 `src/studio/board/`。

## 寫入所有權矩陣

| 票 | 擁有的檔案 |
|---|---|
| 01 | `src/studio/index.css` `vite.config.ts` |
| 02 | `src/server/serve.ts` `src/server/handler.ts` `test/server/{serve,handler}.test.ts` |
| 03 | `src/studio/reconcile.ts` `test/studio/reconcile.test.ts` |
| 04 | `src/studio/board/**` `src/studio/drawer/changes.ts` `src/studio/App.tsx` `src/studio/index.css` |
| 05 | `src/studio/board/**` `src/studio/App.tsx` |
| 06 | `src/studio/board/**` `src/studio/drawer/IssueDrawer.tsx` `src/studio/App.tsx` |
| 07 | `src/studio/reconcile.ts` `src/studio/board/**` `src/cli/run.ts` `src/server/handler.ts` `package.json` `test/studio/reconcile.test.ts` |

各票的測試檔隨其實作檔一併擁有。
