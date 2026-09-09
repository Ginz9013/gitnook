# Spec — studio 從唯讀看板改成可寫入的主要操作介面

> **執行模式：parallel。** worker 看不到規劃時的對話，board 因此寫成檔案。
> 發布目標：既有的 nook board（`.issues/`），八張票已在 `queued`。

## 問題

`nook studio` 目前是唯讀的會議投影用檢視器：伺服器渲染的零 JS 頁面，每 2 秒比對
`/hash`，值變了就 `location.reload()`。CLI 同時服務人與 agent，但它只擅長後者。

CONTEXT.md 把 Status 序列切成兩段：`backlog` 與 `todo` 是**人的車道**，`queued`
之後是 **agent 的車道**。這次把那條分工落到介面上 —— **CLI 繼續是 agent 的介面，
studio 成為人的介面**，兩者寫進同一份 op-log。

## 已定案，不得重新討論

| 決定 | 出處 |
|---|---|
| studio 開放寫入；405 白名單收窄而非移除 | ADR-0007 |
| loopback-only 成為**唯一**的安全機制；`--host` 永遠不做 | ADR-0007 |
| actor 是跑 studio 的那個人；studio 不可變成多人服務 | ADR-0007 |
| append-only 之下沒有「被拒絕的寫入」，只有 LWW 決勝落敗 | ADR-0007 |
| React 19 + Tailwind v4 + shadcn；不用 preact | ADR-0008 |
| Drawer 用 Radix Dialog 為底的 Sheet；**不裝 vaul** | ADR-0008 |
| `html.ts` 只保留 markdown renderer 留在 server | ADR-0008 |
| studio bundle 不得被 CLI 進入點 import | ADR-0008 |
| 八個 Status 固定，`archived` 是欄位不是 Status | ADR-0003 |
| 沒有快取、沒有索引，全量掃描加摺疊 | ADR-0002 |
| 不設 storage 接縫，打真實檔案系統與真實 git | ADR-0004 |

## 測試策略（本次決定）

