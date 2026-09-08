# Status 固定八態不可自訂；`archived` 是欄位而非 Status

每個 issue tracker 都允許自訂狀態，Nook 不允許。可設定的 Status 會招來狀態機、轉換規則、每個狀態的顏色、WIP limit —— 這正是把同類工具從輕量拖成專案管理系統的那條路徑。固定的八態（`backlog` `todo` `queued` `in_progress` `review` `blocked` `done` `cancelled`）另有一個具體好處：**agent 不需要先查詢「這個專案有哪些狀態」才能操作**，可設定的 Status 會直接讓每次互動多一次來回。

`archived` 原本是第九個狀態，後來拆成獨立的 boolean 欄位。理由是模型上的，不是偏好：歸檔表達的是**可見性**，`done` / `cancelled` 表達的是**工作結果**，兩者正交。若 archived 是 Status，一張 done 的 Issue 歸檔後，「它究竟是完成還是取消」的資訊將永久消失，且取消歸檔時無法得知該還原成哪個狀態。

## Consequences

`blocked` 有同樣的正交性問題（一張 Issue 可以「進行中但卡住」），但仍留在 Status 內 —— 因為它遺失的資訊（卡住前在做什麼）可以由 Comment 補上，而 `archived` 遺失的資訊沒有任何東西能補。代價是一條必須寫進文件的規則：**設為 `blocked` 時必須同時留下 Comment 說明原因**。

有些團隊會想要 `in_review` 之外的自訂狀態。標準答案是用 Label 表達。**拒絕這個需求本身就是產品定位。**
