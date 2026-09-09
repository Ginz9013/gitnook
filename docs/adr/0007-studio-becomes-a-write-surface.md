# studio 開放寫入，成為人的主要操作介面

studio 原本刻意唯讀。票 09 的驗收條件寫著「**無任何寫入路徑**」，`handleRequest` 以白名單只放行 `GET`，其餘一律 405 —— 方法檢查刻意放在路由之前，讓「哪些路徑存在」不能決定「能不能寫」。現在這條契約解除。

理由不是「唯讀不夠用」，而是 Lane 的分工終於落到介面上。CONTEXT.md 把 Status 序列切成兩段：`backlog` 與 `todo` 是人的車道，`queued` 之後是 agent 的車道。CLI 一直同時服務兩邊，但它其實只擅長後者 —— agent 要的是可組合、可解析、低 token 的文字介面。人的車道要的是另一種東西：把六張票拖進 `todo` 並排出順序、開著 drawer 逐張讀完再決定哪張進 `queued`。這些操作在 CLI 上是六次 `nook mv` 加上反覆 `nook show`，在看板上是六秒。**CLI 繼續是 agent 的介面，studio 成為人的介面**，兩者寫進同一份 op-log。

安全模型因此改變性質。`serve.ts` 只綁 `127.0.0.1` 且刻意不提供 `--host`，這在唯讀時期是保守的預設值；開放寫入之後，**它變成唯一的安全機制** —— studio 沒有任何驗證，暴露到其他介面等於把整塊 board 的寫入權送給同一個網段。`--host` 從「暫時沒做」升格為「永遠不做」。

並行寫入不需要鎖。Op-log 是 append-only，lamport 是 per-issue 的 `max(t)+1`，摺疊時以 `(t, actor, id)` 全序決勝 —— CLI 與 studio 同時寫同一張 Issue 在構造上就是安全的，這正是 ADR-0001 選擇 `merge=union` 時就已經付過的代價。

## Consequences

**沒有「被拒絕的寫入」這回事。** append-only 之下，寫入唯一的失敗模式是根本沒送到（server 收掉了、board 目錄被移走）；op 一旦 append 就永遠在。「你拖到 blocked 但畫面最後顯示 review」不是失敗，是你的 op 在 LWW 決勝時輸給了 agent 後來的那筆。前端因此不能套用一般 REST 樂觀更新的「失敗就回滾」模型 —— React Query、SWR 這類工具的預設假設在這裡是錯的。調和邏輯必須自己寫，見 `.scratch/studio-write/` 的 prototype。

**輪詢重載必須換掉。** 現行做法是每 2 秒比對 `/hash`，值變了就 `location.reload()`。整頁重載與任何互動都不相容：拖到一半被重載、drawer 開著被重載、捲動位置消失。取代它的是同一組輪詢加上局部套用，並額外遵守一條規則：**指標正按著的卡片不接受任何來自伺服器的移動**，快照押後到放開為止。

**Actor 身分是跑 studio 的那個人。** 經由 studio 產生的 op 一律記在 `git config user.email` 推導出的 actor 上。studio 是單人本機工具，這是正確的語意，但它意味著 studio 不可以變成多人共用的服務 —— 那會讓所有人的 op 記在同一個 actor 底下，破壞合併時的決勝依據。這是除了「沒有驗證」之外，第二個禁止 `--host` 的理由。

**`queued` 的授權邊界在 UI 上必須看得見。** 把一張 Issue 拖進 `queued` 表示已授權 agent 直接動手，這是 board 上語意最重的一次拖曳。它不能跟 `todo` → `in_progress` 長得一模一樣。
