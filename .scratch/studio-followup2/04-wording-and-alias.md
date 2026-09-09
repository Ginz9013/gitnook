# 04 用詞一致性，以及 `STATUSES` 這個純轉手別名

nook ref：`01M22W0PAXB0Z02NCYC8QMPR2R` ＋ `01M22W0PC1TQ1PQY31VSAZPGHP`

> 兩張 nook issue 合併：都只碰註解／命名層，且都要動 `board/dnd.ts`。

## Outcome

Standards 軸的兩條判斷題。

## 缺陷一：同一個版面概念有兩個詞

票 04（前一批）改名時，`Card.tsx` 與 `dnd.ts` 把「卡片」改成新造的「方框」
（「整個方框都是拖曳把手」），但 `focus.ts` 與 `Board.tsx` 對同一個東西仍寫
「卡片」。

CONTEXT.md 禁的是**拿 card 當 Issue 的名字**，不是禁止描述畫面上那個方框
—— 那一批自己也承認了，因為 `Card` 這個組件名留著。

- [ ] 統一用「卡片」。組件名本來就叫 `Card`，而詞彙表沒有要求改掉版面用語
- [ ] 但**指涉 Issue 本身**的地方仍然要說 Issue，不要因為統一用詞而倒退

## 缺陷二：`STATUSES` 是純轉手

```ts
// drawer/changes.ts
export const STATUSES: readonly Status[] = STATUS_ORDER;
```

純粹轉手，而且把 tuple 放寬成 `readonly Status[]`。理由是 `StatusPicker`
從這個模組 import，但它大可直接從 `@/statuses` import `STATUS_ORDER`。

留著等於那份「只該有一份」的清單又多了一個名字 —— 而統一那份清單正是
前一批票 04 存在的理由。

- [ ] 移除這個別名，`StatusPicker` 直接用 `STATUS_ORDER`
- [ ] 確認沒有別處還在 import 它

## 缺陷三：一句只複述程式碼的註解

`dnd.ts` 的「欄位在畫面上的順序就是 `STATUS_LANES` 的順序」只是複述它下面
那行 `.map`。這個 repo 的註解標準是解釋**為什麼**、以及不這樣做會壞掉什麼。

- [ ] 改成有內容的，或刪掉

## Test seam

**本片段無自動化測試** —— 這一次這句話是準確的：它是註解與一個別名的移除，
沒有任何純邏輯改變。既有的測試（含另一位 worker 這一輪新增的
`test/studio/board.test.ts`）就是迴歸網。

## Write ownership

- `src/studio/board/Card.tsx` `src/studio/board/dnd.ts`
  `src/studio/board/focus.ts` `src/studio/board/Board.tsx`
- `src/studio/drawer/changes.ts`
- `src/studio/drawer/StatusPicker.tsx`

**不得碰**：`src/studio/board/lanes.ts` 與 `board/announce.ts`
（另一位 worker 這一輪正在為它們寫測試）、`src/studio/statuses.ts`、
`src/studio/reconcile.ts`、`src/studio/poll.ts`、`src/studio/api.ts`、
`src/studio/App.tsx`、`test/**`。

## Blocked by

無。

## Status

queued
