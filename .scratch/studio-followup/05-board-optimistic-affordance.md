# 05 `BoardProps` 收 `ProjectedIssue`，拖曳中的卡片看得出「送出中」

nook ref：`01M22NG4WANC1SE286MD940YZ4`

## Outcome

`BoardProps.issues` 是 `readonly IssueView[]`，所以 App 交給看板的是
`project()` 的 `p.shown`，`held` 與 `optimistic` 兩個欄位算出來就被丟掉。
一張還在飛的卡片跟已經落地的長得一模一樣。

`IssueDrawerProps` **已經**收 `ProjectedIssue<IssueView>` —— 這張票是把看板
拉齊到 drawer 已有的水準，不是發明新東西。

## Acceptance criteria

- [ ] `BoardProps.issues` 放寬成 `readonly ProjectedIssue<IssueView>[]`
- [ ] 還在飛的變更在卡片上看得出來（`optimistic` 非空）
- [ ] 被抓住的卡片看得出來（`held`）
- [ ] **播報也要有對應**，不只是視覺 —— 鍵盤使用者看不到樣式。
      這與票 06（原 06 拖拉票）「播報與畫面的區別要一致」是同一條原則，
      而鍵盤無障礙是 ADR-0008 選 React 的**唯一**理由
- [ ] 樣式一律用既有 token，不新增顏色
- [ ] `App.tsx` 改傳 `project(state)` 本身，不再 `.map(p => p.shown)`

## Test seam

**本片段無自動化測試**（spec.md 的測試策略）。可判定的邏輯已經在
`reconcile.ts`（有測試），這張票只是把算好的東西顯示出來。

驗收靠 `npx tsc --noEmit`、`npx vite build`，以及實際開起來看一眼。

## Write ownership

- `src/studio/board/**`
- `src/studio/App.tsx`

**不得碰**：`src/studio/reconcile.ts`（`ProjectedIssue` 已經有你要的欄位，
只 import）、`src/studio/drawer/**`、`src/server/**`。

## Blocked by

票 04（改名先做，否則這張票會用到即將被改掉的名字）。

## Status

queued
