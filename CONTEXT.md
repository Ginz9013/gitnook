# Nook

一個隨 git 走的 issue tracker。Issue 以純文字存在 repo 內，並行分支合併時不衝突、不遺失變更。使用者只有開發者與 AI agent。

## Language

### 領域物件

**Issue**:
一個待處理的工作項目。Nook 追蹤的唯一實體。
_Avoid_: task, ticket, card, story, 票

> `票` 這個字**只有一種合法用法**：指 `.scratch/<feature>/` 底下某一張規劃用的
> 工作單（「票 B3」）。那是規劃流程的東西，不是 Nook 的實體，兩者不會混淆是
> 因為它永遠帶著編號。單獨用「票」或「這張票」來指一個 Issue 仍然是禁止的 ——
> 程式碼註解裡指涉自己這一批工作時，說「這一批」。

**Decision**:
一個記錄下來的架構／專案決策。Nook 的第二個一等公民實體，與 Issue 平行存在、互不隸屬——Decision 不會變成 Issue，Issue 也不會變成 Decision。
_Avoid_: ADR（那是這個實體目前唯一的來源與使用情境，不是它的名字——資料一旦進了 Decision Log，講的就是 Decision，不是 ADR）, ticket, task, 票（同 **Issue** 詞條的既有禁令）

**Board**:
一個 repo 內全部 Issue 的集合。**只裝 Issue**——決策記錄的集合是另一個詞，見下方 **Decision Log**，兩者不是上下位關係，也不共用儲存或介面。
_Avoid_: project, workspace（`workspace` 是彙整多個 Board 的觀察角度，見下方 **Workspace** 條目——單一 Board 不是 workspace，兩者不可混用）, backlog（`backlog` 是一個 Status 值，不是集合的名稱）

**Decision Log**:
一個 repo 內全部 Decision 的集合——角色同 Board 之於 Issue，但刻意不重用「Board」這個詞：Board 在本文件已定義死為「全部 Issue 的集合」，同一個詞在同一份文件裡指兩種不同的東西會讓讀者猜錯。儲存與介面（`openDecisionLog()`/`DecisionLog`）也與 Board 各自獨立，不共用同一份泛型型別。
_Avoid_: Board（見上）, archive, registry, ADR log

**Workspace**:
從一個根目錄往下遞迴掃描找到的一組 Board，供跨 Board 檢視（列表、篩選、健康檢查）之用。純粹是觀察的角度——不建立任何新的儲存或狀態，不合併任何 Op-log，每個成員 Board 完全維持自己的獨立性（各自的 Op-log、Actor、Sharing）。探測預設仍是純檔案系統掃描：只問某個子目錄底下有沒有 `.gitnook/`，找到就不再往它底下更深處找，不需要讀任何設定檔。但一個 Board 可以透過 `.gitnook/config.json` 的 `workspace: true` 主動宣告自己也是一個 workspace 節點，此時掃描會繼續往它底下鑽，子目錄裡遇到的 Board 遞迴套用同一條規則——這是對 ADR-0012「不讀設定檔」立場的一次重新打開，取捨記在 `nook decision show 01M2NF1YPK3D5WPX9KWZTX0AH7`（取代 ADR-0012）。
_Avoid_: monorepo（那是使用者資料夾佈局的慣例，Workspace 是 nook 對任何佈局的一種觀察方式，兩者正交——沒有 monorepo 佈局也能有 Workspace，例如母資料夾底下並排幾個不相干的 repo）, fleet, federation, group, collection（太泛用，沒有指名「一起被看的是哪些 Board」這件事）

**Sharing（共享狀態）**:
一個 `.gitnook/` 容器是否交給 git 追蹤——**以整個容器為單位，不分模組**：Board 的 Op-log 與 Decision Log 的 Op-log 是各自獨立的兩份檔案（各自的資料格式、marker 子目錄、`merge=union` 規則），但一條 exclude 規則蓋住整個 `.gitnook/`，兩者永遠一起 shared 或一起 private，沒有「Issue shared、Decision private」這種混搭。兩個值：**shared** 是預設，Op-log 被 commit，`merge=union` 是它的零衝突保證；**private** 的 Op-log 被 `$GIT_DIR/info/exclude` 排除，只存在於這一個工作目錄（ADR-0011）。
_Avoid_: mode, local, offline, visibility（`visibility` 已經被 `archived` 佔用 —— 那是「先不要看到」，與「要不要交給 git」是兩件事）

