# A5 —— reconcile：`CREATED` 進快照、`deleted` 的 ACK 離開快照

**批次**：A ｜ **阻擋**：無（`reconcile.ts` 自己宣告結構型別，不 import server）

## 目標

調和模型多兩條規則。**兩條都是純函式，兩條都要有測試。**

## 介面

```ts
export interface ReconcileIssue { /* …既有 */ readonly deleted: boolean; }

export type ClientAction<I> =
  | …既有七種
  | { readonly type: 'CREATED'; readonly issue: I };
```

## 規則一：`CREATED` —— 新增不做樂觀更新

新 Issue 的 ULID 由 server 產生，client 沒有 id 可以先畫；而 loopback 上一次
全量摺疊是 14ms（ADR-0002 實測）。發明一個暫時 id 再回頭認領，買到的是十幾
毫秒，付的是調和模型上第二種「這張還不存在」的狀態 —— 不划算。

`CREATED` 只做一件事：把 server 回來的那張**接進快照尾端**。

## 規則二：`ACK` 收到 `deleted: true` → 從快照移除

現行的 ACK 是「用回應覆蓋那一格」。照做會留下一張已刪但仍在畫面上的卡片。

## 先寫紅燈

1. `CREATED` 之後 `project()` 含那張。
2. `CREATED` 的 id 已經在快照裡時**不重複加**（輪詢先一步帶回來了）。
3. **拖曳中的 `CREATED` 不被押後** —— 押後的是 `POLL`（規則三保護的是「手指
   按著的那張不被伺服器抽走」），而新增與被抓著的那張無關。
4. `ACK` 帶回 `deleted: true` → 那張離開快照，且它的 pending 一併結清。
5. `ACK` 帶回 `deleted: true` 但那張正被抓著（`held`）→ **仍然移除**。
   使用者刪的就是它，留著一張抓不放的幽靈卡片更糟。
6. `ACK` 帶回 `deleted: false`（復原）→ 照常蓋回那一格。
7. 已有的四條規則**全部維持綠**（回歸）。

## 綠燈

`reconcile.ts` 的 `clientReduce` 加一個 case、`ACK` 加一條前置判斷。
**不要動 `project()`** —— 移除發生在快照上，投影不必知道有這回事。

## 寫入所有權

```
src/studio/reconcile.ts
test/studio/reconcile.test.ts
```

## 驗證

```bash
npx vitest run test/studio
npm run typecheck
```
