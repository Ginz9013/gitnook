# 07 Issue drawer：詳情、留言與內編輯

nook ref：`01M224SDPE563QQEF5E1SCHZKQ`

## Outcome

點卡片開 drawer 看詳情並就地編輯，不離開看板。用 Radix Dialog 為底的 shadcn
Sheet —— **不是 vaul**（ADR-0008）。

## Acceptance criteria

- [ ] 顯示標題、status、labels、description、comment 時間軸
- [ ] `description` 與 comment 內文用 server 送來的 `descriptionHtml` / `bodyHtml`
      注入。安全性由 server 保證（先逸出、再構造），**前端不得自己渲染 markdown**
- [ ] 內編輯：標題、description、留言、label 增減，各自走 `POST /i/<ref>`
      並經過 `clientReduce` 的樂觀更新
- [ ] **comment 時間軸不得在前端重排。** `Issue.comments` 已由 core 的 `reduce()`
      以 `(t, a, id)` 全序產出；在此複製一份比較器只會與 core 分歧 —— 這正是
      commit 463343d 那個 bug 的成因
- [ ] status 改為 `blocked` 時要求同時留言（CONTEXT.md）
- [ ] Radix 負責 focus trap、ARIA 與 scroll lock，**不要自己手寫**
- [ ] Esc 關閉；關閉後焦點回到觸發的卡片

## Test seam

**本片段無自動化測試**（spec.md 的測試策略）。focus trap 與 Sheet 的行為由 Radix
保證，在 jsdom 底下重測它等於測 Radix，不是測我們的程式碼。

可判定的邏輯推進 `reconcile.ts`（票 02，已有測試）。驗收靠 `npx tsc --noEmit`
與人工操作：開關 drawer、改標題、留言、加減 label、改成 blocked。

## Write ownership

- `src/studio/drawer/**`

**不得碰**：`src/studio/App.tsx`（票 01 已預先接好插槽）、`src/studio/board/**`
（票 06 同批）、`src/studio/reconcile.ts`、`src/studio/poll.ts`、server 與 core。
需要新相依時**回報 blocked** —— `package.json` 屬於票 01。

## Shared resources

無。

## Blocked by

票 01（骨架與插槽）、票 02（reducer）、票 03（`POST /i/<ref>`）。

## Status

queued
