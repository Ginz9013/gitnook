# 02 前端拿到 500 時說錯話

nook ref：`01M22RFATQN6YGDY3VH0PDGZ9N`

## Outcome

前一批讓 server 的未預期例外回 500 而不是帶掉 process。但前端分不出來：

- `api.ts` 在 `!res.ok` 時 `throw new Error(...)`
- `poll.ts` 一律 `catch` 成 `record('failed')`
- 連續三次 `'failed'` → 橫幅說「連線中斷 —— 伺服器沒有回應」

**伺服器明明回應了。** board 目錄被移走時，畫面會說一句錯的話，
而那句話會把人引去查網路而不是查 board。

## Acceptance criteria

- [ ] 前端能分辨「連不上」與「伺服器回了錯誤」
- [ ] 兩種情況說不同的話，且都說得出下一步
- [ ] 判定邏輯是**純函式且有測試**（`connectionReduce` 已經是這個形狀，
      沿用它的作法）
- [ ] `poll.ts` 既有的門檻行為不變：連續三次失敗才進入中斷、一次成功即解除。
      既有的 `poll.test.ts` 一條都不能改壞

## 形狀是這張票要決定的事

至少三個選擇，挑一個並在註解寫明理由：

- `PollOutcome` 從 `'ok' | 'failed'` 擴成三態
- `api.ts` 丟一個帶得出狀態碼的具名錯誤，`poll.ts` 據以區分
- 其他你認為更好的

注意 `api.ts` 的 `postChange` 也走同一條 `!res.ok` 路徑，而寫入失敗的橫幅
是另一條線 —— 想清楚這張票要不要一起涵蓋它，不要順手擴大。

## Test seam

純函式（連線狀態的判定）在 `environment: 'node'` 下直接測。
`fetch` / `setInterval` 的接線依策略無自動化測試，**不得**引入 jsdom
或發明 `Fetcher` 假接縫。React 組件（橫幅）不測。

## Write ownership

- `src/studio/poll.ts`
- `src/studio/api.ts`
- `src/studio/App.tsx`
- `test/studio/poll.test.ts`

## Blocked by

無。

## Status

queued
