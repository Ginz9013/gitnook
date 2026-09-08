# Nook

一個隨 git 走的 issue tracker。Issue 以純文字存在 repo 內，並行分支合併時不衝突、不遺失變更。使用者只有開發者與 AI agent。

## Language

### 領域物件

**Issue**:
一個待處理的工作項目。Nook 追蹤的唯一實體。
_Avoid_: task, ticket, card, story, 票

**Board**:
一個 repo 內全部 Issue 的集合。
_Avoid_: project, workspace, backlog（`backlog` 是一個 Status 值，不是集合的名稱）

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
Status 序列被切成兩段：`backlog` 與 `todo` 是**人的車道**，`queued` 之後是 **agent 的車道**。這條線是 Board 上最重要的分界 —— 它回答「現在塞住的是哪一邊」。

**Queued**:
人與 agent 之間的**交接閘門**。一張 Issue 進入 `queued` 表示需求已釐清、無阻擋，且**已授權 agent 不再詢問、直接動手**。這是授權邊界，不只是分類。
_Avoid_: ready, ready to go, todo

**Blocked**:
工作已開始但無法推進。設為 `blocked` 時**必須同時留下一則 Comment 說明原因** —— 這條規則補上了「卡住前在做什麼」這項在扁平 Status 中會遺失的資訊。

**Archived**:
一張 Issue 是否從預設檢視隱藏。這是**可見性**，與 `done` / `cancelled` 所表達的**工作結果**正交，因此不是一個 Status。

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
