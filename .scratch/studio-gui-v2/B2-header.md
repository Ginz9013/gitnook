# B2 —— header：logo、board 路徑、分支、actor，以及右側的四個動作

**批次**：B ｜ **阻擋**：B1（`/api/board-info`）、A6（ThemeToggle）、A8（新增入口）
**本片段無自動化測試**

## 目標

現在整條 header 只有「N 張 Issue」跟一顆「顯示已封存」（`Board.tsx:160`）。

## 介面

從 `Board.tsx` 抽出 `src/studio/board/BoardHeader.tsx` —— 之後 B4（健康警示）與
B5（篩選）都要往上加東西，而 `Board.tsx` 已經同時是 DndContext 的持有者。

```tsx
export interface BoardHeaderProps {
  readonly info: BoardInfo | null;          // 還沒抓到就是 null，不要卡住整個看板
  readonly visibleCount: number;
  readonly archivedCount: number;
  readonly showArchived: boolean;
  readonly onToggleArchived: () => void;
  readonly onNew: () => void;
}
```

## 內容

**左：** logo 佔位（一個方塊，日後換成真的圖）＋「**Git Nook**」文字 logo。
接著一行低調的 mono 小字：board 路徑 · 分支 · actor。
路徑太長時從**中間**截（`/Users/…/issue-tracker/.issues`）—— 從尾端截會把
「這是哪個 repo」這個唯一有用的部分切掉。

**右：** 新增（A8）· 篩選（B5 接上）· 顯示已封存 · 主題切換（A6 的
`ThemeToggle` **從右上角固定位置搬進這裡**）。

**不放**：連線狀態。它現在是「出事才講話」的底部橫幅（`App.tsx` 的 `StatusBanner`），
常駐在 header 上等於一個永遠綠燈的號誌，沒人會看。

## 無障礙

- header 是 `<header>`，不要再包一層 landmark —— `Board.tsx` 的 `<main>` 已經有
  `aria-label="Nook 看板"`，那條退路（`focus.ts`）不能被打斷。
- actor 那格要有可及的說明：它不是「負責人」（Nook 沒有負責人的概念，見 CONTEXT.md），
  是「你寫的 op 記在誰身上」。`title` 屬性不夠 —— 用 `aria-label` 講清楚。

## 寫入所有權

```
src/studio/board/BoardHeader.tsx    （新）
src/studio/board/Board.tsx
src/studio/api.ts                   （fetchBoardInfo）
src/studio/App.tsx
src/studio/main.tsx                 （把 ThemeToggle 從固定位置拿掉）
```
