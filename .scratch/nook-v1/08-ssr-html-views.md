# 08 SSR 看板與詳情頁

## Outcome

`renderBoardHtml(issues)` 與 `renderIssueHtml(issue)` 產生完整的 HTML 字串。零框架、零 bundler、零 build step。

## Acceptance criteria

- [ ] 看板呈現 **8 欄**（`backlog` `todo` `queued` `in_progress` `review` `blocked` `done` `cancelled`），橫向捲動
- [ ] 欄寬讓 8 欄在 1920px 下不需捲動即可完整顯示（每欄約 240px）
- [ ] 卡片顯示短 ID、title、labels
- [ ] `archived` 的票預設不顯示
- [ ] 詳情頁顯示 title、status、labels、description（markdown 渲染）、comments 時間軸
- [ ] **markdown 渲染關閉 raw HTML** —— 從外部 repo pull 來的惡意 issue 內容不得注入腳本（localhost 頁面與 JSON API 同源，這是真實的 XSS→API 路徑）
- [ ] 針對含 `<script>`、`<img onerror=>`、`javascript:` URL 的 description 有明確的逸出測試
- [ ] 支援 heading、巢狀 list、bold/italic、inline code、fenced code block、link、blockquote
- [ ] **不**支援圖片與 raw HTML
- [ ] CSS 內嵌，無外部請求
- [ ] golden file 測試涵蓋看板與詳情兩個檢視

## Test seam

純函數，直接單元測試。輸入是 `Issue[]` 字面值。

## Write ownership

- `src/render/html.ts`
- `test/render/html.test.ts`
- `test/render/__golden__/`（與票 07 共用目錄但檔名不重疊）

## Shared resources

None

## Blocked by

01

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
