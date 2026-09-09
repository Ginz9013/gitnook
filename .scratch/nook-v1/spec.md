# Nook v1 — git-native、agent-first 的輕量 issue tracker

## Problem

現有工具在兩端各有問題。SaaS（Linear / Jira）＋ MCP 把資料放在別人家，issue 與 code 的版本脫節，checkout 到三個月前的 commit 看不到當時的 issue 狀態。git-native 的既有方案則各有硬傷：

- **git-bug** 把 issue 存進 git objects（`refs/bugs/*`），不在 working tree —— GitHub 網頁看不到、`grep` 不到、agent 不能 `cat`，也無法當 devDependency 隨 `npm install` 到位。
- **backlog.md**（6,668★，2025-06 起）雖然是每票一個 markdown 檔且有 web UI，但拿 markdown 當**儲存格式**：用 `## Status` heading 當資料庫欄位。其 open issue 中有一整串同源病灶（#1008 section lookahead 截斷、#1010 heading 被當成 section 內容、#794 欄位靜默覆寫、#997 ID 撞號、#937 缺併發協調）。它同時以 Bun 編譯的原生 binary 分發，darwin-arm64 單平台 67.5MB，且未提供 musl build。

沒有任何一個工具在**並行分支下 merge 不衝突**。

## Outcome

一個 npm 套件。`npm i -D gitnook` 之後，`nook` 指令可用；issue 以純文字存在 repo 內、隨 git 走；兩個開發者在各自分支同時修改同一張票，`git merge` **不產生衝突且不遺失任何一方的變更**；`nook studio` 在 localhost 開一個唯讀看板供會議討論。

## Scope

- op-based CRDT，append-only NDJSON，每個 issue 一個檔
- 靠 git **內建**的 `merge=union` driver 達成零衝突（`.gitattributes` 提交即對所有 clone 生效，無需任何人執行 `git config`）
- library-first：`openBoard()` 可被 import
- 10 個 CLI 指令，預設輸出為緊湊表格（人與 agent 共用）
- SSR 唯讀 GUI，兩個檢視
- 四個可量測的硬指標，全部進 CI

## Non-goals

明確不做，且應在 README 公開拒絕：

assignee、priority、milestone、due date、estimate、可設定的 status、子任務（`- [ ]` 僅是文字）、搜尋/篩選 UI、GUI 編輯、TUI、MCP server、op-log 壓縮、issue 刪除、`nook next` 這類貼合特定 agent 工作流的原語。

> 護城河是**拒絕成為專案管理工具**的能力。輕量與正確性是這條原則的結果，不是賣點本身。

## Domain decisions

### 儲存

