# A12 —— `nook history` 看不到 create op 寫下的標題，而我們剛把它當成刪除的救生索

**批次**：A（追加）｜ **阻擋**：無 ｜ **來源**：A10 的驗收走查

## 問題

```
$ nook new "標題只在 create op 裡"     →  01M23PST…
$ nook rm 01M23PST --yes
$ nook history 01M23PST
2  bf46  deleted  true                  ← history 說的全部

$ cat .issues/issues/01M23PST….ndjson
{"op":"create","title":"標題只在 create op 裡"}   ← 檔案裡真正有的
{"op":"set","k":"deleted","v":true}
```

`cmdHistory` 只留 `op === 'set'`（`run.ts` 的 `.filter(op => op.op === 'set' …)`），
而**標題的第一次寫入住在 `create` op 裡**。於是：

1. **`nook history <ref> title` 對一張從沒改過標題的 Issue 回一份空清單** ——
   等於告訴呼叫端「這個欄位從沒被寫過」，而 `cmdHistory` 自己的註解正是為了
   避免這件事才擋下打錯的欄位名：「打錯欄位名而靜默回一份空清單，等於告訴
   呼叫端『那個欄位從沒被寫過』—— 而他正是在找一份被蓋掉的舊值。」
2. **這一批剛出貨的刪除確認框指著這個指令說「撈得回它寫過的每一個值」**
   （`IssueDetail.tsx`），`nook rm` 的 `deletedMessage` 與 AGENT.md 也同樣措辭。
   在最常見的情況下那句話是假的：刪掉一張 Issue，然後撈不回它叫什麼。

`board.opLog(ref)` 一直都回傳完整的 op-log，包含 `create` —— 資料在，只是
`history` 這一層把它濾掉了。

## 這是修正而不是新功能

`create` op **就是**對 `title` 的第一次寫入。把它算進 `history` 之後，
「`history` 列出每一次對某個欄位的寫入」這句話才第一次成立。

## 介面

`nook history <ref>` 與 `nook history <ref> title` 都要列出 `create` 那一筆，
與 `set` 的那些**排在同一個時間序上**（`opLog` 已經是 `orderOps` 的全序 ——
**不得另寫一份比較器**，`board.ts:113` 的註解說明了理由）。

輸出的欄位與現有的 `set` 那幾行一致：lamport `t`、actor、欄位名、值。
渲染由 `renderSetOps` 負責 —— 決定是「把 create 轉成一筆 title 寫入再交給它」
還是「讓渲染器認得 create」，由實作者選，但**兩種都不得改變既有 `set` 行的輸出**
（`test/render/__golden__/` 與既有斷言會證明）。

## 先寫紅燈

1. `nook new` 之後直接 `history <ref>` → 列得出那次 create 寫下的標題。
2. `history <ref> title` 對一張從沒 `set` 過 title 的 Issue → **不是空的**。
3. `history <ref> title` 對一張 create 之後又改過標題的 Issue → 兩筆都在，
   create 那筆在前（`t` 較小）。
4. `history <ref> status` 不受影響 —— `create` 不寫 status，那份清單不該多出東西。
   （`nook new --status` 會另外產生一筆真的 `set`，那一筆本來就在。）
5. `history <ref> deleted` 對一張被刪的 Issue → 仍然只有那一筆刪除。
6. 既有的 history 測試全部維持綠。

## 一併修掉的措辭

改完之後那三處措辭就是真的了，**不需要改**。實作完成後請確認它們確實成立，
並在報告裡說明：

- `src/cli/run.ts` 的 `deletedMessage`
- `src/studio/drawer/IssueDetail.tsx` 的刪除確認框
- `AGENT.md` 對 `history` 的描述

若其中任何一句在修正之後仍然不精確，**報告出來，不要自己改**——
`IssueDetail.tsx` 與 `AGENT.md` 不在寫入所有權裡。

## 寫入所有權

```
src/cli/run.ts
test/cli/run.test.ts
```

（`renderSetOps` 若必須改，它在 `src/render/table.ts` —— 那時請**停下來回報**，
因為那會動到有 golden 檔的渲染層，是另一張票的範圍。）

## 驗證

```bash
npx vitest run test/cli test/render
npm run typecheck && npm test
```
