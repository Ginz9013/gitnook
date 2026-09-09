# B3 —— 欄位折疊：折起來只剩標題，而且照樣收得下卡片

**批次**：B ｜ **阻擋**：B2（`Board.tsx` 寫入所有權）、A6（`prefs.ts` 的 collapsed）
**本片段無自動化測試** —— 可判定的部分（`readCollapsed`／`writeCollapsed`）已在 A6 測過。

## 目標

八欄 × 256px 加間距已經超過多數筆電的寬度。折疊是主要的橫向解法，
B4 的自動捲動是備援。

## 行為

- **橫向折**：欄位收窄成一條約 40px 的直立條，**只留標題與張數，內容不顯示**。
  標題用 `writing-mode: vertical-rl`（`Board.tsx` 原本的 `LaneBoundary` 用過同一招，
  A7 刪掉它時可以把這個手法留下來）。
- **折起來的欄位仍然是合法的 drop target。** 折疊是「我現在不看它」，
  不是「我不能往裡面放」。
- **拖曳中被指向的折疊欄位要暫時展開**，放開之後收回去 —— 否則使用者看不到
  自己放進去的東西掉在哪。
- 每一欄的欄頭一個折疊切換，`aria-expanded` 要對。
- 狀態記在 `localStorage`（A6 的 `readCollapsed`／`writeCollapsed`），
  **預設全展開**，不自作聰明。

## 與鍵盤拖曳的交互 —— 這裡有一個會靜靜壞掉的地方

`dnd.ts` 的 `columnKeyboardCoordinates` 靠 `droppableRects` 找「下一欄的中心」。
折疊之後那一欄的 rect 只有 40px 寬，計算仍然成立（它用的是 `rect.left + rect.width/2`），
**但要實際用鍵盤走過八欄確認**：左右鍵必須照樣一次走一欄，不能跳過折疊的那些。
折疊的欄位跳過去反而是錯的 —— 它收得下卡片，就必須到得了。

## 寫入所有權

```
src/studio/board/Column.tsx
src/studio/board/Board.tsx
```

## 驗證

```bash
npm run typecheck && npm test && npm run build
npm run nook -- studio    # 人工：折疊往返、重新整理後記得、拖進折疊欄、鍵盤走過八欄
```
