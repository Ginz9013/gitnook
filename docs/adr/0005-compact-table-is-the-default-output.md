# 預設輸出是緊湊表格，`--json` 僅供程式化串接

反射動作是「給 agent 用就輸出 JSON」。量過之後發現相反：

```
{"id":"01JBX7A9Q3","title":"Fix login redirect","status":"queued","labels":["bug"]}   83 bytes
01JBX7  queued  Fix login redirect  [bug]                                            41 bytes
```

同樣的資訊，緊湊表格是 JSON 的一半，而 LLM 解析它毫無困難。JSON 的結構字元對 agent 而言幾乎是純粹的浪費。因此**人與 agent 共用同一個預設輸出**，agent 的說明文件教的是預設格式而非 `--json`；`--json` 保留給真正需要程式化剖析的串接場景。

Agent 的 token 成本被當作與體積、冷啟同級的硬指標，以一個固定情境（40 張 Issue：列出看板 → 讀一張 → 改狀態 → 留言，量測說明文件與全部輸出的總 byte 數）設下上限並納入 CI。

上限經過一次重新校準。最初的 4KB 是規劃階段憑空訂的，而情境量測的是一個現實中不會出現的最有利形狀：每張 Issue 一個不同的 6 碼短 ID。ULID 的前 10 碼編的是時間高位，**前 6 碼每 17.5 分鐘才變一次** —— 從別的 tracker 批次匯入時，40 張 Issue 會落在同一毫秒，短 ID 被推到 13 碼。改用真實形狀量測後，同一份程式碼是 4030B 而非 3710B。程式碼沒有變差，是量測變準了。上限因此定為 **4.5KB（約 1150 tokens）**，留約 14% 餘裕使它是迴歸偵測器而非誤觸的絆線；情境維持最壞的真實情況。

## Consequences

用 byte 數而非真正的 tokenizer：`tiktoken` 是 WASM、`gpt-tokenizer` 是數 MB 的 devDependency，而且不同模型的 tokenizer 不同，量到的絕對數字沒有意義。byte 數是確定性、零依賴的，作為**回歸閘門**完全夠用 —— 要防的是某次改動讓輸出暴增，而不是精確預測帳單。

該上限綁定「40 張 Issue」這個前提，因為輸出會隨 Issue 數線性成長。同樣的考量下，`list` 預設隱藏 archived、`done` 與 `cancelled` 的 Issue。
