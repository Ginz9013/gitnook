# A2 —— core：`deleted` 進入既有的 LWW 機器

**批次**：A ｜ **阻擋**：A1（記錄先於實作）｜ **這是整批的樞紐票**

## 目標

讓刪除成為第五個 LWW 欄位，**不新增任何 op 型別、不新增任何摺疊機器**。

## 介面

```ts
// src/core/ops.ts
export type SetKey = 'title' | 'status' | 'description' | 'archived' | 'deleted';

// src/core/types.ts
export interface Issue { /* …既有 */ readonly deleted: boolean; }
export interface Change { /* …既有 */ readonly deleted?: boolean; }
export class IssueDeleted extends Error { constructor(readonly ref: string) { … } }
```

行為契約，**三條，各自只住在一個地方**：

| 呼叫 | 對一張已刪的 Issue |
|---|---|
| `board.list()`（**含 `all: true`**） | 當它不存在。board 成員資格的唯一決定點。 |
| `board.get(ref)` | **正常回傳**，`deleted: true`。**不拋** —— 呼叫端要說得出「這張已被刪除」。 |
| `board.apply(ref, change)` | 拋 `IssueDeleted`，**除非** `change.deleted === false`。寫入安全的唯一決定點。 |
| `board.opLog(ref)` / `board.refs()` | 照常。 |

`refs()` 仍然列已刪的檔 —— **短 Ref 的長度不能因為有人刪東西而縮短**，
否則既有的短 Ref 會突然變有歧義。

## 先寫紅燈

1. `apply({deleted:true})` 之後 `list({all:true})` 不含它。
2. `apply({deleted:true})` 之後 `get()` 仍回得到，且 `deleted === true`。
3. `apply({deleted:true})` 之後再 `apply({comment:'x'})` → 拋 `IssueDeleted`。
4. `apply({deleted:false})` 對已刪的 Issue **不拋**，而且它回到 `list` 裡。
5. `opLog()` 對已刪的 Issue 仍列得出全部 op（誤刪的救生索）。
6. `refs()` 仍含已刪的 id。
7. **收斂**：`deleted` 的兩筆相反寫入在任意順序、任意重複下摺疊結果相同
   （擴充 `reduce.convergence.test.ts` 既有的模式）。
8. **向前相容**：一份含 `{"op":"set","k":"deleted","v":true}` 的 op-log，
   在 `k` 被當成未知欄位時（模擬舊版）不得崩潰。用既有
   `reduce.malformed.test.ts` 的手法：`{"op":"set","k":"未知","v":1}` 照樣被忽略。
9. `deleted` 的值不是 boolean 時忽略（同 `archived` 既有的守衛）。

## 綠燈

- `reduce.ts` 加一條 `o.k === 'deleted'` 的分支，**與 `archived` 逐字同構**。
- `board.ts`：`apply` 的 `fields` 加 `deleted`；**`IssueDeleted` 的守衛放在
  `resolve(ref)` 之後、任何 append 之前**（沿用「驗證先於任何寫入」的既有慣例）；
  `list` 的 `isVisible` 最前面加 `!i.deleted &&`，**在 `filter.all` 之前**——
  `--all` 也看不到。
- `render/json.ts` 不必改，但它序列化整張 `Issue`，所以**兩個 golden 檔會變**：
  `test/render/__golden__/json-list.json`、`json-detail.json`。照著更新，
  並確認 `table` 那幾份 golden **沒有**變（表格不印 `deleted`）。

## 寫入所有權

```
src/core/ops.ts
src/core/types.ts
src/core/reduce.ts
src/core/board.ts
test/core/*.test.ts
test/render/__golden__/json-list.json
test/render/__golden__/json-detail.json
```

## 驗證

```bash
npx vitest run test/core test/render
npm run typecheck
npm test
```
