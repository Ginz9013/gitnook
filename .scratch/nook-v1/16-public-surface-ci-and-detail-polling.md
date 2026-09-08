# 16 收束公開面、CI，與詳情頁輪詢

## Outcome

補上 spec 的兩個缺漏，並把公開 API 收回 Design contract 說的範圍。

## Acceptance criteria

### 收束 `src/index.ts`（scope creep）

Design contract 寫的是「`src/index.ts` 公開匯出（**僅 openBoard 與型別**）」。實際匯出了 `handleRequest`、`resolvePrefix`、`normalizeRef`、`SHORT_ID_MIN`、`DEFAULT_PORT`、`NotImplemented` 等內部細節，README 還逐一公告為公開 API。**對 library-first 產品，每一個都是永久相容負債。**

- [ ] **這些匯出是 orchestrator 為了讓 worker 互相取用而加的，而那是不必要的** —— 同一個 package 內的模組可以直接 `import { renderTable } from '../render/table.js'`。請把內部呼叫端改為直接匯入
- [ ] 公開面收束到：`openBoard`、`initBoard`、`diagnose`、`repair`、`serve`、全部型別與錯誤型別。渲染函式與 server 的 `handleRequest` 是否該公開，請自行判斷並在報告中說明理由
- [ ] **刪除 `NotImplemented`** —— 零使用者（票 01 的鷹架，13 張票做完後所有方法都已實作），卻是公開 API
- [ ] README 的公開 API 段落同步更新

### 四個硬指標進 CI

Scope 明寫「四個可量測的硬指標，**全部進 CI**」，但倉庫**沒有任何 workflow 檔**，`npm test` 也不呼叫 `bench`。閘門寫得很完整，卻沒有東西會自動跑它。

- [ ] GitHub Actions workflow：`npx vitest run`、`npx tsc --noEmit`、`npm run bench`
- [ ] ⚠️ **已知風險**：`test/server/serve.test.ts` 的 LAN 綁定測試需要非 loopback 的 IPv4 介面，且**刻意拋錯而非靜默跳過**（靜默跳過會讓 `0.0.0.0` 的迴歸無聲通過）。請在 workflow 中處理這件事並在註解說明決定，**不得改成靜默略過**

### 詳情頁輪詢

- [ ] AC 是「`nook studio` … 每 2 秒輪詢 `/hash` 變更即重載」，但只有 `/` 有腳本，`/i/<ref>` 沒有
- [ ] 給 `renderIssueHtml` 同樣的 `inlineScript` 選項，`handleRequest` 兩條路徑都注入
- [ ] 腳本仍須是頁面上唯一的 JS，且 `</script>` 的逸出不得退化

### 詞彙

- [ ] `src/server/handler.ts` 註解中用「票」指 Issue 之處改為 Issue

## Write ownership

- `src/index.ts`
- `src/core/types.ts`（僅刪除 `NotImplemented`）
- `src/cli/run.ts`、`src/server/{handler,serve}.ts`、`src/render/html.ts`（僅 import 路徑與詳情頁輪詢）
- `test/render/html.test.ts`、`test/server/handler.test.ts`
- `.github/workflows/ci.yml`（新增）
- `README.md`（僅公開 API 段落）

## Blocked by

15

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
