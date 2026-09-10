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

**Board**:
一個 repo 內全部 Issue 的集合。
_Avoid_: project, workspace, backlog（`backlog` 是一個 Status 值，不是集合的名稱）

**Sharing（共享狀態）**:
一塊 Board 的 Op-log 是否交給 git 追蹤。兩個值：**shared** 是預設，Op-log 被 commit，`merge=union` 是它的零衝突保證；**private** 的 Op-log 被 `$GIT_DIR/info/exclude` 排除，只存在於這一個工作目錄（ADR-0011）。
_Avoid_: mode, local, offline, visibility（`visibility` 已經被 `archived` 佔用 —— 那是「先不要看到」，與「要不要交給 git」是兩件事）

> 三條語意，講這個詞的時候要一起帶著：
>
> 1. **Sharing 是推導出來的，不是儲存的。** 沒有 config 檔、也沒有 marker 檔
>    （ADR-0002：`.issues/` 底下零本機狀態）。
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
Issue 在工作流上的位置。八個固定值之一，不可自訂。
_Avoid_: state, stage, column

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
