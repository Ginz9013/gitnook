# 05 輪詢改局部套用，拿掉 `location.reload()`

nook ref：`01M224SE749M2620XTH7F8ASFC`

## Outcome

保留每 2 秒問一次 `/hash` 的契約，但值變了不再整頁重載 —— 取新快照交給調和
reducer 局部套用。ADR-0002 的判斷沒變：沒有快取、沒有推播、沒有 WebSocket。

## Acceptance criteria

- [ ] `src/studio/poll.ts` 實作輪詢迴圈：每 2 秒 `fetch('/hash')`，值改變才
      `fetch('/api/board')`，再把新快照交給 `clientReduce` 的 `POLL` action
- [ ] **不呼叫 `location.reload()`**，程式碼裡不得再出現它
- [ ] 輪詢間隔維持 2000ms
- [ ] 連線失敗的處理是一個**純函式**且有測試：連續失敗達門檻時回報「連線中斷」，
      恢復後清除。舊的內嵌腳本可以靜默失敗（唯讀時沒差），但開放寫入之後
      伺服器不通代表使用者的變更正在掉，畫面必須說出來
- [ ] `/hash` 涵蓋 `all: true` 的性質不得破壞 —— archived 與 done 的變動同樣要
      觸發重畫

## Test seam

**可測**：連線狀態的純函式（給一串成功/失敗的結果，斷言何時進入與離開「中斷」）。
在 `environment: 'node'` 下直接單元測試。

**不可測**：`fetch` 與 `setInterval` 的實際接線。依 spec.md 的測試策略，
**不要**為了測它而引入 jsdom 或發明一個 `Fetcher` 假接縫 —— 那正是 ADR-0004
反對的東西。把不可測的部分壓到最薄，讓它薄到看一眼就知道對不對。

## Write ownership

- `src/studio/poll.ts`
- `test/studio/poll.test.ts`

**不得碰**：`src/server/handler.ts`（票 03 同批；內嵌腳本的移除由票 01 完成）、
`src/studio/reconcile.ts`（票 02 的產物，只 import 不修改）、
`src/studio/App.tsx`（票 01 的檔案 —— 若接線需要改它，回報 blocked）。

## Shared resources

無。

## Blocked by

票 01（`/api/board` 與 App 殼）、票 02（reducer）。

## Status

queued
