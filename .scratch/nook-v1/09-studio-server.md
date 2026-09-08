# 09 `studio` server（127.0.0.1 + 輪詢重載）

## Outcome

一個 localhost HTTP server 供開會投影。純請求處理器與 http 外殼分離，讓路由與回應可在不綁 port 的情況下測試。

## Acceptance criteria

**純處理器（`handleRequest`）**

- [ ] `GET /` 回傳看板 HTML，200
- [ ] `GET /i/<ref>` 回傳詳情 HTML；ref 接受無歧義前綴
- [ ] `GET /hash` 回傳當前 board 狀態的雜湊，200，`text/plain`
- [ ] 未知路徑回傳 404
- [ ] 不存在的 ref 回傳 404 而非 500
- [ ] **無任何寫入路徑** —— `POST` / `PUT` / `DELETE` 一律 405

**http 外殼（`serve`）**

- [ ] **只綁 `127.0.0.1`**，不接受 `--host`。以測試證明 server 不在其他介面上監聽
- [ ] port 預設值可用 `--port` 覆寫；port 被佔用時給出清楚錯誤而非堆疊追蹤
- [ ] 回傳 `{ url, close }`，`close()` 能乾淨關閉

**輪詢重載**

- [ ] 頁面內嵌約 20 行 JS，每 2 秒 `fetch('/hash')`，值改變即 `location.reload()`
- [ ] 該腳本是頁面上**唯一**的 JS
- [ ] 以測試證明「board 變更 → `/hash` 回傳值改變」

## Test seam

`handleRequest(board, req)` 純函數，直接單元測試，不綁 port。`serve()` 的整合測試綁定 port 0 取得隨機 port。

## Write ownership

- `src/server/handler.ts`
- `src/server/serve.ts`
- `test/server/handler.test.ts`
- `test/server/serve.test.ts`

## Shared resources

**Port。** 整合測試一律綁 port 0（由 OS 指派）以免與其他票或使用者的服務衝突。不得硬編碼 port。

## Blocked by

08

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
