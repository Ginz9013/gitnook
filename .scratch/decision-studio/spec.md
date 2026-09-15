# Decision 進 Studio

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`）。
>
> **誠實的警語**：`server/handler.ts`、`studio/api.ts`、`studio/DecisionApp.tsx`
> 幾乎每張票都會擴充，四張票是一條全序鏈，不是刻意製造的序列化——同
> `decision-module` 那批 `cli/decision.ts` 的教訓。

## Problem

Studio（`nook studio`，React SPA）完全不知道 Decision 存在——它只認得
`Board`／`Issue`，看板、drawer、輪詢全部寫死在 Issue 的形狀上。上一批
（`decision-module`）把 Decision 的 CLI 做完整了（`nook decision
init/new/list/show/set/history`），但只有會打指令的人用得到；studio 是
「人的主要操作介面」（ADR-0007 對 Issue 下的判斷，同樣適用於 Decision）。

## Outcome

`nook studio` 打開時，畫面上有一個頂層切換（Issues／Decisions）。切到
Decisions：一份扁平清單（不是看板——Decision 沒有 Status/Lane），可用
disposition 篩選，可以新增，點一筆開 drawer 能看／改 title、body、
disposition、supersededBy，能看修改歷史。跟 Issue 的 studio 共用同一個
process、同一個 port、同一份設計語言（shadcn 元件、design token）。

## Scope

- `App.tsx` 拆成薄殼（視圖切換）+ 兩個 composition root
  （`IssueApp.tsx`／`DecisionApp.tsx`），一次只掛載一個
- `decisionReconcile.ts`：Decision 專用的樂觀寫入 reducer（SNAPSHOT／
  EDIT／CREATED／ACK／FAIL，沒有 GRAB/RELEASE/DROP——沒有拖曳）
- Decision 扁平清單（`decisions/` 目錄）：清單、空狀態、載入骨架、
  disposition 篩選、新增表單
- Decision drawer（`decisionDrawer/` 目錄）：詳情、可編輯欄位、
  disposition 選單、修改歷史面板
- Server 新路由：`GET /api/decisions`、`GET /decision-hash`、
  `POST /api/decisions`、`POST /d/<ref>`、
  `GET /api/decision-history/<ref>`
- 泛化 `HistoryPanel.tsx`／`history.ts` 讓 Decision 重用（Issue 的行為
  逐字不變）
- 視圖偏好存進 `prefs.ts`（同主題偏好的既有模式）

## Non-goals

- **不做 kanban／拖曳。** Decision 沒有 Status/Lane，硬套等於發明一個
  ADR-0010 才剛拿掉的東西。
- **不做 comments、labels、archived/deleted 相關 UI。** Decision 這個
  實體本來就沒有這些欄位——decision-module 既有的 Non-goals。
- **`supersededBy` 只做純文字輸入**，不解析目標、不顯示連結、不驗證
  存在。同 core 對這個欄位的既有態度（`decisionLog.ts` 只驗形狀）。
  這是可以晚點單獨做的豐富化，不是這次的缺口。
- **`legacyRef` 在 drawer 唯讀顯示（有值才顯示一塊小標記），不可編輯。**
  同 CLI 的 `set` 不曝露它的理由：只在遷移當下手動標記一次。
- **不做 private mode／workspace 整合。** 同 decision-module 既有範圍。
- **無 React 元件測試。** 沿用既有測試策略（只測純邏輯與 server 路由，
  不引入 jsdom/testing-library/playwright）。
- **`/api/board-info` 不擴充、不新增 decision-info 端點。** `diagnose()`
  已在 `decision-module` 票 06 泛化成掃描已知實體清單，`board.health()`
  的既有輸出已涵蓋 Decision 的零衝突保證。

## Domain decisions

**`App.tsx` 一次只掛載一個 composition root。** 兩份輪詢與兩份樂觀狀態
同時活著，換來的是「沒人在看的那個視圖也每 2 秒打一次伺服器」——
ADR-0002 的全量掃描代價不貴，但沒理由替不會被看見的畫面付這筆錢。
視圖切換因此不是「兩個都渲染、CSS 藏起一個」，是條件掛載；切換的瞬間
會有一次跟開場一樣的載入骨架，這是刻意接受的代價，不是遺漏。

**`decisionReconcile.ts` 是平行檔案，不是泛化 `reconcile.ts`。**
`ReconcileIssue` 的泛型限制卡死在 `status`/`labels`/`archived`/
`comments`，且拖曳三個動作（GRAB/RELEASE/DROP）對沒有看板的 Decision
完全無意義——這是兩個真實 adapter 但差異是真的，比照 core 那邊
`decisionReduce.ts` 之於 `reduce.ts` 的既有先例：平行、不共用，不硬拗
一個「兩者都要塞得下」的泛型介面。`poll.ts` 的 `startPolling` 已經是
泛型函式（吃 `dispatch`/`hash` fetch），這裡直接重用，不開分身。

**`HistoryPanel.tsx` 泛化，Decision 重用整個組件。** 跟上面那條相反的
判斷——`historyRows()` 只處理 `field`/`value`/`actor`/`t`，跟欄位名稱
的值域完全無關，唯一寫死 Issue 的地方是元件內部直接 import `fetchHistory`
這一行。這是「兩個真實呼叫端、但差異只在要打哪個端點」，硬複製一份
150 行幾乎一樣的展開/收合/loading 狀態機才是真正的重複程式碼。改法：
`HistoryPanelProps` 從 `{ issueId }` 換成 `{ id, fetchWrites }`，
`fetchWrites: (id, signal) => Promise<{ writes: readonly HistoryWrite[] }>`，
`HistoryWrite` 是比 `WriteView` 更寬的結構型別（`field: string`，不收窄
成 `SetKey`）。Issue 既有呼叫端改傳 `fetchHistory`，行為逐字不變。

**Decision 清單是扁平清單，不分頁不分組。** `nook decision list` 本身
沒有分頁（ADR-0002：全量掃描），studio 端也不做——這批 Decision 的數量
級別（十幾到幾十）遠低於 Issue，分頁/虛擬捲動是為了不存在的問題預先
鋪路，屬於 Speculative Generality。

**`/api/decisions`、`/d/<ref>`、`/api/decision-history/<ref>` 的命名
比照既有 Issue 端點的字面慣例**（`/api/issues`、`/i/<ref>`、
`/api/history/<ref>`），字首從 `i` 換成 `d`，不是巧合，是同一套
「entity 首字母 + ref」的既有規則延伸。`/decision-hash` 同理比照裸
文字的 `/hash`，不是 `/api/decision-hash`——`/hash` 本來就沒有 `/api`
前綴（它比 board 快照更早、更輕，這條既有規則延伸到 Decision）。

## Design contract

### `src/server/handler.ts`（擴充）

- Responsibilities：新增 `DecisionView`（同 `IssueView` 的檢視模型
  轉換，欄位換成 `id`/`shortId`/`title`/`disposition`/`body`/
  `bodyHtml`/`supersededBy?`/`legacyRef?`）、`DecisionBoardSnapshot
  { decisions, hash }`、`decisionHash(log)`（同 `boardHash` 的雜湊
  規則，量測對象換成 `decisionLog.list({})`——沒有 `all` 概念）、
  `DecisionWriteView { field: DecisionSetKey; value: string; actor:
  string; t: number }`、`DecisionHistory { writes }`。五個新路由，
  逐一鏡射既有 Issue 路由的錯誤處理慣例（`RefNotFound`→404，
  `InvalidDisposition`→400，未知欄位→400）。
- Non-responsibilities：不重寫 core 的驗證或摺疊邏輯，路由本體只是
  `openDecisionLog().xxx()` 加一層 JSON 轉換，鏡射既有 Issue 路由的
  薄度。
- Interface：與既有路由同一份 `StudioResponse`/`json`/`notFound`/
  `badRequest` helper，不另開一套。
- Seam：`handleRequest(board, decisionLog, req, opts)`——**簽章要加一個
  參數**（既有簽章只吃一個 `Board`），這是這批唯一真的改動既有函式簽章
  的地方，票 01 落地時要同步改 `serve.ts` 呼叫它的那一行與既有測試的
  呼叫方式。
- Dependencies：`openDecisionLog`（core，`serve()`/測試各自決定要不要
  真的開一個）。

### `src/studio/api.ts`（擴充）

- 五個新函式：`fetchDecisions`、`fetchDecisionHash`、
  `fetchDecisionHistory(ref)`、`postDecisionChange(ref, change)`、
  `createDecision(title, body?, disposition?)`——逐一重用既有
  `getJson`/`postJson`（已經是 entity-agnostic 的純函式，不必改）。
  對應的型別守衛 `isDecisionBoardSnapshot`/`isDecisionHistory`，同既有
  `isBoardSnapshot`/`isIssueHistory` 的「只看頂層」規則。
- 只用 `import type` 從 `server/handler.js` 拉型別——同既有規則，維持
  ADR-0008 的零 React 打包保證。

### `src/studio/decisionReconcile.ts`（新）

- Responsibilities：`ReconcileDecision`（id/title/body/disposition/
  supersededBy?/legacyRef?）、`ReconcileDecisionChange`（title/body/
  disposition/supersededBy 的子集）、`ClientDecisionState`、
  `ClientDecisionAction`（`SNAPSHOT | EDIT | CREATED | ACK | FAIL`——
  比 Issue 少 GRAB/RELEASE/DROP）、`clientDecisionReduce`、
  `initialDecisionClient`、`projectDecisions`。
- Non-responsibilities：不知道 disposition 的四個值是什麼（那是
  `DispositionPicker` 的事），不知道 HTTP（那是 `api.ts`），純狀態轉換。
- Interface：同 `reconcile.ts` 既有形狀（`seq` 由 reducer 自己配，
  ACK/FAIL 靠它認回 pending write），錯誤在乎的地方完全一致。
- Seam：`clientDecisionReduce`/`projectDecisions`——純函數單元測試，
  同 `reconcile.test.ts` 的既有手法。

### `src/studio/decisions/`（新目錄，Decision 的扁平清單）

- `DecisionList.tsx`：一列一個 Decision（shortId/title/disposition），
  點擊開 drawer。
- `DecisionListHeader.tsx`：disposition 篩選（下拉或分頁籤，四個值+全部）
  + 新增入口。
- `filter.ts`：純函數，`filterByDisposition(decisions, disposition?)`。
- `NewDecisionForm.tsx`、`DecisionListSkeleton.tsx`、
  `EmptyDecisions.tsx`：逐一比照 `NewIssueForm`/`BoardSkeleton`/
  `EmptyBoard` 的既有節奏（只收標題、Enter 送出、送出後不關閉；空清單
  用講的不畫空表格）。

### `src/studio/decisionDrawer/`（新目錄）

- `DecisionDrawer.tsx`：Sheet 外殼，比照 `IssueDrawer.tsx`。
- `DecisionDetail.tsx`：title（可編輯文字）、body（markdown 渲染，
  重用既有 `markdownContent.ts` 不改）、disposition（`DispositionPicker`）、
  supersededBy（純文字輸入）、legacyRef（有值才顯示的唯讀小標記）、
  `HistoryPanel`（傳 `fetchDecisionHistory`）。
- `DispositionPicker.tsx`：比照 `StatusPicker.tsx`，但只有四個值，
  沒有任何值需要「選到就先問原因」的特例（那條規則連 Status 都已經
  拿掉了，Disposition 從來沒有過）。
- `decisionChanges.ts`：純函數，`titleChange`/`bodyChange`/
  `dispositionChange`/`supersededByChange`，逐一比照 `drawer/changes.ts`
  的「沒有變化就回 `undefined`」規則。

### `src/studio/App.tsx`（拆殼）+ `src/studio/IssueApp.tsx`（新）+ `src/studio/DecisionApp.tsx`（新）

- `IssueApp.tsx`：現有 `App.tsx` 的內容原樣搬過去，**邏輯一行不改**。
- `DecisionApp.tsx`：鏡射 `IssueApp.tsx` 的節奏（一份
  `ClientDecisionState` ref、輪詢、drawer 開關），但沒有拖曳相關的
  任何東西。
- `App.tsx`：讀/寫 `prefs.ts` 的視圖偏好，畫頂層切換 UI，依偏好掛載
  其中一個。

## Acceptance criteria

- [ ] `nook studio` 打開後畫面上有 Issues／Decisions 切換，切換後保存
      在 localStorage（重新整理維持上次選的視圖）
- [ ] Decisions 視圖：扁平清單，disposition 篩選可用，每 2 秒輪詢一次
      `/decision-hash`，變更時整份重抓
- [ ] 新增 Decision：只填標題，Enter 送出，成功後表單清空但不關閉
- [ ] 點一筆 Decision 開 drawer：能看 title/body(渲染 markdown)/
      disposition/supersededBy(有值)/legacyRef(有值)
- [ ] drawer 裡能改 title/body/disposition/supersededBy，沒有變化的
      編輯不送出任何請求
- [ ] History 面板展開才 fetch，顯示每一次欄位寫入（field/value/
      actor/t），不做 restore
- [ ] Issue 既有的一切行為（看板、drawer、輪詢、history）逐字不變——
      這是這批最容易犯的迴歸
- [ ] `npm run bench` 六列全綠（studio assets 那一列預期會漲，需要
      重新量而非假設）

## Test strategy

- Seam：`clientDecisionReduce`/`projectDecisions`（純函數）、
  `decisionChanges.ts` 的四個函式（純函數）、`decisions/filter.ts`
  （純函數）、`handleRequest` 的五個新路由（server 整合測試，既有
  `Io`/真實暫存目錄手法）
- Dependency handling：與既有 studio 測試策略一致——真實檔案系統
  （ADR-0004），無 mock；React 組件本身不寫測試
- Test type：核心邏輯用整合/單元測試；伺服器路由用整合測試

## Verification

- Focused：`npx vitest run <該票的測試檔>`
- Suite：`npx vitest run`
- Static：`npx tsc --noEmit`
- Metrics：`npm run bench`（由票 04 之後統一跑一次）
- 手動驗證：`npx vite build` 過、`nook studio` 實際打開瀏覽器操作一輪
  （這批大量是 UI，静態檢查與測試看不到版面對不對）

## Baseline

Measured 2026-09-15（`main`，已包含 decision-module 整批 + 歸檔
31 張 done issue）：

- **874 tests passed / 49 files**
- **0 型別錯誤**（`npx tsc --noEmit`）
- `npm run bench` 六列全綠（package size 800,226 B、studio assets
  462,218 B、cold start ≈26ms、cli bundle 0 markers、concurrent merge
  0 conflicts、agent token 4,150 B）
- 既有失敗：無。

## 寫入所有權與批次

| 票 | 擁有的檔案 | Blocked by |
|---|---|---|
| 01 | `studio/App.tsx`（拆殼）`studio/IssueApp.tsx`(新) `studio/DecisionApp.tsx`(新) `studio/decisionReconcile.ts`(新) `studio/decisions/{DecisionList,DecisionListSkeleton,EmptyDecisions,DecisionListHeader,filter}.{tsx,ts}`(新) `studio/prefs.ts` `server/handler.ts`（+2 GET 路由＋型別）`server/serve.ts`（`handleRequest` 簽章多一個參數）`studio/api.ts`（+讀取函式與型別）+ 上述各檔測試 | 無 |
| 02 | `studio/decisions/NewDecisionForm.tsx`(新) `server/handler.ts`（+POST /api/decisions）`studio/api.ts`（+createDecision）`studio/DecisionApp.tsx`／`decisions/DecisionListHeader.tsx`（接線）+ 測試 | 01 |
| 03 | `studio/decisionDrawer/{DecisionDrawer,DecisionDetail,DispositionPicker,decisionChanges}.{tsx,ts}`(新) `server/handler.ts`（+POST /d/\<ref\>）`studio/api.ts`（+postDecisionChange）`studio/DecisionApp.tsx`（接線）+ 測試 | 01（與 02 對 `DecisionApp.tsx`／`handler.ts`／`api.ts` 序列） |
| 04 | `studio/drawer/HistoryPanel.tsx`（泛化，Issue 用法不變）`studio/drawer/history.ts`（泛化）`server/handler.ts`（+GET /api/decision-history/\<ref\>）`studio/api.ts`（+fetchDecisionHistory）`studio/decisionDrawer/DecisionDetail.tsx`（接線）+ 測試 | 01, 03（DecisionDetail.tsx 由 03 建立） |

批次：**B1=[01]、B2=[02]、B3=[03]、B4=[04]**——`handler.ts`／`api.ts`／
`DecisionApp.tsx` 幾乎每張票都碰，全序鏈是誠實反映而非刻意製造。

## Risks and deferred questions

- **`handleRequest` 簽章多一個參數是這批唯一真的改動既有 Issue 端點
  介面的地方。** 票 01 落地時要同步確認 `serve.ts` 與所有既有
  `handler.test.ts` 呼叫點都更新，不能漏一個。
- **`supersededBy` 純文字輸入沒有防呆**（打錯字、打進一個不存在的
  ref）：伺服器仍然只驗形狀，存進去的錯字要靠人自己發現。這是接受的
  取捨，跟 core 的既有態度一致，不是這批的缺口。
- **視圖切換的瞬間有一次跟開場一樣的載入骨架**（因為只掛載當下的
  視圖）。如果之後這個延遲讓人不耐，加一個「背景保留上次視圖的
  快照」的優化是可能的後續，這次不做。
