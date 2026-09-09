# 短 ref 用於顯示，完整 ULID 用於交付

`nook new` 印出完整的 26 碼 ULID；`list`、`show` 與看板則印出對**當下 board** 而言最短的無歧義前綴。兩者刻意不同。

原本兩處都印短 ref，契約是「印出的當下無歧義」，並類比 git 的 short hash。**那個類比不成立。** git 的 hash 是全域隨機，衝突要幾百萬個 object 才會發生；ULID 的前 10 碼編的是時間高位，**前 6 碼每 17.5 分鐘才變一次** —— 同一個窗口內建立的 Issue 必然共用前綴。實測：

```
A=$(nook new "Fix login...")   # 印出 01M20V
B=$(nook new "Add dark...")    # 印出 01M20V2SB
nook label $A +bug             # 前綴 01M20V 對應到 3 張 issue
```

第一張 Issue 印出的 ref 在建立第二張的瞬間就失效。對 agent 尤其致命 —— `nook new` 接著 `nook mv <ref>` 是最基本的序列。

## Consequences

**顯示與交付是兩種不同的用途，因此有兩種不同的表示法。**

- **顯示**（`list` / `show` / 看板 / 四個回印路徑）每次都對當下的 board 重算長度。它會隨 board 成長而變長，那沒關係 —— 它只需要在你正在看的這一刻是對的。
- **交付**（`nook new` 的輸出）必須永久有效，所以是完整的 26 碼。成本是一次性的 20 bytes。

推論出來的規則：**任何要被儲存、貼進別處、或跨時間傳遞的 ref，都必須是完整 ULID。** 短 ref 只在它被印出來的那個畫面上成立。

四個回印路徑（`set` / `mv` / `comment` / `label`）原本走 `renderTable([updated])`，單元素陣列讓長度計算直接回下限 6 —— 那是「顯示」的表示法卻算錯了批次。它們現在對整個 board 算長度。

**同源的最後一處已經修掉了（v1 的票 15 ＋ 票 16）。** 當時的洞是：`list` 對**過濾後**的集合算長度（預設隱藏 archived/done/cancelled），所以它印出的 ref 可能被 `show` 判為有歧義 —— 解析是對整塊 Board 做的，長度卻是對一份子集算的。修法正如本 ADR 當初的預測：讓 `Board` 公開一個只列舉、不摺疊的廉價 id 來源，也就是 `board.refs()`（票 15）。現在 `src/cli/run.ts` 的 `displayLength(board)` 就是 `shortIdLength(board.refs())`，是唯一的長度來源，六個渲染呼叫點 —— `list`、`show`，以及 `set` / `mv` / `comment` / `label` 四個回印路徑 —— 全都明確傳入它。連原本因為效能顧慮而沿用下限 6 的 `show` 也付得起了：`refs()` 只列目錄，票 13 的「`show` 只讀它要的那一張」因此不受影響。

**預測與實際的落差值得留下來。** spec 的 Risks 當時（票 12 回報）判斷「要修得把解析用的候選集合傳進渲染層，會改變 `renderTable` 的簽章」。簽章一行都沒有動：渲染層要的從來不是候選集合，而是一個**算好的長度**，而 `renderTable(input, shortIdLen?)` 的第二個參數在票 12 自己就已經存在。錯的不是渲染層的介面，是 CLI 餵給它的那一批資料。真正缺的那塊在 core —— 一個便宜到 `show` 也叫得起的 id 來源。**「渲染層拿到的批次不等於解析用的母體」這一類問題，修的地方在餵資料的那一端，不在渲染層的簽章。**
