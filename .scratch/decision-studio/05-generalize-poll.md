# 05 泛化 poll.ts 的 startPolling，讓兩個視圖共用同一份輪詢迴圈

nook ref：`01M2HPP1HWPKBB3GS6RMGVBRAP`

## 從哪來

票 01 落地後的 Standards-axis review 發現：spec.md 原本斷言「`poll.ts`
的 `startPolling` 已經是泛型函式，直接重用」，這句話沒有查證就寫進去，
而且是錯的——`startPolling` 內部直接 import 並呼叫 Issue 專用的
`fetchHash`/`fetchBoard`，並 dispatch 一個 Decision 沒有的 `POLL`
action。`poll.ts` 又被票 01 劃進「不得碰」，於是 `DecisionApp.tsx`
只能自己接一份小的輪詢迴圈——重用 `poll.ts` 裡真正泛型的連線狀態機
（`CONNECTED`/`connectionReduce`/`connectionFault`/`sameFault`）與
`classifyFailure`，但 `setInterval`/`busy` 旗標/`AbortController` 這套
控制流程現在有兩份幾乎一樣的實作。review 判定這正是這個 repo commit
463343d 那個教訓的同類情況：兩份獨立寫的迴圈遲早會分岔。

## Outcome

`startPolling` 改成吃 `fetch`（取得指紋）、`fetchSnapshot`（取得完整
快照）與一個把快照轉成 dispatch action 的函式當參數，`IssueApp.tsx`
與 `DecisionApp.tsx` 呼叫同一份、被同一份測試涵蓋的輪詢迴圈。Issue
既有的輪詢行為（間隔、`busy` 旗標語意、abort 規則、`ConnectionFault`
分類）逐字不變。

## Acceptance criteria

- [ ] `src/studio/poll.ts`：`startPolling` 的簽章從寫死 Issue 改成吃
      `{ fetchHash, fetchSnapshot, toAction, dispatch, onFault }`
      這種形狀（確切欄位名稱由你決定，但要能讓呼叫端決定「指紋怎麼拿」
      「快照怎麼拿」「快照怎麼變成一個 action」）；**排序/連線狀態機
      本身一行不改**（`CONNECTED`/`connectionReduce`/`connectionFault`/
      `sameFault`/`classifyFailure` 這五個保持原樣，不是這張票要動的
      東西）
- [ ] `src/studio/IssueApp.tsx`：改叫泛化後的 `startPolling`，傳入
      `fetchHash`/`fetchBoard`/一個把 `BoardSnapshot` 轉成
      `{ type: 'POLL', issues }` 的函式——**Issue 既有的輪詢行為
      （間隔、busy 語意、abort 規則）不能有任何觀察得到的差異**，這是
      驗收的關鍵，不是可以打折的細節
- [ ] `src/studio/DecisionApp.tsx`：刪掉自己接的那份輪詢迴圈，改叫
      泛化後的 `startPolling`，傳入 `fetchDecisionHash`/`fetchDecisions`/
      一個把 `DecisionBoardSnapshot` 轉成 `{ type: 'SNAPSHOT', decisions }`
      的函式
- [ ] 既有 `test/studio/poll.test.ts` 的全部案例維持通過（若簽章改變
      使既有測試需要調整呼叫方式，行為斷言本身不能變）
- [ ] 新增測試涵蓋：泛化後的 `startPolling` 對兩種不同的
      fetch/dispatch 組合都正確運作（可以用兩組假的 fetch 函式分別
      模擬 Issue 與 Decision 的情境，不必真的跑 server）

## Test seam

`startPolling`（純函數，注入假的 fetch/dispatch，同既有
`poll.test.ts` 的手法，不 spawn 真實 server）。

## Write ownership

- `src/studio/poll.ts`
- `src/studio/IssueApp.tsx`
- `src/studio/DecisionApp.tsx`
- `src/studio/reconcile.ts`（僅在 `toAction` 這類轉換函式需要從這裡
  匯出／調整型別時才動，若不需要就不要碰）
- `test/studio/poll.test.ts`

**不得碰**：`src/studio/decisionReconcile.ts`（reducer 本身不受這張票
影響）、`src/server/**`、`src/core/**`。

## Shared resources

None。

## Blocked by

票 04（`DecisionApp.tsx` 由票 01/02/03 陸續擴充，票 04 是這批對它
最後一次接線；這張票排在最後，避免跟前面幾張票的接線工作互相搶
`DecisionApp.tsx`）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
