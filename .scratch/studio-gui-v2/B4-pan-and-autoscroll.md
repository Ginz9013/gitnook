# B4 —— 橫向平移與拖曳自動捲動

**批次**：B ｜ **阻擋**：B3（`Board.tsx` 寫入所有權）
**本片段無自動化測試** —— 指標互動在 node 環境下測不到，而 jsdom 的 mock
容易寫出「測過但實際壞掉」的假綠燈（spec 的測試策略）。

## 目標

**自動捲動是功能缺陷，優先做。** 現在把卡片從 `backlog` 拖到 `cancelled`，
第 5 欄之後就在畫面外，**滑鼠使用者根本到不了**（鍵盤反而可以）。
平移是體感。

## 1. 拖曳自動捲動

`@dnd-kit/core` 的 `DndContext` 內建 `autoScroll`。**先確認它在這個版面上是不是
已經在動** —— 捲動容器是 `Board.tsx` 裡那個 `overflow-x-auto` 的 div，不是 window，
而 dnd-kit 要找得到那個 scrollable ancestor。若沒動，用 `autoScroll` 的設定
（`{ threshold, acceleration }`）而不是自己寫一份捲動迴圈。

**驗收就是那一句話**：滑鼠把一張卡片從最左欄拖進最右欄，全程不放手。

## 2. 抓空白處平移

在欄位之間的空白按住左鍵往旁邊拉，看板跟著走。

**與 `@dnd-kit` 的 PointerSensor 不能打架。** 卡片自己是 draggable，
sensor 的啟動門檻是 4px（`Board.tsx:73`，讓「點一下開細節」與「拖走」分得開）。
平移的 handler 掛在捲動容器上，**必須確認 pointerdown 落在卡片上時不啟動平移** ——
最簡單的判準是 `event.target.closest('[data-issue]')`（卡片已經有這個屬性，
`focus.ts` 靠它找卡片）。

游標要換成 `grabbing`，而且平移中不得觸發卡片的 click（開 drawer）。

## 3. 不做

`shift + 滾輪` —— 瀏覽器對水平捲動容器本來就給這個行為，不必寫。

## 寫入所有權

```
src/studio/board/Board.tsx
```

## 驗證

```bash
npm run typecheck && npm test && npm run build
npm run nook -- studio    # 人工：拖過八欄不放手；空白處平移；平移後點卡片不會誤開 drawer
```
