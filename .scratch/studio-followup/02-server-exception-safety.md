# 02 未預期的例外不得帶掉整個 process

nook ref：`01M22EFD504XAB6HC0P1CN8AXJ`

## Outcome

`handler.ts` 只把三種例外對應成 HTTP 狀態（`RefNotFound` / `AmbiguousRef` /
`InvalidStatus`），其餘一律往上拋。而 `serve.ts:68` 是在 `createServer` 的
callback 裡呼叫 `handleRequest` 的 —— 那裡的未捕捉例外會直接帶掉整個 process。

例如 session 進行中 board 目錄被移走，下一個請求丟 `BoardNotInitialized`，
studio 就死了。

studio 還是唯讀投影用檢視器時這無關痛癢；ADR-0007 把它變成人的主要操作介面
之後，代價變成「使用者正在用的看板整個消失」。

## Acceptance criteria

- [ ] 未預期的例外回 500，**process 存活**
- [ ] 有測試證明：讓 board 在 server 起來之後失效（移走目錄），再打一個請求，
      斷言拿到 5xx **而且 server 還活著**（後續請求仍有回應）——
      只斷言狀態碼不算，process 有沒有死才是這張票的重點
- [ ] 500 的內文不得外洩堆疊追蹤
- [ ] `handleRequest` 的**純函數性質不得破壞**（不接觸 `node:http`）
- [ ] 既有的錯誤對應一條都不變：`RefNotFound`/`AmbiguousRef` → 404、
      `InvalidStatus` → 400、非法 body → 400、方法白名單 → 405

## 形狀是這張票要決定的事

兩個選項，各有代價，**選一個並在註解裡寫明理由**：

- 在 `handler.ts` 加一層 500 兜底 —— 引入新的回應詞彙，但錯誤對應集中在一處
- 在 `serve.ts` 的 callback 外圍接住 —— 不動 handler 的純函數性質，
  但錯誤對應散成兩處

`readBody(req).then(...)` 的 rejection 路徑也要一併涵蓋，別只包同步那半。

## Test seam

`handleRequest(board, req)` 純函數 + mkdtemp 的真實 board（ADR-0004）；
process 存活那條需要 `serve()` 的整合測試，綁 port 0。

## Write ownership

- `src/server/serve.ts`
- `src/server/handler.ts`
- `test/server/serve.test.ts`
- `test/server/handler.test.ts`

**不得碰**：`src/core/**`、`src/studio/**`、`src/render/**`。

## Blocked by

無。

## Status

queued
