# 票 01 — studio 的 markdown 內容套用真正生效的 typography 樣式

nook issue: `01M2H3W2M08D51JP200NEZSQZG`

見 [spec.md](./spec.md) 的背景、目標、non-goals、驗收標準、baseline —— 這裡
只列這張票自己的範圍。

## Write ownership

- `package.json`、`package-lock.json`
- `src/studio/index.css`
- 新檔 `src/studio/drawer/markdownContent.ts`
- `src/studio/drawer/IssueDetail.tsx`
- `src/studio/drawer/CommentTimeline.tsx`

## Blocking edges

無，單張票，board 裡唯一一張。

## 做法方向（交給實作判斷，不預先寫死步驟）

1. `npm install -D @tailwindcss/typography`。
2. 在 `index.css` 註冊外掛，視需要用 `@theme`/prose CSS 變數對齊既有的
   `--foreground`/`--muted-foreground`/`--border` 等 token；確認
   `dark:prose-invert`（或等效寫法）真的吃到 `@custom-variant dark
   (&:is(.dark *))` 這個自訂規則 —— 這是假設，要親眼驗證，不能當作理所當然。
3. 新增 `src/studio/drawer/markdownContent.ts`，匯出 `MARKDOWN_CONTENT_CLASS`。
   內容取代掉兩處目前寫死的
   `"prose-sm text-sm wrap-break-word [&_a]:underline [&_code]:font-mono [&_pre]:overflow-x-auto"`。
   視 prose 外掛的預設輸出效果，決定要不要保留 `[&_a]:underline` 這類手寫
   override —— 如果 prose 已經處理，重複的規則要拿掉，避免兩套模型對同一
   個元素給出不同答案。
4. `IssueDetail.tsx`、`CommentTimeline.tsx` 改成 import 這個常數。
5. 用 `nook studio` 開啟測試票（`01M2H2Q0EHYHYZDSPP7Z0MXWZG`，或等效重造的
   一張），對照 spec.md 的驗收標準 1–7 逐條目視核對，issue description 與
   comment 兩處都要看。
6. 跑驗收標準第 8 點的四個指令，確認全過，且 `bench` 的 `studio assets` 沒
   超過上限。

## Estimate

Bounded，小。
