# 04 `src/render/html.ts` 拆分：只留 markdown renderer

nook ref：`01M224RJ3V7CYJQH1P4HTQ5XEB`

## Outcome

看板與詳情頁的 HTML 渲染由 React 接手（票 01/06/07），但 markdown renderer
**留在 server**。它的「先逸出、再構造」安全模型是這個 repo 裡最好的一段設計，
在 React 裡重寫是降級（ADR-0008）。

## Acceptance criteria

- [ ] `renderMarkdown(src: string): string` 是 `html.ts` 的公開匯出
      —— **票 01 已經改成 `export` 了**，這一條現在只是確認它還在、簽章沒變
- [ ] 移除 `renderBoardHtml` `renderIssueHtml` `page` `STYLESHEET` `card`
      `labelList` `commentTimeline` `shortId` `inlineScriptTag` 與 `HtmlOptions`
- [ ] `escapeHtml` 保留（markdown renderer 依賴它）
- [ ] 安全性質**逐條保留**，且既有的 markdown 測試不得修改：
  - [ ] raw HTML 天生無法通過（先逸出、再構造，非黑名單）
  - [ ] URL 白名單只放行 http/https/mailto，無 scheme 者放行
  - [ ] 圖片與不安全 URL 退回純文字
  - [ ] code span 內部不再解析
- [ ] `test/render/html.test.ts` 的 8 個 markdown 專屬 describe **原封不動存活**：
      區塊語法、行內語法、list、link、blockquote、fenced code、raw HTML 關閉、
      以及 description markdown 相關者
- [ ] 移除看板／詳情渲染對應的測試與 golden 檔
      （`__golden__/html-board.html`、`__golden__/html-issue.html`）
- [ ] `npx tsc --noEmit` 乾淨 —— 沒有任何地方還在 import 被移除的東西

## Test seam

既有的 `test/render/html.test.ts`。這張票是**減法**：markdown 那半原封不動，
其餘刪除。刪完全套測試仍須綠。

## Write ownership

- `src/render/html.ts`
- `test/render/html.test.ts`
- `test/render/__golden__/html-board.html`（刪除）
- `test/render/__golden__/html-issue.html`（刪除）

**不得碰**：`src/server/handler.ts`（票 03 同批 —— 它已經不再 import 被刪的東西，
若發現仍有 import，回報 blocked，不要自己改）、`src/render/table.ts`、
`src/render/width.ts`、`__golden__/` 底下其他檔案。

## Shared resources

`test/render/__golden__/` —— 本批次只有這張票會動它。

## Blocked by

票 01（它先讓 `handler.ts` 不再使用看板渲染）。

## Status

queued
