# 03 protocol-relative URL 擋掉

nook ref：`01M233WYNDT42T3N3B0HTG4AJ5`

## Outcome

`isSafeUrl` 的 `if (scheme === null) return true;` 讓 `//evil.com` 這種
protocol-relative URL 通過白名單，變成一個指向外部網站的連結。

v1 當初的判斷是「在**唯讀的 localhost 檢視器**上這是導覽困擾而非 XSS 路徑」。
那個判斷本身沒錯（它確實不是 XSS），但 **ADR-0007 之後 studio 不再是唯讀
檢視器** —— issue 內容可能是從外部 repo pull 來的，而讀者現在會在同一個
頁面上做寫入操作，被騙走的代價比唯讀時期大。

決定：**擋掉。**

## Acceptance criteria

- [ ] 無 scheme 但以 `//` 開頭的 URL 視為不安全，退回純文字
      （與圖片、`javascript:` 的處理一致）
- [ ] **不得誤傷相對路徑（`/i/01JBX7`）與錨點（`#section`）** ——
      既有測試已涵蓋這兩者，它們必須維持綠
- [ ] 紅燈測試：`[a](//evil.com)` 現在會成為連結，修完之後不會
- [ ] 一併考慮控制字元繞法：`isSafeUrl` 開頭已經先把控制字元與空白剝掉，
      所以夾雜這些字元的變體也要確認擋得住
- [ ] **不得改動 markdown renderer 的其他任何行為。** 這個模組的
      「先逸出、再構造」安全模型是這個 repo 最好的一段設計，四條安全性質
      （raw HTML 不通過、scheme 白名單、圖片與不安全 URL 退回純文字、
      code span 不再解析）在報告裡要逐條確認仍然成立

## Test seam

`test/render/html.test.ts` 既有的 URL 白名單測試就在那裡，照它的形狀加。

## Write ownership

- `src/render/html.ts`
- `test/render/html.test.ts`

**不得碰**任何其他檔案。特別是 `src/server/handler.ts`（它 import
`escapeHtml`，但你不該需要動它）。

## Blocked by

無。

## Status

queued
