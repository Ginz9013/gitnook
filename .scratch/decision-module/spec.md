# Decision — ADR 管理模組（Nook 的第二個一等公民實體）

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`）。

## Problem

這個 repo 自己的 12 篇 ADR 存在 `docs/adr/*.md`，是這個專案明確拒絕的儲存
方式的翻版：純文字檔＋人工維護的編號，找一篇決策要嘛記得編號要嘛整批翻。
Nook 已經證明「op-log NDJSON ＋ git union merge」能讓 Issue 在並行分支下
零衝突地收斂，而 ADR 跟 Issue 一樣是「一次寫入、偶爾修改、需要看修改歷史」
的文字紀錄，卻沒有享受到同一套機制。

## Outcome

`.decisions/decisions/<ULID>.ndjson`：一個決策一個檔，標題與內文分開存放
（`title`/`body` 兩個 LWW 欄位），有 `nook decision list` 可以快速掃描/grep
「有沒有某個決策」，有 `nook decision history` 可以看到某個欄位曾經被寫過
什麼、誰寫的——不做 restore（同票 09 的先例）。Issue 既有指令搬進
`nook issue <verb>`，與 `nook decision <verb>` 完全對稱、互不干擾。

## Scope

- `.decisions/decisions/<ULID>.ndjson`，一行一個 op，`merge=union`
- `Decision` 欄位：`title` `body` `disposition`
  （`proposed`/`accepted`/`superseded`/`rejected`）`supersededBy`（指向另一個
  Decision ref，只驗證形狀不驗證存在）`legacyRef`（見 Domain decisions）
- `nook decision init/new/list/show/set/history`
- `nook issue <verb>`：既有 11 個 Issue 指令原樣搬過去（breaking change，
  0.4.x pre-1.0 允許）
- `nook doctor` 涵蓋 `.decisions/` 的 `merge=union` 檢查
- 遷移 `docs/adr/0001`–`0012` 進 Decision Log，刪除原 markdown

## Non-goals

明確不做，這次不是「把 Issue 的每個能力都複製一份」：

- **labels、comments、archived/deleted、private sharing、workspace/studio
  整合。** 沒人要求，Decision 這次只要 title/body/disposition/history。
  真的需要再開新的一批。
- **`supersededBy` 的存在性驗證與自動同步 disposition。** 設它不會自動把
  disposition 改成 `superseded`，也不驗證目標 ref 真的存在——同這個 repo
  對 label 的既有態度（自由字串、不驗證語意）。
- **`legacyRef` 不是持續運作的編號產生器。** 只在遷移那張票對 12 篇既有
  ADR 各自標記一次；之後新建的 Decision 永遠不會有它。原因見 Domain
  decisions。
- **`nook issue`/`nook decision` 不提供舊指令的相容別名。** pre-1.0 直接
  breaking，CHANGELOG 照專案既有慣例記在 Changed/Removed。

## Domain decisions

**Decision 與 Decision Log 是新詞，不重用「Board」。** CONTEXT.md 已把
`Board` 定義死為「一個 repo 內全部 **Issue** 的集合」；Decision 的集合另外
取名 **Decision Log**，避免同一個詞在同一份文件裡指兩種不同的東西。

**Disposition 不叫 Status。** `Status` 在 CONTEXT.md 已被定義為 Issue 的
八個固定工作流位置；Decision 的生命週期（定案與否）是完全不同的語意軸，
沿用同一個詞會讓讀者以為兩者的值域或意義可以互換。

**`legacyRef` 只服務歷史相容，不是遞增計數器。** 這個系統存在的理由就是
「op 的集合而非順序決定收斂結果」——一個持續遞增的序號在兩個分支各自
新建 Decision 時天生會撞號，直接違背這條核心保證。既然只有 12 篇既有 ADR
需要保留舊編號給程式碼註解引用，`legacyRef` 就設計成「遷移當下手動標記
一次的歷史欄位」，新建的 Decision 不會、也不該再產生它——同 `Queued`
的先例，這是慣例而非程式碼強制的規則。

**`oplog.ts` 是全新檔案，不改動 Issue 既有的 `ops.ts`/`reduce.ts`。**
兩者的序列化/排序/dedupe/lamport 邏輯完全相同，這是「兩個真實 adapter」
值得抽共用引擎的情況（這個 repo 自己的 commit 463343d 就是「兩份排序
邏輯分岔」出的 bug）。但抽出來的目標是**新引擎給 Decision 用**，不是把
Issue 現有、已測試穩定的程式碼重構過去冒風險——Issue 維持原樣，零回歸
風險。

**`gitattributes.ts` 的尋根／初始化泛化，`initBoard`/`findBoardRoot` 對
Issue 的公開行為不變。** 內部改成接受「marker 目錄 + gitattributes
pattern」的參數化版本，Issue 的兩個既有匯出變成呼叫它的薄包裝——外部看
不出差異，`gitattributes.test.ts` 應該原封不動全綠。

## Design contract

### `src/core/oplog.ts`（新，泛型 CRDT 引擎）

- Responsibilities：`serialize<T extends OpBase>` / `parseLine<T>` /
  `splitGluedLine` / `nextLamport<T extends OpBase>` /
  `orderOps<T extends OpBase>`——全序排序 `(t, a, id)` → dedupe by id，
  同 `core/reduce.ts` 既有 `orderOps` 的規則，泛型化後供 Decision 使用。
- Non-responsibilities：不知道 `Op`/`DecisionOp` 個別型別的欄位形狀，
  只認 `OpBase`（`id`/`t`/`a`）。fold（reduce）邏輯不在這裡，每個實體
  自己的語意（LWW／OR-Set／…）差異太大，硬塞會變成「介面跟實作一樣
  複雜」的假接縫。
- Interface：純函數，無副作用，無 I/O。
- Seam：直接 import，模組內部工具，不上 `src/index.ts` 公開面。
- Dependencies：無。

### `src/core/decisionOps.ts` / `decisionTypes.ts` / `decisionReduce.ts` / `decisionLog.ts`

同 `ops.ts`/`types.ts`/`reduce.ts`/`board.ts` 的既有分工，但欄位換成
`title`/`body`/`disposition`/`supersededBy`/`legacyRef`，且沒有 OR-Set／
comments。`DecisionLog` 介面：`create`/`get`/`list`/`refs`/`apply`/
`opLog`/`root`/`health`，同 `Board` 的簽章形狀但吃 `Decision`/
`CreateDecisionInput`/`DecisionChange`。**沒有 `Board`/`DecisionLog` 的
共用泛型介面**——欄位驗證規則差異真實存在（`IssueDeleted` 檢查、label
add-wins 完全是 Decision 用不到的東西），硬統一會製造假接縫。

### `src/cli/decision.ts`（新，仿 `cli/workspace.ts` 的 `dispatchWorkspace` 先例）

`dispatchDecision(argv, io)`：`init`/`new`/`list`/`show`/`set`/`history`
六個子指令，重用 `run.ts` 既有的泛用 helper（`parseArgs`/`errLine`/
`fromEditor`/`confirmed`/`longText`/`displayLength`/`UsageError`），欄位
驗證邏輯（`asDecisionChange`、`SETTABLE_DECISION`）獨立於 Issue 的版本，
不共用（形狀不同）。

### `src/cli/issue.ts`（新，Issue 既有指令原樣搬過來）

`dispatchIssue(argv, io)`：`init`/`new`/`list`/`show`/`history`/`set`/
`rm`/`mv`/`comment`/`label`/`share` 十一個，函式本體從 `run.ts` 剪貼過去，
行為逐字不變。`run.ts` 的 dispatch 縮成 `case 'issue': return
dispatchIssue(rest, io)` / `case 'decision': return dispatchDecision(rest,
io)`，`doctor`/`studio`/`workspace`/`--help`/`--version` 留在頂層。

## Acceptance criteria

- [ ] `nook decision init` 建立 `.decisions/decisions/` 與
      `.decisions/decisions/*.ndjson merge=union` 那一行；已存在衝突規則
      時報錯停止（同 `initBoard` 既有行為）
- [ ] `nook decision new --title <t> [--body <b>] [--disposition <d>]`
      產生**恰好對應** op 的 NDJSON 檔，`nook decision show <ref>` 能摺回
      正確的 `title`/`body`/`disposition`
- [ ] `nook decision list [--disposition <d>]` 印出 compact table
      （ref/title/disposition），可用 `grep` 找到特定決策
- [ ] `nook decision set <ref> <title|body|disposition|supersededBy>
      <value|->` 能個別修改任一欄位，`disposition` 接受同 Status 一樣的
      無歧義前綴解析，不合法值拋 `InvalidDisposition`
- [ ] `nook decision history <ref> [field]` 列出該欄位所有 `set` op 帶
      actor 與 lamport `t`，**不提供 restore**
- [ ] `nook issue <verb>`：既有 11 個指令行為與搬移前逐字相同（既有
      `test/cli/run.test.ts` 的案例全部改成 `issue` 前綴後仍然全綠）
- [ ] `nook doctor` 在 `.decisions/` 存在但缺少 `merge=union` 那一行時
      回報 Diagnostic；`.decisions/` 不存在時完全沉默（同 private-mode
      的「該診斷在這個情境下不存在」哲學）
- [ ] `docs/adr/0001`–`0012` 全部遷移進 `.decisions/decisions/`，各自帶
      正確的 `legacyRef`；`docs/adr/*.md` 全部刪除；`src/**`／
      `CONTEXT.md` 裡原本寫「docs/adr/000X」的地方全部改指向對應的
      `legacyRef`，周圍的推理文字不重寫
- [ ] `npm run bench` 四個硬指標全綠

## Test strategy

- Seam：`openDecisionLog()`（core，整合測試，真實 `mkdtemp`，同 ADR-0004）、
  `dispatchDecision(argv, io)` / `dispatchIssue(argv, io)`（CLI，既有 `Io`
  capture adapter）、`oplog.ts` 的排序/dedupe（屬性測試，同既有
  `reduce.convergence.test.ts` 的手法）
- Dependency handling：檔案系統與 git 一律真實，無 mock（ADR-0004）
- Test type：核心用整合測試為主，`oplog.ts` 的全序/dedupe 用屬性測試

## Verification

- Focused：`npx vitest run <該票的測試檔>`
- Suite：`npx vitest run`
- Static：`npx tsc --noEmit`
- Metrics：`npm run bench`（由票 07 之後統一跑一次）

## Baseline

Measured 2026-09-15，`main`（`bfeca4a`）：

- **766 tests passed / 42 files**
- **0 型別錯誤**（`npx tsc --noEmit`）
- 既有失敗：無。不要修任何不在你票上的東西。

## 寫入所有權與批次

| 票 | 擁有的檔案 | Blocked by |
|---|---|---|
| 01 | `core/oplog.ts`(新) `core/decisionOps.ts`(新) `core/decisionTypes.ts`(新) `core/decisionReduce.ts`(新) `core/decisionLog.ts`(新) `core/gitattributes.ts`（泛化，Issue 既有行為不變） `cli/decision.ts`(新，僅 init/new/show) `cli/run.ts`（新增 `case 'decision'` 一行） `src/index.ts`（新增 Decision 相關匯出） `CONTEXT.md`（Decision/Decision Log/Disposition 詞條）+ 上述各檔測試 | 無 |
| 02 | `cli/decision.ts`（擴充 list） `render/table.ts`（新增 decision 的 compact table）+ 測試 | 01 |
| 03 | `cli/decision.ts`（擴充 set）+ 測試 | 01（與 02、04 對 `cli/decision.ts` 全序） |
| 04 | `cli/decision.ts`（擴充 history） `render/table.ts`（decision history 呈現）+ 測試 | 01（與 02、03 對 `cli/decision.ts` 全序） |
| 05 | `cli/run.ts`（拆出 dispatch） `cli/issue.ts`(新) `test/cli/run.test.ts` `test/cli/issue.test.ts`(新) `README.md` `README.zh-TW.md` `AGENT.md` `CHANGELOG.md` | 01（避免同時改 `run.ts`） |
| 06 | `core/health.ts` + 測試 | 01 |
| 07 | **unbounded**：`.decisions/decisions/*.ndjson`(新) `docs/adr/*.md`(刪) `src/**`／`CONTEXT.md`／`README*.md`／`AGENT.md` 的引用掃尾 `test/integration/packed-smoke.test.ts` fixture | 01,02,03,04,05,06,08 |
| 08 | `render/table.ts`（Decision 單張 detail 版面） `cli/decision.ts`（`show` 改叫新函式）+ 測試——**票 01 落地後 review 追加**，見 `08-decision-show-render.md` | 02 |

批次：**B1=[01]、B2=[02,05,06]、B3=[08]、B4=[03]、B5=[04]、B6=[07]**。
02/03/04/08 全部碰 `cli/decision.ts`（08 還碰 `render/table.ts`），是
誠實的全序鏈，不是刻意製造的序列化——跟 `workspace-write` 那批的教訓
一樣。08 排在 02 之後、03/04 之前，因為它要用票 02 剛做出來的 Decision
compact table 渲染基礎，晚做只會讓 03/04 疊上去的東西多一次要重新對齊。

## Risks and deferred questions

- **`supersededBy` 沒有存在性驗證**，日後若真的痛（例如 `nook decision
  show` 想順便印出「取代它的那篇標題」卻發現 ref 早已不存在），值得再開
  一張票決定要不要加驗證或改成軟性提示。這次判斷為低機率、先接受。
- **`nook doctor` 對 decisions 的檢查只覆蓋 gitattributes 一項**，不做
  sharing/private-mode 的對稱診斷——那整塊本來就是 Non-goals。
- **票 07 的 disposition 判定需要人工讀過 12 篇 ADR 逐一決定**（例如
  `.scratch/decisions-batch/07-adr0006-stale.md` 曾標記 0006 內容過時），
  不能無腦全部設成 `accepted`。