```
.issues/issues/01JBX7A9Q3.ndjson    committed, merge=union
.gitattributes                       committed（含 `.issues/issues/*.ndjson merge=union`）
```

零本機狀態、零衍生資料、零需要 gitignore 的東西、無 `config.json`、無 SQLite。

- **actor id** 由 `git config user.email` 推導（確定性，不儲存）
- **lamport clock** 寫入前讀該單檔取 `max(t)+1`（每個 issue 是獨立的 CRDT 文件，clock 只需 per-issue）
- **檔名是純 ULID**，不含 title slug —— 改標題不該造成檔案 rename，rename 會讓 `merge=union` 失效

### 為什麼不用 SQLite

實測全量掃描 + fold：100 票 3ms、500 票 14ms、2000 票 53ms、10000 票 266ms（Node 本身冷啟 10–20ms）。為省 14ms 引入資料庫與一整類快取失效 bug 不划算。且 `better-sqlite3` 是每平台一份原生 binary —— 正是本專案在批評的東西。

**重新考慮的門檻：超過 ~5000 張票。** 屆時答案也不是 SQLite，是一個以 op-log 最大 lamport 為版本戳的衍生單檔 JSON snapshot。

### op 型別（5 種）

`create` / `set` / `label.add` / `label.rm` / `comment`

每行固定欄位：`id`（ULID，dedupe 用）、`t`（lamport，排序用）、`a`（actor）、`op`。

```jsonl
{"id":"01JBX7A9Q3","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}
{"id":"01JBX7B2K9","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}
{"id":"01JBX7C5R1","t":3,"a":"k3f9","op":"label.add","v":"bug"}
{"id":"01JBX9F3M2","t":4,"a":"m8q2","op":"label.rm","v":"bug","seen":["01JBX7C5R1"]}
{"id":"01JBX8D7T4","t":5,"a":"m8q2","op":"comment","body":"safari 才會重現"}
```

`label.rm` 攜帶 `seen`（它觀察到的 add op id 集合）才有正確的 **add-wins** OR-Set 語意 —— 並行發生、不在 `seen` 內的 add 必須存活。

### reducer（收斂性的全部來源）

```
1. 逐行 parse，無法 parse 的丟棄並記錄（供 doctor）
2. 全序排序 by (t, a, id)                        ← 交換律 ★
3. dedupe by op.id，保留全序中的第一個            ← 冪等性
4. fold（純函數）                                ← 結合律
```

第 2 步是心臟：最終狀態只取決於 op **集合**，不取決於它們在檔案裡的順序，所以 union merge 如何交錯兩邊的行都無所謂。

**排序必須在 dedupe 之前。** spike T3 只證實 git 會去重「位元組完全相同」的行；同 id 而內容不同的行（ULID 碰撞、當機寫到一半、`doctor` 修復黏合行、手動編輯）union merge 會照樣兩行都留。若先 dedupe，「保留第一次出現」的「第一」就定義在行順序上，收斂性隨即破功。先排序後，「第一」定義在全序上，才真正與行順序無關。

### spike 逼出的三條硬規則

實測 `merge=union`（git 2.50.1）的結果，見 `spike-findings.md`：

1. **寫入永遠以 `\n` 結尾。** 缺少時 union merge 會把兩行黏成 `{"id":"b1"}{"id":"b2"}` 這種非法 JSON，並複製前一行。reducer 必須偵測黏合行，`doctor` 必須能修復。
2. **未知 op 型別必須忽略而非崩潰。** 資料在 git 裡、隊友版本不同步是常態，向前相容是資料安全問題。
3. **不得真的刪除 issue 檔。** 實測 modify/delete 是 union 不涵蓋的固有衝突。v1 不提供刪除。

（`snapshot` op 需攜帶 `supersedes` 才能在 union merge 下安全壓縮 —— 已驗證，但 v1 不實作壓縮。）

### 領域模型

**欄位**：`title` `status` `description` `labels` `archived` + comments

**status（8，固定不可設定）**

```
backlog  todo  queued  in_progress  review  blocked  done  cancelled
```

`backlog` / `todo` 是**人的車道**；`queued` 之後是 **agent 的車道**。`queued` 是交接閘門 —— **票進入 `queued` 等於授權 agent 不再詢問、直接動手**，這是授權邊界而非分類。

> **已推翻（2026-09-09）**：原文此處還有一句「設 `blocked` 時必須同時留一則 comment 說明原因」。那條規則已整條移除 —— 狀態不該帶有額外效果，見改寫後的 ADR-0003。

`archived` 是獨立的 boolean 欄位而非 status：歸檔是**可見性**，`done`/`cancelled` 是**工作結果**，兩者正交。若 archived 是 status，一張 done 的票歸檔後將永久遺失「它是完成還是取消」。

**ID**：檔名用完整 ULID；顯示與輸入接受**無歧義前綴**（同 git short hash），預設顯示 6 碼，撞號時報錯要求更長。status 同樣接受無歧義前綴（`ready`→`queued` 改名後，8 個值無前綴撞號）。

## Design contract

### `Board`（深模組，即公開的 library 介面）

```typescript
openBoard(opts?: { dir?: string; actor?: string; ids?: IdSource }): Board

interface Board {
  create(input: { title: string; description?: string; labels?: string[]; status?: Status }): Issue
  get(ref: string): Issue
  list(filter?: Filter): Issue[]
  apply(ref: string, change: Change): Issue
  health(): Diagnostic[]
}
```

- **Responsibilities**：op 的產生與追加、lamport clock、ULID、trailing-newline 紀律、dedupe、全序排序、fold、OR-Set 的 `seen` 追蹤、ref 前綴解析。
- **Non-responsibilities**：呈現（render/*）、argv 解析（cli/*）、HTTP（server/*）。
- **Interface**：呼叫端**永遠不會看到 op**。`apply(ref, { labels: { add: ['bug'] } })` 即可，OR-Set 的細節在內部。錯誤：`RefNotFound`、`AmbiguousRef`、`InvalidStatus`、`BoardNotInitialized`。副作用：對單一 issue 檔 append。不變量：任何 `apply` 之後檔案仍是合法 NDJSON 且以 `\n` 結尾。
- **Seam**：`openBoard()` 本身即公開接縫。
- **Dependencies**：`IdSource`（注入）、檔案系統（**真實**）。

**刪除測試**：拿掉 `Board`，CRDT 複雜度會同時出現在 10 個 CLI 指令、GUI server、與每個第三方 importer 身上。撐得住。

### 兩個刻意不設的接縫

**無 storage 接縫、無 in-memory fake。** 正確性風險有三塊：reducer 收斂性（純函數）、檔案 I/O 紀律、git merge 行為。後兩塊正是 spike 抓到 bug 的地方；in-memory store 會讓測試在這兩塊全綠而真實情況是壞的 —— 那不是接縫，是掩體。測試用暫存目錄，100 票 3ms，fake 換不到任何東西。

**無 `Renderer` 介面。** 三個渲染器沒有任何地方會多型分派（CLI 靜態知道要哪個，server 也是）。抽介面就是「一個 adapter 的假接縫」。三個獨立純函數即可，且純函數讓 token 預算測試能直接量 `renderTable()` 的輸出 byte 數。

### 兩個真實的接縫（各有兩個 adapter）

| 接縫 | 為什麼是真的 | adapters |
|---|---|---|
| `IdSource` | ULID / lamport 非確定性，但 golden-file 與 byte 預算測試需要可重現輸出 | 真實（crypto + time）／ 種子化 |
| `Io` | CLI 測試不該 spawn 子行程 | 真實 process ／ 捕獲用 fake |

兩者皆以「接受依賴，不要自己建立」注入：`openBoard({ ids })`、`run(argv, io)`。

### 內部接縫

`src/core/reduce.ts` 不對外匯出，但其測試直接打它 —— 收斂性（交換律、冪等性）最適合屬性測試。

### 模組與檔案

```
src/core/types.ts           完整型別（T01 一次定義，讓渲染層能平行開工）
src/core/ops.ts             op 型別、單行序列化/解析、\n 紀律、黏合行偵測
src/core/reduce.ts          dedupe → 全序排序 → fold（忽略未知 op）
src/core/board.ts           深模組本體
src/core/ids.ts             ULID + 無歧義前綴解析（IdSource 接縫）
src/core/actor.ts           從 git config 推導 actor
src/core/gitattributes.ts   確保 / 驗證 merge=union 那一行
src/core/health.ts          doctor 的診斷邏輯
src/render/table.ts         緊湊表格 ← token 預算的量測對象
src/render/json.ts          --json 輸出
src/render/html.ts          看板 + 詳情 SSR
src/cli/run.ts              argv → Board → render → exit code（Io 接縫）
src/server/handler.ts       純請求處理器
src/server/serve.ts         http 外殼 + 127.0.0.1 綁定
src/index.ts                公開匯出（僅 openBoard 與型別）
```

## Acceptance criteria

- [ ] `npm i -D gitnook` 後 `nook` 指令可用，`nook init` 產生 `.issues/issues/` 與 `.gitattributes` 那一行
- [ ] 兩個分支各自修改同一張票，`git merge` 無衝突且雙方變更皆存活（真實 git 整合測試）
- [ ] `git pull --rebase` 路徑同樣無衝突
- [ ] 缺少 trailing newline 造成的黏合行被偵測，`nook doctor` 能報告並修復
- [ ] 未知 op 型別被忽略，不使既有資料無法讀取
- [ ] 並行的 `label.add` 與 `label.rm` 遵守 add-wins
- [ ] op 順序任意打亂，fold 結果不變（屬性測試）
- [ ] `.gitattributes` 已存在且含衝突規則時 `init` 報錯停止，不靜默改變他人的 merge 行為
- [ ] `list` 預設隱藏 archived / done / cancelled
- [ ] ID 與 status 皆接受無歧義前綴，撞號時報錯
- [ ] `nook studio` 只綁 `127.0.0.1`，8 欄看板 + 詳情，每 2 秒輪詢 `/hash` 變更即重載
- [ ] markdown 渲染關閉 raw HTML
- [ ] 四個硬指標的閘門測試存在且通過

## 四個硬指標

| 指標 | 目標 | 量測方式 |
|---|---|---|
| package size | < 3MB | `npm pack` 後解壓量測 |
| `npx` 冷啟 | < 500ms | 由 packed tarball 執行 `nook --version` |
| 並行 merge | 零衝突 | 真實 git 整合測試 |
| agent token | < 4.5KB | 見下 |

**token 情境**（刻意不綁定特定 agent 工作流）：40 張票的專案 → `list` → `show` 一張 → `mv` → `comment`，量測「skill 文件 + 全部 CLI 輸出」的總 byte 數。**上限 4.5KB（約 1150 tokens），綁定 40 票這個前提**（會隨票數線性成長）。

用 byte 數而非 tokenizer：`tiktoken` 是 WASM、`gpt-tokenizer` 是數 MB devDependency，且不同模型 tokenizer 不同、數字無絕對意義。byte 數是確定性、零依賴的，作為**回歸閘門**完全夠用。

同一原因下的設計結論：**`--json` 對 agent 反而浪費**（`{"id":"01JBX7A9Q3","title":"Fix login redirect","status":"queued","labels":["bug"]}` 83 bytes vs `01JBX7  queued  Fix login redirect  [bug]` 41 bytes）。預設輸出即緊湊表格，skill 文件教 agent 用預設格式；`--json` 僅供程式化串接。

## Test strategy

- **Seam**：`openBoard()`（整合）、`reduce()`（內部，屬性測試）、`renderTable()` 等純函數（單元）、`run(argv, io)`（CLI 整合，不 spawn）、`handleRequest()`（server 單元）
- **Dependency handling**：檔案系統與 git 一律**真實**（暫存目錄 + 真實 `git` 指令）。`IdSource` 與 `Io` 用測試 adapter。無 mock。
- **Test type**：CRDT 語意用屬性測試（打亂順序、重複注入、並行分支）；merge 行為用真實 git 整合測試；輸出用 golden file

## Verification

- Focused：`npx vitest run <該票的測試檔>`
- Suite：`npx vitest run`
- Static：`npx tsc --noEmit`
- Metrics：`npm run bench`

## Baseline

Measured 2026-09-08。目錄為空且**不是 git repo**（`git rev-parse` 回報 fatal）。

- 既有失敗測試：**0**
- 既有型別錯誤：**0**
- 基線乾淨。任何失敗都是本次工作造成的。

工具版本：git 2.50.1、node v22.22.1。

## Risks and deferred questions

- **套件名為 `gitnook`（unscoped，2026-09-09 改定）。** 前一版決定「維持 `@nook/cli`」的前提是「`@nook` scope 註冊得到」，該前提在發布前的實測中被推翻：registry 的 `/-/org/nook/user` 回 `{"nook":"owner"}`（對照 `nookdev` 回 `Scope not found`），`nook` 這個名字在 npm 的 user/org 共用命名空間裡已被別的帳號佔走 —— 不是佔著 `nook` **套件**的 `yaroslavgaponov`，是另一個帳號。`@nook/cli` 因此發不出去，`npm org create nook` 也會被拒。
  既然被迫改名，就順手把 `/cli` 過窄的顧慮一併收掉（那個顧慮當初是因為「改名代價高」才將就下來的，而發布前的改名代價是零）：`gitnook` 一個字說出 git-native，且讓 `import { openBoard } from 'gitnook'` 讀起來成立 —— `from 'nook-cli'` 會暗示有個拿不到的 `nook` core 分包，與 library-first 的定位相衝。bin 名維持 `nook`，所以 README 只有安裝那一行要改。
  不建 org：org 對 public 套件免費，但價值在多套件命名空間與團隊分權，現況一個人一個套件買不到。unscoped `nook` 仍符合 npm name dispute 條件（2014-10-30 後未再發布），沒去追 —— 拿到也不值得再改一次名。

- **token 預算的餘裕只有 9.4%。** 票 07 實測 40 票情境為 3710B / 4096B，餘裕 386B。`list` 一段就佔了 69% 的預算且隨票數線性成長 —— 約 45 張票就會爆。上限已綁定 40 票這個前提，所以這是設計上接受的，但**票 10（CLI）與票 11（skill 文件正式版）任何一方多寫幾行都會撞上**。閘門的靈敏度實測約 10%（欄距從 2 空白改成 6 即被擋下）。
- **protocol-relative URL（`//evil.com`）不被 scheme 白名單擋下**，因為它不帶 scheme。在唯讀的 localhost 檢視器上這是導覽困擾而非 XSS 路徑，票 08 選擇如實回報而不擅自放寬規則。
- **`serve.test.ts` 的 LAN 綁定測試需要一個非 loopback 的 IPv4 介面。** 票 09 刻意讓它在找不到時**拋錯而非靜默跳過** —— 靜默跳過會讓 `0.0.0.0` 的迴歸在 CI 裡無聲通過。若 CI 環境沒有對外介面，這需要一個明確決定（標記為 known-skip 並在別處補償），不能默默略過。
- **詳情頁沒有輪詢重載。** 票 09 的寫入範圍只授權放寬 `renderBoardHtml`，給 `renderIssueHtml` 同樣的選項是第二次簽章變更，worker 選擇回報而非越界。看板（開會的投影面）會自動更新，`/i/<ref>` 不會。約兩行的後續工作。

  > **已消失（2026-09-09）**：伺服器渲染的詳情頁在 studio 改版時整個移除，`renderBoardHtml` 與 `renderIssueHtml` 都不存在了（ADR-0008）。studio 現在是 React SPA，輪詢在 `src/studio/poll.ts`，看板與 drawer 走同一份局部套用。這條 risk 隨那個頁面一起消失。
- **~~渲染層的短 ID 無歧義只在「它拿到的那一批」之內成立。~~（已解決 —— 票 15 ＋ 票 16）** `renderTable` 通常收到 `list()` 的結果，而 `list()` 預設隱藏 archived / done / cancelled —— 一個對 `list` 輸出無歧義的短 ID，仍可能與被隱藏的 Issue 在 `board.get()` 端撞號。失敗是安全的（`AmbiguousRef` 會列出候選），但仍是壞 Ref。要修得把解析用的候選集合傳進渲染層，會改變 `renderTable` 的簽章。（票 12 回報）
  **修法與這裡的預測不同，簽章沒有動。** 票 15 讓 `Board` 公開 `refs()`（只列目錄、不摺疊任何 Op-log），票 16 讓 `src/cli/run.ts` 以 `displayLength(board) = shortIdLength(board.refs())` 對整塊 Board 算長度，再傳進 `renderTable` **原本就存在**的第二個參數（`shortIdLen?`，票 12 自己加的）。渲染層要的是一個算好的長度，不是候選集合；錯的是 CLI 餵進去的那一批。`list` / `show` 與四個回印路徑共六個呼叫點現在全走這條路。見 ADR-0006。
- **`new` 印出的短 ID 可能日後變成有歧義。** ULID 前綴是時間高位，之後建立的 Issue 可能延長共用前綴。契約是「印出的當下無歧義」，git 有同樣的性質。要永久穩定只能印完整 26 碼。（票 10 回報）
- **`.gitattributes` 是唯一的單點失效。** 被誤刪時資料會靜默開始衝突。`doctor` 必須檢查，`list`/`show` 偵測缺失時應印警告。
- **description 是 LWW**，並行編輯會撞掉整份文件。敗方版本完整留在 op-log；v1 未提供 `history --restore` 撈回介面（**已知缺口，v2 補**）。將來上 RGA/Fugue 時 op-log 格式不需改變，僅新增 op 型別。
- **跨 branch 無真正原子性。** 多個 agent 在各自 worktree 平行工作時可能重複領取同一張票；CRDT 會讓兩個 op 都存活並收斂，但工可能白做。v1 接受此限制並寫入文件。
- **市場風險（非工程風險）。** backlog.md 15 個月累積 6,668★（git-bug 用 8 年累積 10,023★，星速差約 4 倍）—— category 是熱的。但其使用者實際在要求的是 UI 深度與功能廣度（最多 +1 的 open issue 是 web UI 篩選、label 顏色、roadmap），**不是**本專案差異化所在的正確性與輕量。相關 issue 的 reaction 多為 +1 / +0：**痛是真的，但沒人在痛**。差異化偏工程師審美，可能拿到星但留不住人 —— library-first 定位正是為了避開這個陷阱。驗證方式：MVP 完成後 Show HN，48 小時內 <300★ 收手當自用工具，>1000★ 繼續投入。
