# A11 —— 雙軸審查的發現（A2–A5 那一批）

**批次**：A ｜ **阻擋**：A8（`Column.tsx` 的寫入所有權）｜ 由審查產生的票，不是原始規劃的一部分

## 目標

Standards 與 Spec 兩軸對 A2／A7／A4／A3／A5 的發現，一次修完。**有行為改動的
要寫紅綠燈**；純措辭的不必。

## 1. 拖曳鎖活得比它的對象久（行為，要紅綠燈）

`reconcile.ts` 的 ACK 移除一張正被抓著的 Issue 時，`state.drag` 還指著那個已經
不在快照裡的 id。於是 `POLL` 會一直被押後（`if (state.drag !== null)`），等一個
「已經沒有卡片可放」的 RELEASE。實務上 dnd-kit 會在卡片 unmount 時送 cancel，
所以會自行解開 —— **但 reducer 沒有保證它，而 reducer 是有測試的那一層。**

紅燈：ACK 帶 `deleted: true` 移除的正是 `drag.issueId` 指著的那張時，
`state.drag` 必須變成 `null`，而後續的 `POLL` 不再被押後。
移除的是**別張**時，`drag` 不動。

## 2. `ReconcileChange` 少一個 `deleted`（型別，A9 依賴它）

`Change` 已經有 `deleted`，`ReconcileChange` 沒有 —— 於是 drawer 的刪除按鈕
沒有樂觀路徑可走。**這是規劃時漏的接縫**，補上一個選用欄位即可。
A9 正在平行進行且不得碰 `reconcile.ts`，所以由這張票補。

## 3. `nook rm` 對已刪的 Issue 先問確認才失敗（行為，要紅綠燈）

`board.get` 成功 → 問「刪除 X？(y/N)」→ `board.apply` 才丟 `IssueDeleted`。
等於為一次**不可能落地的寫入**要求確認。

在問之前先讀 `.deleted`，直接說「已被刪除」並 exit 1。**這是讀取側的呈現判斷，
與 `cmdShow` 已經在做的同一類 —— 寫入安全那個決定點仍然只有 `board.apply` 一個，
不得在 CLI 裡再放一份。**

紅燈：非 TTY 且無 `--yes` 對一張**已刪**的 Issue 跑 `rm`，訊息要說「已被刪除」，
而不是現在那句要人加 `--yes`。

## 4. `confirmed()` 把兩個條件併成一句只講一半的話（行為，要紅綠燈）

```ts
if (!io.isTty || io.readLine === undefined) throw new UsageError('rm 預設要互動確認；非 TTY 請加 --yes');
```

一個**是** TTY 但沒有 `readLine` 的 `Io` 會被告知它不是 TTY。兩個條件各自一句。

## 5. `Io.readLine?()` 的註解講了錯誤的理由（措辭）

它寫「可選的，因為它只有一個呼叫端」。真正的理由是：`test/agent-doc.test.ts`
那個手工 `Io` literal 在接縫外，少了選用就編不過。照實寫。

## 6. `Atomics.wait` 少交代機制（措辭）

註解說明了被否決的替代方案（忙等會燒滿一顆核心），但沒說**為什麼這行是 sleep**：
`idle[0]` 永遠等於期望值、沒有任何地方會 `Atomics.notify`，所以它必然逾時返回。
那是非顯而易見的那一半。順帶把 `POLL_MS` 移到它唯一的使用點之前。

## 7. `cmdShow` 手抄了 `IssueDeleted` 已經擁有的字串（措辭／小重構）

`issue 已被刪除：${ref}` 在兩個地方各有一份。

## 8. `createIssue` 裡同一句 `badRequest` 出現兩次（小重構）

`handler.ts` 的 `createIssue` 內部重複 `badRequest('body 必須是一份 JSON 物件')`。
**不要**把 `createIssue` 與 `parseChange` 合併成一個共用解析器 —— spec 刻意讓
create 的形狀與 `Change` 的形狀分開（前者收 `status` 拒 `description`，後者相反）。
只消掉檔案內那一句的重複。

## 9. `TARGET_STYLE` 是一個沒有主人的字串聯集（小重構）

A7 把 `dropEffect` 整個刪掉之後，`Column.tsx` 的 `'stay' | 'move'` 沒有任何函式
擁有它。塌成布林。

**不要**把 `dropEffect` 加回來：`from === to` 不是領域規則，是一次相等比較，
為它命名是儀式。**但 ADR-0010 要改** —— 它現在寫著 `dropEffect` 收斂成兩值，
而實際上是整個刪掉。ADR 不能繼續寫著程式碼沒做的事。照實改寫並說明理由。

## 10. 詞彙政策只套用了一半（措辭）

CONTEXT.md 的 `Issue` 條目 `_Avoid_: task, ticket, card, story, 票`。這一批新增的
散文違反了它：

- `src/server/handler.ts` 的路由註解「在票 01 就沒了」
- `src/server/handler.ts` 的 `createIssue`「一張沒有標題的**卡片**」
- `test/server/handler.test.ts` 的「票 A4」

（`docs/adr/0009` 那一處已經在 `cf9418f` 修過，這裡是把同一條政策套完。）

## 寫入所有權

```
src/studio/reconcile.ts
test/studio/reconcile.test.ts
src/cli/run.ts
test/cli/run.test.ts
src/server/handler.ts
test/server/handler.test.ts
src/studio/board/Column.tsx
docs/adr/0010-board-adds-no-meaning-to-statuses.md
```

## 驗證

```bash
npx vitest run test/studio test/cli test/server
npm run typecheck && npm test && npm run build
```
