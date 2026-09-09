# B9 —— `create` op 折成 title 寫入的規則要只有一份

**批次**：B（追加）｜ **阻擋**：B7（它發現的）｜ **來源**：B7 的驗收

## 問題

A12（`df7c80e`）修好了 CLI：`create` op 就是對 `title` 的第一次寫入，`nook history`
因此列得出它。B1（`5786eb3`）**落在那之後**，卻沒有把那個修正帶過去 ——
`/api/history/<ref>` 仍然只濾 `op.op === 'set'`。

B7 實測的對照：

```
$ nook history 01M23SC0K                        # CLI
1  83a1  title  從沒改過的那一張
$ curl /api/history/01M23SC0KVYJT2X6EKYRFEPDK4  # server
{"writes":[]}
```

後果：studio 的變更歷史面板對一張沒改過的 Issue 說「欄位還沒有被改過」，
而且**每一張 Issue 的原始標題都不在面板裡** —— 那正是誤刪之後最先要找的那一列，
也是刪除確認框指著這條救生索時承諾的東西。

## 這張票的重點不是「把修正抄過去」

`asWrite` 現在住在 `src/cli/run.ts` 裡。把它複製一份到 `handler.ts`，就是**第三份**
會漂開的實作 —— 而這正是這個 repo 一路在避免的事（`reduce.ts` 的 `orderOps`
註解：「這是全序在整個 repo 的唯一一份」；`statuses.ts` 的兩道編譯期守衛；
票 01M22PKRV「studio 的領域語彙與重複的 Status 清單」）。

**把那個摺疊放進 core，讓 CLI 與 server 用同一份。**

## 介面

```ts
// src/core/ops.ts（或 reduce.ts —— 由實作者判斷哪一邊是它的家，並在票面回報理由）
/**
 * 一個 Issue 的 op-log 裡，對 LWW 欄位的每一次寫入。
 *
 * `create` op 帶的 title 就是 title 的第一次寫入，所以它折成一筆 SetOp ——
 * 不折的話「這個欄位從沒被寫過」會是一句假話，而問的人正在找一份被蓋掉的舊值。
 */
export function fieldWrites(ops: readonly Op[], field?: SetKey): readonly SetOp[];
```

順序沿用傳進來的順序（呼叫端給的是 `board.opLog()`，那已經是 `orderOps` 的全序）
—— **不得在這裡排序**。

## 呼叫端

- `src/cli/run.ts` 的 `cmdHistory`：刪掉本地的 `asWrite`，改用 `fieldWrites`。
  **輸出必須逐字不變**（A12 的測試會證明）。
- `src/server/handler.ts` 的 `issueHistory`：改用 `fieldWrites`。

## 先寫紅燈

1. **server**：一張只被 `create` 過的 Issue，`GET /api/history/<ref>` 的 `writes`
   含那筆 title，不是空陣列。**這是這張票的核心紅燈。**
2. **server**：一張 create 之後又改過標題的 Issue，`writes` 的第一筆是 create 那次
   （`t` 較小），第二筆才是改寫。
3. **server**：`GET /api/history/<ref>` 對已刪的 Issue 仍然 200，且含 title 與 deleted 兩者。
4. **core**：`fieldWrites` 對 `create` + 兩筆 `set` 回三筆，順序與傳入相同。
5. **core**：`fieldWrites(ops, 'status')` 不含 create 那一筆 —— create 不寫 status。
6. **core**：`fieldWrites` 不排序 —— 傳進一份刻意亂序的陣列，回傳維持那個順序。
   （守住「全序只有一份」：排序是 `orderOps` 的事，不是這裡的。）
7. **CLI 回歸**：A12 留下的那些 history 測試**逐字維持綠**，輸出一個字都不能變。

## 寫入所有權

```
src/core/ops.ts            （或 src/core/reduce.ts）
src/core/types.ts          （若 fieldWrites 需要轉出型別）
src/cli/run.ts
src/server/handler.ts
test/core/*.test.ts
test/cli/run.test.ts
test/server/handler.test.ts
```

## 注意

`src/index.ts` 的公開面：`fieldWrites` **不要**轉出去，除非有 repo 外的呼叫端 ——
那個檔案的檔頭寫著每一個 export 都是永久的相容性債務。CLI 與 server 都在 repo 內，
直接 import `../core/ops.js` 即可（`handler.ts` 已經這樣 import `shortIdLength`）。

## 驗證

```bash
npx vitest run test/core test/cli test/server
npm run typecheck && npm test && npm run build
```
