# Board — Nook v1

平行執行模式。11 張票，6 個批次。發布目標：無（board 僅存於 `.scratch/`）。

## ⚠️ 執行前的前置條件

**這個目錄不是 git repo**（`git rev-parse` 回報 fatal）。平行 worker 的工作模式是**一票一個 commit**，沒有 git repo 就無法執行。

需要在派工前先 `git init`。**我未在未經授權下執行任何寫入型 git 指令**，這一步需要你明確授權。

同時附帶兩個後果：
- board 的票況目前**只存在磁碟上**，沒有版本控制
- `.gitattributes` 相關的票（06）與真實 git 合併的票（05）本來就需要真實 git repo 才能執行

## 文件

| 檔案 | 內容 |
|---|---|
| `spec.md` | 問題、範圍、非目標、領域決策、設計契約、驗收條件、四個硬指標、風險 |
| `spike-findings.md` | `merge=union` 的實測結果（7 pass / 1 fail）與三條由此逼出的硬規則 |
| `NN-*.md` | 各張票 |

## 阻擋關係

```
01 ─┬────────────────► 02 ──► 03 ──► 04 ──┬──► 05 ───────┐
    │                                     │              │
    ├──► 06 ─────────────────────────────┤               ├──► 10 ──► 11
    │                                     │              │
    ├──► 07 ─────────────────────────────┤               │
    │                                     │              │
    └──► 08 ─────────────────────────────┴──► 09 ────────┘
```

> **依賴修正（2026-09-08，B2 結束後）**：原圖把 09 畫成只依賴 08。實際上
> `GET /` 必須呼叫 `board.list()`，而 `list()` 是票 04 —— **09 依賴 04**。
> 規劃時漏了這條邊。繞過的三種方式（handler 改吃 `Issue[]`、複製前綴解析
> 到 server、用 Board stub）分別會造成邏輯重複或違反 ADR-0004，都不划算。
> 批次計畫因此重排，平行度從原本的估計下降。

## 批次計畫

| 批次 | 票 | 平行度 | 狀態 | 說明 |
|---|---|---|---|---|
| B1 | 01 | 1 | ✅ | 建立工具鏈與完整型別，一切的前提 |
| B2 | 02 ∥ 06 ∥ 07 ∥ 08 | **4** | ✅ | 核心 LWW／gitattributes／表格渲染／HTML 渲染 |
| B3 | 03 | 1 | 進行中 | OR-Set 與 comments（core 檔案，無法與 04 同批） |
| B4 | 04 | 1 | | list 與前綴解析（core 檔案，無法與 03 同批） |
| B5 | 05 ∥ 09 | 2 | | 真實 git 合併閘門／studio server |
| B6 | 10 | 1 | | CLI |
| B7 | 11 | 1 | | 打包與體積、冷啟閘門 |

B2 實測：四個 worker 零越界，golden 檔前綴策略（`table-`／`json-` vs `html-`）在同一目錄下無碰撞，三個獨立撞到票 01 characterization 測試的 worker 都選擇回報而非自行修改。

**核心的 02→03→04→05 是序列的**，因為它們都寫 `src/core/{ops,reduce,board,types}.ts`。這是事實記錄，不是可以靠重畫切片消除的問題 —— 硬拆成不同檔案只為了製造平行度會扭曲設計。平行紅利來自渲染層、server 與 CLI。

## 寫入所有權矩陣

| 票 | 擁有的檔案 |
|---|---|
| 01 | `package.json` `tsconfig.json` `vitest.config.ts` `.gitignore` `src/core/{types,ops,reduce,board,ids,actor}.ts` `src/index.ts` + 兩個空殼 |
| 02 | `src/core/{ops,reduce,board,types}.ts` |
| 03 | `src/core/{ops,reduce,board,types}.ts` |
| 04 | `src/core/{board,ids,types}.ts` |
| 05 | `src/core/{reduce,ops,health}.ts` |
| 06 | `src/core/{gitattributes,health}.ts` |
| 07 | `src/render/{table,json}.ts` |
| 08 | `src/render/html.ts` |
| 09 | `src/server/{handler,serve}.ts` |
| 10 | `src/cli/run.ts` `bin/nook.js` |
| 11 | `tsup.config.ts` `package.json` `LICENSE` `README.md` `bench/*` |

各票的測試檔隨其實作檔一併擁有，詳見各票。

## 共用資源

- **暫存目錄** —— 每個測試用例獨立 `mkdtemp`，不得共用固定路徑
- **Port**（票 09、10）—— 一律綁 **port 0** 由 OS 指派，不得硬編碼
- **真實 `git`**（票 05、06）—— 測試須自行設定 `user.email` / `user.name` 並關閉 `commit.gpgsign`，**不得依賴或修改使用者的全域 git 設定**
- **`test/render/__golden__/`**（票 07、08）—— 同一目錄，檔名不重疊。同批執行時各自只寫自己的 golden 檔
- **`package.json`**（票 01 建立、票 11 修改）—— 不同批次，無碰撞

## 驗證指令

```bash
npx vitest run <該票的測試檔>   # 聚焦
npx vitest run                   # 全套
npx tsc --noEmit                 # 型別
npm run bench                    # 四個硬指標
```

## 基線

Measured 2026-09-08，git 2.50.1、node v22.22.1。

目錄為空。**既有失敗測試 0、既有型別錯誤 0。** 基線乾淨 —— 任何失敗都是本次工作造成的，不要「順手修好」範圍外的東西。

## 四個硬指標

| 指標 | 目標 | 由哪張票守住 |
|---|---|---|
| package size | < 3MB | 11 |
| `npx` 冷啟 | < 500ms | 11 |
| 並行 merge | 零衝突 | 05 |
| agent token（40 票情境） | < 4KB | 07 |
