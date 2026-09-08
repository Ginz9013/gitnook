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
- `src/render/html.ts` — **僅限**把簽章放寬為 `renderBoardHtml(issues, opts?: { inlineScript?: string })`，以及在 `page()` 中輸出該腳本。**不得**變更既有的渲染邏輯、CSS 或逸出行為
- `test/render/html.test.ts` — **僅限**為上述新參數新增測試。不得修改既有的 35 個測試
- `test/render/__golden__/html-board.html` — 若新參數在未傳入時改變了輸出，那就是 bug；golden 只在確認過差異合理時才更新

## 票 08 已建立的契約（不可違反）

- 卡片連到 `/i/<6 碼短 ID>`，詳情頁連回 `/`。**`/i/<ref>` 必須接受 6 字元前綴。**
- 頁面目前零 JS。輪詢腳本必須是頁面上**唯一**的 JS。

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
