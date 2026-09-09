# A7 —— 拆掉車道：`lanes.ts` 整個消失，八個 Status 一視同仁

**批次**：A ｜ **阻擋**：A1（ADR-0010 先落地）

## 目標

看板不替任何 Status 預設解讀（ADR-0010）。**四處全拆** —— 只拆線、留下 Badge
與特別的拖入效果，等於「我們仍然替你決定了 `queued` 是特別的，只是不畫那條線」，
那是最糟的一半。

| 處 | 現況 | 位置 |
|---|---|---|
| 車道線 | 虛線 + 直排文字「人／agent 的交接」 | `Board.tsx:212` `LaneBoundary` |
| 閘門 Badge | `queued` 欄頭常駐「授權閘門」 | `Column.tsx:75` |
| 拖入的特別待遇 | 實心 ring + primary 底色 | `Column.tsx:38` `TARGET_STYLE.authorize` |
| 提示與播報 | 「放開＝授權 agent 不再詢問、直接動手」 | `Column.tsx:44`、`announce.ts:38,50` |

**`queued` 對 agent 的授權語意留著** —— 那是 CLI 與工作流的約定（AGENT.md），
只是看板不再替使用者畫它。

## 介面

刪除：`Lane`、`LANE_OF`、`StatusLane`、`STATUS_LANES`、`DropEffect`、`dropEffect`。
**`lanes.ts` 整個檔案消失。**

存活的兩個函式搬家 —— 它們與車道無關，而 `board/` 底下的東西是看板的財產：

```ts
// src/studio/statuses.ts（STATUS_ORDER 已經在這裡）
export function isStatus(value: unknown): value is Status;
export function groupByStatus<T>(items: readonly T[], statusOf: (item: T) => Status): ReadonlyMap<Status, readonly T[]>;
```

`isStatus` 現在不能再靠 `LANE_OF` 的 `hasOwnProperty` 判斷 —— 改成對
`STATUS_ORDER` 檢查，**並保留既有測試要求的性質**：擋得掉 `Object.prototype`
上的名字、不是字串的東西、以及前綴與大小寫（猜測是 CLI 的事，不是看板的）。

## 先寫紅燈

這是一次**刪除**，紅燈的形狀是「刪掉舊測試 + 移動存活的測試」：

1. `test/studio/board.test.ts` 的 `STATUS_LANES` 與 `dropEffect` 兩個 describe
   **整個刪除**。
2. `isStatus` 與 `groupByStatus` 的既有 describe **原封不動搬到對 `@/statuses`
   的 import**，一條斷言都不改 —— 搬家不該改變行為。
3. `announce.ts` 的「進 queued」describe **刪除**；改成一條新的：
   **停在任何一個 Status 上的措辭都是同一個模板**（只有 Status 名不同）。
   這條斷言正是「看板不替任何 Status 預設解讀」的可執行版本。
4. 其餘 announce 的 describe 全部維持綠。

## 綠燈

- `Board.tsx`：刪 `LaneBoundary`、刪 `Fragment` 與 `opensLane` 的包裝、
  `handleDragEnd` 的 switch 塌成「`to === null || to === drag.status` → `onRelease()`，
  否則 `onMove()`」。改讀 `STATUS_ORDER`。
- `Column.tsx`：`TARGET_STYLE` 只剩 `none` / `move` 兩格（或乾脆塌成一個布林），
  `TARGET_HINT` 整份刪除，閘門 Badge 刪除。
- `announce.ts`：`authorize` 的兩處分支刪除。
- `dnd.ts`：`columnKeyboardCoordinates` 改讀 `STATUS_ORDER`（註解裡「欄位由左到右
  的順序只有一份定義」那條保證不變，只是換了來源）。
- **順手把 `Card.tsx` 的 `held` 從 `ring-primary` 改成 shadow 抬高一階 + 游標**（D14）
  —— ADR-0010 之後主色沒有語意，拿它當反白會稀釋它的意思。
  **`pending` 的虛線邊框不准動**（D13）。

## 驗收

```bash
grep -rn "車道\|授權閘門\|LANE_OF\|STATUS_LANES\|authorize\|opensLane" src/studio/
```
**必須零結果。**（`src/cli/` 與文件裡的授權語意留著，那是工作流的約定。）

## 寫入所有權

```
src/studio/board/lanes.ts       （刪除）
src/studio/statuses.ts
src/studio/board/Board.tsx
src/studio/board/Column.tsx
src/studio/board/Card.tsx
src/studio/board/announce.ts
src/studio/board/dnd.ts
test/studio/board.test.ts
```

## 驗證

```bash
npx vitest run test/studio
npm run typecheck
npm run build
```