**只測純邏輯，React 組件不寫測試。** `vitest.config.ts` 維持 `environment: 'node'`，
**不得**新增 jsdom、@testing-library/* 或 playwright。理由是 ADR-0004 的同一條立場：
jsdom 不是真瀏覽器，DND 的指標事件在它底下要 mock，容易寫出「測過但實際壞掉」的假綠燈。

因此可測與不可測的界線是明確的：

- **可測**：調和 reducer（純函式）、server 的路由與寫入（真實 fs）、markdown renderer
- **不可測，靠型別與人工驗收**：React 組件的渲染、DND 的指標互動、drawer 的 focus trap

寫不出 red-green 的部分，票面會明說「本片段無自動化測試」，**不要為了湊紅燈而發明假接縫**。

## 公開介面與測試接縫

### 1. Server 寫入面（票 03）

`Change` 已經是領域裡「呼叫端表達的意圖」的型別，且呼叫端永遠不接觸 Op（CONTEXT.md）。
寫入端點直接鏡射 `board.apply(ref, change)`，不發明新詞彙：

```
POST /i/<ref>     body: Change (JSON)     → 200, body: IssueView (JSON)
```

錯誤對應（沿用既有的「解析不出來的 ref 是這個 URL 沒有對應的東西，不是伺服器錯誤」）：

| 情況 | 回應 |
|---|---|
| `RefNotFound` | 404 |
| `AmbiguousRef` | 404，內文含足以區分的候選 |
| `InvalidStatus` | 400 |
| body 不是合法 JSON / 不是 Change 的形狀 | 400 |
| 其他方法、或 POST 到非 `/i/<ref>` 的路徑 | 405 |

**方法白名單收窄而非移除。** 405 那條防線的價值在於「哪些路徑存在」不能決定
「能不能寫」—— 改寫後必須保留同樣的性質，且要有測試證明非寫入路徑仍拒絕 POST。

**`blocked` 不在 server 端強制配留言。** CLI 目前是提醒而非拒絕，server 保持一致；
配對的責任在 drawer（票 07）。在 server 端加一條 CLI 沒有的規則會讓兩個介面分歧。

### 2. Server 讀取面（票 01）

SPA 需要 JSON，而 markdown 要在 server 渲染成安全 HTML（ADR-0008）：

```
GET /api/board          → { issues: IssueView[], hash: string }
GET /                   → SPA shell HTML
GET /assets/<file>      → dist/studio/ 底下的靜態檔，request 當下才讀
GET /hash               → 不變（票 09 的契約）
```

`IssueView` 是 `Issue` 加上預渲染的安全 HTML，**不是**改動 `Issue` 本身：

```ts
interface IssueView {
  id: string; title: string; status: Status; labels: readonly string[];
  archived: boolean;
  description: string;          // 原文，供編輯用
  descriptionHtml: string;      // renderMarkdown 的產物，已安全
  comments: readonly { id: string; actor: string; t: number;
                       body: string; bodyHtml: string }[];
}
```

安全性由 server 保證：`descriptionHtml` / `bodyHtml` 走的是 `html.ts` 既有的
「先逸出、再構造」模型，因此 client 用 `dangerouslySetInnerHTML` 注入是安全的，
**不靠前端紀律**。

### 3. 調和 reducer（票 02）

`.scratch/studio-write/write-model.prototype.html` 的「可移植模組 A」已驗證過，
搬進 `src/studio/reconcile.ts`，純函式、不碰 DOM：

```ts
export function initialClient(snapshot: readonly IssueView[]): ClientState;
export function clientReduce(state: ClientState, action: ClientAction): ClientState;
export function project(state: ClientState): readonly ProjectedIssue[];
```

四條規則各對應一個實際會壞的情況，**四條都要有測試**：

1. 飛行中的變更蓋過快照 —— 否則輪詢帶回舊快照時卡片彈回去再彈回來
2. 同張 issue 只認最後一筆 —— 否則遲到的舊回應把卡片翻回舊位置
3. 拖曳期間押後快照 —— 否則手指還按著，卡片被伺服器抽走
4. ACK 帶的是寫入當下的值，不是永恆真理 —— agent 後來居上時要能接受

第四條是 append-only CRDT 特有的。**不得**引入 React Query / SWR 這類假設
「失敗就回滾」的工具來取代它。

## 非目標

- **studio 不能建立 Issue。** 寫入面只涵蓋 status 搬移、欄位編輯、留言、label 增減。
- 沒有負責人、優先級、里程碑、到期日 —— nook 刻意拒絕成為專案管理工具。
- 不做多人協作、不做驗證、不做 `--host`。
- 不改動 op-log 格式、不改動合併行為、不新增 Status。

## 硬指標（每一輪 commit 前都要過）

| 指標 | 預算 | 現值 |
|---|---|---|
| package size | < 3 MB | 123 KB（預期漲到約 525 KB） |
| 冷啟 `nook --version` | < 500 ms | 25.8 ms（**不得因此變慢**） |
| 並行 merge | 零衝突 | 0 |
| agent token（40 票情境） | < 4.5 KB | 4065 B |

冷啟是這次最容易踩壞的一項：只要 studio bundle 被 `src/cli/run.ts` 那條 import
鏈碰到，每一次 `nook list` 都要多 parse 400KB。

## 驗證指令

```bash
npx vitest run <該票的測試檔>   # 聚焦
npx vitest run                   # 全套
npx tsc --noEmit                 # 型別
npm run bench                    # 四個硬指標
```

## 基線（2026-09-09 實測，node v22.22.1）

**既有失敗測試 0、既有型別錯誤 0。** 281 tests passed / 22 files。
基線乾淨 —— 任何失敗都是本次工作造成的，**不要「順手修好」範圍外的東西**。

## 共用資源

- **Port** —— 整合測試一律綁 port 0 由 OS 指派，不得硬編碼
- **暫存目錄** —— 每個測試用例獨立 `mkdtemp`，不得共用固定路徑
- **`package.json`** —— 只有票 01 可以動（新增 React 相依與 build script）。
  其餘票需要新相依時**停下來回報 blocked**，不要自己 `npm i`
- **`test/render/__golden__/`** —— 只有票 04 會動

## 阻擋關係

```
01 骨架 ─┬──────────────► 03 寫入面 ──┐
         │                             │
         ├──────────────► 04 html 拆分 ├──► 06 拖拉 ─┐
         │                             │             ├──► 08 文件與閘門
         ├──────────────► 05 輪詢     ─┘  07 drawer ─┘
         │
02 reducer（無阻擋，可與 01 同批）
```

## 批次計畫

| 批次 | 票 | 平行度 | 說明 |
|---|---|---|---|
| B1 | 01 ∥ 02 | 2 | 骨架動 handler.ts 與 package.json；reducer 是孤立的純檔案 |
| B2 | 03 ∥ 04 ∥ 05 | 3 | 寫入面／html 拆分／輪詢，三者檔案互斥 |
| B3 | 06 ∥ 07 | 2 | 拖拉與 drawer 各自只碰自己的目錄（票 01 預先接好插槽） |
| B4 | 08 | 1 | 文件與閘門必須最後 —— 否則會出貨一份描述尚未發生的狀態的 README |

**`src/server/handler.ts` 是本次的序列化點**，四張票都想動它。票 01 先把它改成
服務 SPA shell 與 JSON API，票 03 才在其上加寫入路由 —— 兩者因此不同批。
這是事實記錄，不是可以靠重畫切片消除的問題。
