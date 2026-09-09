# A4 —— server：`deleted` 通過寫入面、`POST /api/issues`、410 Gone

**批次**：A ｜ **阻擋**：A2

## 目標

讓 studio 有新增與刪除可用的端點。**刪除不新增任何端點** —— `Change` 多了
`deleted`，既有的 `POST /i/<ref>` 就通了，405 白名單一個字都不動。

## 介面

```
POST /i/<ref>       body: Change（現在含 deleted）  → 200 + IssueView
POST /api/issues    body: { title, status? }       → 201 + IssueView     ← 新
```

```ts
export interface IssueView { /* …既有 */ readonly deleted: boolean; }
```

`IssueView` 加 `deleted`：client 收到 `deleted: true` 的 ACK 才知道要把它從
快照上拿掉（票 A5）。

錯誤對應，延伸既有那張表：

| 情況 | 回應 |
|---|---|
| `IssueDeleted` | **410 Gone** |
| `POST /api/issues` 缺 title、title 不是字串、或 trim 後是空字串 | 400 |
| `POST /api/issues` 的 `status` 不是合法 Status（`InvalidStatus`） | 400 |
| `POST /api/issues` 帶了 `title` / `status` 以外的鍵 | 400（沿用「不認得的欄位一律拒絕」） |

**為什麼收 `status`**：看板的欄頂會各有一個 `+`（票 A8），而那個 `+` 唯一比
CLI 好的地方就是「按哪一欄就開在哪一欄」。一個「按了 `review` 欄的 `+`、東西
卻掉進 `backlog`」的按鈕比沒有按鈕糟。`board.create()` 本來就收 `status`，
所以這裡不是新增能力，是不要在端點上把它擋掉。**`description` 與 `labels`
刻意不收** —— 表單只填標題（D15），端點不該提供沒有呼叫端的東西。

## 先寫紅燈

1. `POST /i/<ref>` body `{"deleted":true}` → 200，回傳的 `IssueView.deleted === true`。
2. 對已刪的 Issue 再 `POST /i/<ref>` `{"comment":"x"}` → **410**，內文可讀。
3. `POST /i/<ref>` `{"deleted":false}` 對已刪的 → 200，`deleted === false`。
4. `POST /i/<ref>` `{"deleted":"true"}`（字串）→ 400（`CHANGE_SHAPE` 逐欄驗證）。
5. `POST /api/issues` `{"title":"x"}` → **201**，body 是 `IssueView`，
   而且**接下來的 `GET /api/board` 含它**。
6. `POST /api/issues` `{}` / `{"title":""}` / `{"title":"  "}` / `{"title":1}` → 400。
7. `POST /api/issues` `{"title":"x","status":"review"}` → 201，且該張的 status 是 `review`。
7b. `POST /api/issues` `{"title":"x","status":"nope"}` → 400（`InvalidStatus`）。
7c. `POST /api/issues` `{"title":"x","description":"d"}` → 400（不認得的欄位一律拒絕）。
8. `GET /api/board` 不含已刪的 Issue（它走 `board.list`，A2 已保證，這裡釘住）。
9. **405 白名單沒有鬆動**：`POST /api/board`、`POST /hash`、`POST /` 仍然 405。
10. `GET /api/issues` → 405（那條路徑只收 POST，`Allow` 標頭要對）。

## 綠燈

- `CHANGE_SHAPE` 加 `deleted: (v) => typeof v === 'boolean'`。
- `toIssueView` 帶上 `deleted`。
- `applyChange` 的 catch 加 `IssueDeleted → 410`。
- `route` 加 `POST /api/issues` 的分支。**注意 405 的判斷順序**：現行是
  `writable = path.startsWith(ISSUE_PREFIX)`，要擴成也認得 `/api/issues`，
  而且**只認完全相等**，不是 `startsWith` —— `/api/issues/foo` 不該變成可寫。

## 寫入所有權

```
src/server/handler.ts
test/server/handler.test.ts
```

## 驗證

```bash
npx vitest run test/server
npm run typecheck
npm test
```
