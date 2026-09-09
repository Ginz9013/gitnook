# 06 看板拖拉：`@dnd-kit`，含 `queued` 授權邊界的視覺區別

nook ref：`01M224SCVNT639HKM3Z8Y2MHVG`

## Outcome

八欄看板，拖拉改 status。**選 React 的唯一理由就是 `@dnd-kit` 的鍵盤拖曳與
screen reader 播報**（ADR-0008）—— 所以鍵盤操作不是 nice-to-have，它是這個
決定的全部依據，必須真的做出來。

## Acceptance criteria

- [ ] 八欄，順序即 `STATUSES`（ADR-0003），`archived` 預設隱藏
- [ ] 指標拖曳可改 status
- [ ] **鍵盤拖曳可改 status**，且有 screen reader 播報
- [ ] 放手即樂觀更新（走 `clientReduce` 的 `DROP`），再 `POST /i/<ref>`
- [ ] 拖曳期間指標按著的卡片不接受來自伺服器的移動（reducer 第三條規則，
      這張票只負責正確地把 `GRAB` / `RELEASE` 派給 reducer）
- [ ] **`queued` 的授權邊界看得見。** 拖進 `queued` 表示已授權 agent 不再詢問、
      直接動手，是 board 上語意最重的一次拖曳，不能跟 `todo → in_progress`
      長得一模一樣。人的車道（backlog、todo）與 agent 的車道之間那條線要存在
- [ ] 拖進 `blocked` 時當場要求留言 —— CONTEXT.md 的規則，不能讓人拖完才發現
- [ ] 卡片顯示短 ID、標題、labels。短 ID 的長度由 server 算好隨 `IssueView` 給，
      **前端不得自己算**（長度是整批的性質，且 core 的 `shortIdLength` 是唯一來源）

## Test seam

**本片段無自動化測試**（spec.md 的測試策略）。DND 的指標互動在 jsdom 底下要 mock，
容易寫出「測過但實際壞掉」的假綠燈。

把所有可判定的邏輯**推進 `reconcile.ts`**（票 02，已有測試），組件只負責把事件
翻成 action。組件裡不得出現任何值得測試卻沒被測到的判斷。

驗收靠 `npx tsc --noEmit` 與人工操作：滑鼠拖一次、鍵盤拖一次、拖進 queued、
拖進 blocked。

## Write ownership

- `src/studio/board/**`

**不得碰**：`src/studio/App.tsx`（票 01 已預先接好插槽）、`src/studio/drawer/**`
（票 07 同批）、`src/studio/reconcile.ts`、`src/studio/poll.ts`、server 與 core。
需要新相依時**回報 blocked**，不要自己 `npm i` —— `package.json` 屬於票 01。

## Shared resources

無。

## Blocked by

票 01（骨架與插槽）、票 02（reducer）、票 03（`POST /i/<ref>`）。

## Status

queued