> 三條語意，講這個詞的時候要一起帶著：
>
> 1. **Sharing 是推導出來的，不是儲存的。** 沒有專門記錄 Sharing 狀態的 config
>    檔或 marker 檔，永遠問 git 本身（op-log 有沒有被追蹤）。`.gitnook/config.json`
>    是這個容器底下**唯一**的本機設定檔，但它記的是 Workspace 的
>    continue-scanning 旗標（見 **Workspace** 詞條），不記 Sharing——兩者是完全
>    不同的兩件事，讀錯一個不會讓另一個跟著算錯。
> 2. **private 是被測的那一側，其餘一律算 shared。** 剛 init 還沒 commit 的
>    Board 是 shared —— 它的意圖是共享，只是還沒送出去。
> 3. **零衝突保證在 private Board 上是「不需要」，不是「缺少」**（保證本身見下面
>    的**收斂**）。被 ignore 的 Op-log 永遠不會 merge，所以 `doctor` 在那裡沉默
>    不是壓掉一個真問題，是那個問題在這個模式下不存在。

**Op**:
對單一 Issue 的一次不可變更動記錄，寫入後永不修改或刪除。
_Avoid_: event, mutation, delta, entry

**Op-log**:
一個 Issue 的全部 Op。Issue 的狀態是 Op-log 摺疊後的結果，而非獨立儲存的東西。
_Avoid_: history, journal, changelog

**Change**:
呼叫端表達的**意圖**（「把狀態改成 done」）。Board 負責把它翻譯成一個或多個 Op —— **呼叫端永遠不接觸 Op**。
_Avoid_: patch, update, command

**Actor**:
產生某個 Op 的人或 agent 的識別。用於合併時的決勝，**不表示某張 Issue 歸誰負責** —— Nook 沒有負責人的概念。
_Avoid_: user, author, owner, assignee

**Ref**:
指向一張 Issue 的字串。可以是完整識別碼，也可以是任何無歧義的前綴，且**大小寫不敏感**。
_Avoid_: id, key, slug

### 工作流

**Status**:
Issue 在工作流上的位置。八個固定值之一，不可自訂。**不是** Disposition（見下方 **Disposition** 條目）——兩者的值域與語意軸完全不同，不能互換或混用。
_Avoid_: state, stage, column

**Disposition**:
一個 Decision 的定案狀態。四個固定值之一（`proposed`/`accepted`/`superseded`/`rejected`），不可自訂。與 Status 是完全不同的語意軸：Status 問的是「工作流走到哪」，Disposition 問的是「定案了沒」——沒有 Lane、沒有人的車道／agent 的車道那種分界，也不是工作流。
_Avoid_: Status（見上，兩者的值域不可互換）, state, phase

**Lane（車道）**:
Status 序列被切成兩段：`backlog` 與 `todo` 是**人的車道**，`queued` 之後是 **agent 的車道**。這是**工作流上**的分界，回答「現在塞住的是哪一邊」—— **看板不畫它**（ADR-0010）。它是講事情時用的詞，不是介面上的一條線。

**Queued**:
人與 agent 之間的**交接閘門**。一張 Issue 進入 `queued` 表示需求已釐清、無阻擋，且**已授權 agent 不再詢問、直接動手**。這是授權邊界，不只是分類。那份語意由 CLI 與工作流的約定承擔：**在看板上它沒有任何特別待遇**，與其他七個 Status 長得一樣（ADR-0010）。
_Avoid_: ready, ready to go, todo

**Blocked**:
工作已開始但無法推進。**它就只是八個 Status 之一，不帶任何額外規則。**「卡住前在做什麼」這項資訊在扁平 Status 中確實會遺失，而我們接受這個遺失（ADR-0003）—— 想交代原因的人照樣可以留一則 Comment，但那是選擇，不是規則。

**Archived**:
一張 Issue 是否從預設檢視隱藏。這是**可見性**，與 `done` / `cancelled` 所表達的**工作結果**正交，因此不是一個 Status。它仍然是 Board 的成員：`--all` 看得到，而且永遠不會被清除。

**Deleted**:
一張 Issue 是否已經不存在。與 `archived` 一組對照著讀 —— archived 是「先不要看到」，deleted 是「當它沒有」：`--all` 也看不到，寫入被拒絕，日後的 `gc` 會把位元組真的清掉。兩者在儲存層是同一種東西（都是 LWW boolean 欄位），差別全在讀取端（ADR-0009）。檔案本身永不 unlink，所以 Op-log 照樣撈得回來，`set deleted false` 就是復原。
_Avoid_: removed, trashed, 廢棄

**Label**:
掛在 Issue 上的自由文字標記。Nook 沒有優先級欄位 —— 優先級用 Label 表達。

**Comment**:
掛在 Issue 上的一則留言，只增不減。人與 agent 共用，是 Nook 中唯一的討論載體。

### 保證

**收斂（Convergence）**:
Nook 的核心承諾：不論兩個分支的 Op 以什麼順序合併、是否重複，摺疊出來的 Issue 必然相同。

**Diagnostic**:
`doctor` 回報的一項資料健康問題（合併驅動遺失、無法解析的行、未知的 Op 型別）。
_Avoid_: error, warning, issue（後者在本專案已有專屬意義）
