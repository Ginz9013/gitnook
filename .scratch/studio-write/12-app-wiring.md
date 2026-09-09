# 12 `App.tsx` 接線：把看板、drawer、輪詢與調和器接起來

nook ref：`01M22K4QFVG5FDTY3SZXJTCJA1`

## Outcome

board 的缺口。按目錄切票換到了乾淨的平行度（第 2、3 輪皆零碰撞），代價是
**沒有任何一張票擁有 composition root**。三張票的 worker 都撞到、都照指示
回報而沒有偷改 `App.tsx`。現在把它接起來。

目前：`onMove` / `onGrab` / `onRelease` 是票 01 的 no-op stub，輪詢沒被啟動，
App 用 `useState` 而非 `useReducer` —— **拖曳視覺正確但什麼都不會改**。

## Acceptance criteria

- [ ] App 改用 `useReducer(clientReduce, initialClient(snapshot.issues))`，
      交給 Board 的是 `project()` 的產物，不是原始快照
- [ ] `onMove(id, status)` → 派 `DROP` + `POST /i/<ref>`，回應派 `ACK`，
      傳輸失敗派 `FAIL`
- [ ] `onGrab` / `onRelease` 接到 reducer 的 `GRAB` / `RELEASE`
- [ ] 啟動 `startPolling`，**在第一份快照到達之後**才啟動（`hash` 取自
      開場的 `fetchBoard`，否則第一次 tick 會白抓一次整塊 board）；
      `useEffect` 直接回傳它的 stop function
- [ ] 連線中斷的橫幅渲染出來（`onConnectionChange` 只給旗標，畫面是這張票的）
- [ ] **`src/studio/drawer/pending.ts` 刪除**，drawer 的編輯改走同一個
      `clientReduce`（票 10 已把它擴成 Change 形狀）。
      `IssueDrawerProps` 加上提交用的 callback，由 App 擁有
- [ ] `Card.tsx` 顯示 `issue.shortId`（票 11 已加上該欄位），不再印 26 碼
- [ ] `postChange` 只留一份 —— 目前 `drawer/write.ts` 重述了 `api.ts` 的
      fetch 慣例，收斂到 `api.ts`

## Test seam

**本片段無自動化測試**（spec.md 的測試策略）。這是 composition root，
它就是接線。

可判定的邏輯不得留在這裡 —— 全部應該已經在 `reconcile.ts`（票 10）、
`lanes.ts` / `announce.ts` / `dnd.ts`（票 06）裡並且已被測過。若發現需要在
App 裡寫一個你希望能測的分支，那段邏輯放錯地方了。

驗收靠 `npx tsc --noEmit`、`npx vite build`，以及**實際開起來操作**：
滑鼠拖一次、鍵盤拖一次、拖進 queued、拖進 blocked、開 drawer 改標題、
留言、加減 label、把 server 停掉看中斷橫幅。

## Write ownership

- `src/studio/App.tsx`
- `src/studio/api.ts`
- `src/studio/board/Card.tsx`
- `src/studio/drawer/**`
- `src/studio/poll.ts`（**僅限**接線需要的簽章調整；連線判定的邏輯不得改）

**不得碰**：`src/studio/reconcile.ts`（票 10 的產物，只 import）、
`src/server/**`、`src/core/**`、`package.json`。

## Blocked by

票 10（擴好的 reducer）、票 11（`shortId`）。

## Status

queued
