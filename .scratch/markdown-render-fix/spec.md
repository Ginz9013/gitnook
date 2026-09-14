# spec — studio markdown 內容套用真正生效的 typography 樣式

nook issue: `01M2H3W2M08D51JP200NEZSQZG`
branch: `fix/studio-markdown-typography`

## 背景

`src/render/html.ts` 的 `renderMarkdown()` 輸出完全正確 —— 直接呼叫驗證過，
h1-h6、巢狀 blockquote、巢狀 ul/ol、pre/code、連結都正確產生對應的 HTML tag。

問題在前端：`src/studio/drawer/IssueDetail.tsx`（DescriptionField）與
`src/studio/drawer/CommentTimeline.tsx` 兩處注入 `dangerouslySetInnerHTML`
的容器都掛了 `prose-sm` class，但專案沒有安裝 `@tailwindcss/typography`
（package.json / package-lock.json / src/studio/index.css 都確認過），
`prose-sm` 是死 class。加上 Tailwind v4 的 Preflight 會把 `h1`-`h6` 的
font-size/font-weight 重置成 inherit、把 `ul`/`ol` 的 list-style/margin/padding
歸零、把 `blockquote` 的邊距歸零 —— 這正是回報症狀（標題無大小差異、清單無項目
符號、引言無區隔、code 區塊無底色）的成因。`strong`/`em` 沒被 Preflight 動到，
是唯一正常顯示的兩種語法。

## 目標

studio 的 issue drawer description 與留言 body 渲染出來的 h1-h6/blockquote
（含巢狀）/ul/ol（含巢狀）/pre+code/inline code/連結，要有彼此可辨識、與現有
設計 token（light/dark 皆可讀）一致的視覺樣式。

## Non-goals（已在對話中定案排除）

- 不改 `renderMarkdown` 解析邏輯 —— 輸出已驗證正確。
- 不新增表格、刪除線支援 —— 那是另一個未決定是否要做的功能（ADR 管理功能的
  一部分），不在這次修復範圍內。
- 不引入任何 markdown parsing 套件（markdown-it、micromark 等）—— 已評估過
  體積（markdown-it ~43KB gzip / 6 個依賴，micromark+gfm ~22KB gzip / 20+ 個
  依賴）與安全紀錄（markdown-it 今年有一次 ReDoS CVE），維持零依賴決定，繼續
  用手寫的 `renderMarkdown`。
- 不新增自動化視覺測試 —— 專案政策明文：React 組件不寫測試，不得新增
  jsdom/@testing-library/playwright（見 `test/studio/collapse.test.ts` 開頭
  註解，以及票 B3 的先例）。

## ADR 評估

依 `domain-modeling` 的三條門檻（難以撤回 / 沒有脈絡會意外 / 真的有取捨）
重新檢查：裝 `@tailwindcss/typography` 是 build-time only、零 runtime JS，
不碰 CLI 冷啟或 `dependencies` 宣稱，是在 ADR-0008 已拍板的「用生態系裡對的
工具」路線內做完它本來就假設會做的事，不是新的取捨。**不開新 ADR**，只在
程式碼裡留簡短註解交代原因。

## 介面

- 新模組 `src/studio/drawer/markdownContent.ts`：匯出 `MARKDOWN_CONTENT_CLASS`
  常數，取代 `IssueDetail.tsx` 與 `CommentTimeline.tsx` 兩處目前各自寫死的
  重複字串。這是這次唯一新增的公開介面。
- `src/studio/index.css` 註冊 `@tailwindcss/typography` 外掛，視需要用
  `@theme`/prose CSS 變數對齊既有的 `--foreground`/`--muted-foreground`/
  `--border` 等 shadcn token，並確認 `dark:prose-invert`（或等效寫法）能吃到
  自訂的 `@custom-variant dark (&:is(.dark *))`。
- 沒有自動化測試縫 —— 驗收標準改用下面的人工核對清單，靠既有的
  typecheck/vitest/bench 當回歸網。

## 驗收標準（人工在 `nook studio` 核對）

用測試票 `01M2H2Q0EHYHYZDSPP7Z0MXWZG`（涵蓋目前支援的所有語法；如果已被刪除，
用等效內容重造一張）：

1. h1/h2/h3 字級與粗細彼此可辨識，且明顯大於 `text-sm` 的內文。
2. ul/ol（含巢狀）有可見的項目符號/編號與縮排層級。
3. blockquote（含巢狀）有可見的視覺區隔，巢狀引言比外層再退一階。
4. `pre`/`code` 有可辨識的背景框與等寬字體，行內 `code` 與區塊 `pre>code`
   視覺上可分辨。
5. 連結有底線、可點擊，顏色與主題一致。
6. 以上在 light 與 dark 兩個主題下都清楚可讀。
7. `IssueDetail.tsx` 與 `CommentTimeline.tsx` 兩處視覺一致（因為共用同一個
   class 常數）。
8. `npm run typecheck`、`npm test`、`npm run build`、`npm run bench` 全部
   通過，且 `bench` 的 `studio assets` 那行不超過既有上限。

## Baseline（核准當下量測，worker 不該修這些以外的東西）

| 指令 | 結果 |
|---|---|
| `npm run typecheck` | 通過，exit 0 |
| `npx vitest run` | 42 個檔案、766 個測試全過 |
| `npm run build` | CLI `run.js` 79.45KB；`studio.css` 36.43KB（gzip 7.52KB）；`studio.js` 405.17KB（gzip 127.56KB） |
| `npm run bench` | package size 723,490/3,145,728 B；studio assets **441,610/786,432 B（headroom 344,822 B）**；cold start 26.0ms/500ms；cli bundle 0 markers；concurrent merge 0 conflicts；agent token 4102/4608 B |

## Tickets

- [01-fix-studio-markdown-typography.md](./01-fix-studio-markdown-typography.md)

## 執行模式

Sequential，單張票，不需要平行派工。

## Publication

nook issue `01M2H3W2M08D51JP200NEZSQZG`，branch `fix/studio-markdown-typography`。
