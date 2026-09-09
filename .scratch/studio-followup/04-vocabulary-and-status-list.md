# 04 領域語彙，以及被手抄兩份的 Status 清單

nook ref：`01M22PKRV245ENRVFMC5A8YK1A`

## Outcome

Standards 軸的兩條硬違規。**這是大範圍機械改名，依 batching 硬規則單獨一批**，
且刻意排早 —— 後面三張票才能直接用改正後的詞彙。

## 這張票要的判斷，讀完再動手

CONTEXT.md 列 Issue「_Avoid_: card」、Status「_Avoid_: column」。但**不要做
無差別的全域改名** —— 那會讓程式碼變差。分兩半看：

- **視覺容器叫 column 是站得住的。** 看板上真的有八個直排，`Column.tsx`
  渲染的就是那個直排。詞彙表禁的是「用 column 代替 Status 這個概念」，
  不是禁止描述版面。
- **`COLUMNS` 這個常數就是那八個 Status**（`ColumnDef` = 一個 Status
  加兩個顯示旗標）。這是詞彙表正面禁止的用法，該改。

同理，`Card.tsx` 渲染一張 Issue —— 卡片是版面，但 `CardData` 裡裝的是 Issue。
判準是：**這個名字指的是「畫面上的東西」還是「領域裡的東西」？** 前者可留，
後者必改。逐個判斷並在報告裡說明每個決定，不要一次 sed 全換。

規劃時的票面本身通篇寫「八欄」，沒把這條約束轉達下去 —— 這是規劃的疏失，
不是實作的。

## Acceptance criteria

- [ ] 指涉領域概念的 `card` / `column` 命名改掉（至少 `COLUMNS` 與
      `ColumnDef` 這種「其實是 Status 清單」的）
- [ ] 使用者看得見的字串一併檢查（如 `roleDescription: '可拖曳的 Issue 卡片'`、
      `dragInstructions` 裡的「卡片」）
- [ ] 純版面意義的命名可以保留，**但要在報告裡逐個說明為什麼**
- [ ] **八個 Status 的清單在 `src/studio/` 底下只留一份。** 目前
      `board/lanes.ts` 的 `ORDER` 與 `drawer/changes.ts` 的 `STATUS_INDEX`
      是兩份手抄。兩份各有編譯期完整性守衛所以**數量**不會漂，
      但**順序**沒有守衛
- [ ] 保留「不從 `core` 做值的 import」的理由（ADR-0008：那會是第一個從 core
      進 studio bundle 的值 import，而 Vite 不會把 repo 的 `.js` specifier
      重新對應到 `.ts`）。所以是「studio 底下某一個模組擁有這份清單」，
      不是「改成 import STATUSES」
- [ ] 保留現有的編譯期完整性守衛，並讓**順序**也受保護
- [ ] 行為一個字都不變。`npx vitest run` 305 綠、`npx tsc --noEmit` 乾淨、
      `npx vite build` 成功

## Test seam

**本片段無自動化測試** —— 這是改名加去重，行為不變。
既有的 305 條測試就是迴歸網：任何一條變紅都表示改壞了。

## Write ownership

- `src/studio/board/**`
- `src/studio/drawer/changes.ts`
- `src/studio/App.tsx`
- `src/studio/index.css`（若有 class 名要跟著改）

**不得碰**：`src/studio/reconcile.ts` `src/studio/poll.ts` `src/studio/api.ts`
`src/studio/drawer/` 的其他檔案、`src/core/**`、`src/server/**`、
`CONTEXT.md`（詞彙表是標準，不是可以改成符合程式碼的東西）。

## Blocked by

無，但**必須在票 05、06、07 之前完成**。

## Status

queued
