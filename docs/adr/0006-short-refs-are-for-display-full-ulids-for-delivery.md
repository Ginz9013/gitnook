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

同源但尚未修的一處記在 spec 的 Risks：`list` 對**過濾後**的集合算長度（預設隱藏 archived/done/cancelled），所以它印出的 ref 可能被 `show` 判為有歧義。正確的解是讓 `Board` 提供一個只列舉、不摺疊的廉價 id 來源。
