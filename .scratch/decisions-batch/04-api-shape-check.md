# 04 `BoardSnapshot` 的最小形狀檢查，以及 fetchHash 的理由

nook ref：`01M233A9YP9DEFMA358GRGSKAG` ＋ `01M233AA0MSYDCFXA8VZYJFJ5A`

> 兩張 nook issue 合併：都只碰 `src/studio/api.ts`。

## 缺陷一：`getJson` 的 `as T` 放行形狀不對的 body

解析成功後直接 `as T`，所以合法 JSON 但形狀不對（`{"nope":1}` 當成
`BoardSnapshot`）會被放行，之後在別的地方炸成一個看起來無關的 TypeError。
現有的 `'malformed'` 分類只涵蓋「解不開」。

決定：**手寫一個最小形狀檢查。** 這個 repo 是零 runtime 相依，不能引進
驗證函式庫。

- [ ] 只檢 `BoardSnapshot` 的**頂層**：`issues` 是陣列、`hash` 是字串。
      **不逐張 issue 驗** —— 那是另一個成本層級，而這張票要擋的是
      「打錯 port，另一個 server 回了 JSON」這類場景
- [ ] 不對就丟 `MalformedResponseError`，與「解不開」**同一個分類**
      （呼叫端的正確反應相同，不需要第二種）
- [ ] 有測試，純函式層級

## 缺陷二：fetchHash 產生不了 `malformed`

任何文字都是合法的 `/hash` 回應，所以 `fetchHash` 判定不了「答了但形狀不對」。
錯的 server 在那個 port 上回 200 HTML，要等 `/api/board` 才看得出來。

決定：**接受，不加形狀檢查。** 這一半是純文件。

- [ ] 在 `fetchHash` 的註解寫明理由：延遲最多一個輪詢間隔（2 秒），
      而 `/api/board` 那邊已經會抓到（缺陷一修完之後更確定）；在這裡發明
      「像不像 64 個十六進位字元」的檢查是 ADR-0004 警告的那種猜測，
      而且會把一個 server 實作細節釘進 client
- [ ] 讓下一個讀到的人知道**這是想過的，不是漏掉的**

## Acceptance criteria（共同）

- [ ] `postChange` 的行為不變 —— 它的 `!res.ok` 路徑與寫入失敗橫幅不在範圍內
- [ ] `poll.ts` 既有的門檻行為與那三條測試不得改壞

## Test seam

純函式，`environment: 'node'`。React 組件不測。

## Write ownership

- `src/studio/api.ts`
- `src/studio/poll.ts`
- `test/studio/poll.test.ts`

**不得碰**：`src/studio/board/**` `src/studio/drawer/**`（票 01 同批）、
`src/studio/App.tsx`、`src/server/**`、`src/render/**`。

## Blocked by

無。

## Status

queued
