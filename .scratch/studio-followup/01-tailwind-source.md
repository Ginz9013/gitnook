# 01 Tailwind 不再掃文件，散文不得漏進出貨的 CSS

nook ref：`01M22PB08HE4TTRWW5AXK7E6NT`

## Outcome

Tailwind v4 的自動來源偵測會掃 `README.md` 與 `AGENT.md`，把散文裡的英文字
當成 class 名收割。實測：`.grow{flex-grow:1}` 是從散文的 "grow" 來的，
`studio.css` 因此從 33,609 B 變成 33,627 B。每一個使用者都會下載那條死規則。

今天很小，但**原則上沒有上界**：文件寫得越多，漏進去的越多。

## Acceptance criteria

- [ ] 明確限制掃描範圍到 `src/studio`（`@source` 指令，或 vite 設定）
- [ ] `npx vite build` 之後，`dist/studio/studio.css` **不含** `.grow`
- [ ] 現有畫面的樣式**一條都不能少** —— 限制範圍限過頭會讓看板掉樣式。
      驗證方式：限制前後各 build 一次，比對兩份 CSS 的規則集合，
      差異必須**只有**從文件收割來的那些，並把差異列進報告
- [ ] `studio.css` 的體積不增加

## Test seam

**本片段無自動化測試** —— 這是建置設定。驗收是「build 出來的 CSS 差異」，
用上面說的前後比對做，把實際的規則差異貼進報告。

不要為此新增測試框架或 CSS 快照測試。

## Write ownership

- `src/studio/index.css`
- `vite.config.ts`

**不得碰**：`README.md` `AGENT.md`（限制掃描範圍才是修法，改文件用字不是）、
`src/studio/**` 的其他檔案、`package.json`。

## Blocked by

無。

## Status

queued
