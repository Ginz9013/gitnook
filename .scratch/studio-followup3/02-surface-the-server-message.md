# 02 把伺服器實際說的那句話送到畫面上

nook ref：`01M2307YKBKXWDNAKBEBRMDR1J` ＋ `01M2307YME3D4MGDDV56VA4FNB`

> 兩張 nook issue 合併：都要動 `api.ts` / `poll.ts` / `poll.test.ts`，
> 而且第一張提的修法正是第二張需要的前置。

## Outcome

### 缺陷一：伺服器說的話到不了畫面

`handler.ts` 的 `serverError` **刻意**送一則可行動的訊息
（`不是一個 Nook board：/path…`），但橫幅沒有引用它 —— 因為要帶著它就得讓
`PollOutcome` 從字串聯集變成帶 payload 的值，那會動到既有測試裡的
`'failed'` 字面值。

所以畫面目前說的是「最可能的原因」，而不是伺服器實際說的那句。
使用者手上有一則精確的訊息，卻看不到。

### 缺陷二：200 但 body 解析不了會被說成「連不上」

`res.json()` 丟 `SyntaxError` 時，`classifyFailure` 落到 else 分支
= `'failed'`（連不上）。**但伺服器確實答了。** 票 02 的 worker 刻意不從
例外型別去猜，把它記在 `classifyFailure` 的註解裡留給這張票。

## Acceptance criteria

- [ ] 中斷橫幅顯示伺服器實際回的訊息（`serverError` 送的那則）
- [ ] 沒有訊息可顯示時（連不上），仍然說得出下一步 —— 現行那句已經是對的，
      不要為了改形狀而讓它變差
- [ ] 「答了，但 body 不是承諾的形狀」有自己的分類，**不再算成連不上**。
      它該說什麼由這張票決定
- [ ] 判定邏輯仍是**純函式且有測試**
- [ ] **門檻行為一個字都不能變**：連續三次失敗進入中斷、一次成功解除。
      那三條釘住不對稱的既有測試可以因為形狀改變而改寫**斷言的形狀**，
      但**它們釘住的性質必須原封不動**，而且要在報告裡逐條說明改了什麼、
      為什麼那不是覆蓋率損失
- [ ] `postChange` 的寫入失敗橫幅**不在這張票的範圍** —— 它已經帶著狀態碼
      與伺服器的 body，本來就不是說謊的那一句。不要順手擴大

## Test seam

純函式（`classifyFailure`、`connectionReduce`、`connectionFault`）在
`environment: 'node'` 下直接測。`fetch` / `setInterval` 的接線與 React
橫幅依策略無自動化測試。

## Write ownership

- `src/studio/api.ts`
- `src/studio/poll.ts`
- `src/studio/App.tsx`
- `test/studio/poll.test.ts`

**不得碰**：`src/server/**`（票 01 同批正在動 `serve.ts`）、
`src/studio/reconcile.ts`、`src/studio/board/**`、`src/studio/drawer/**`、
`test/studio/board.test.ts`、`package.json`。

## Blocked by

無。

## Status

queued
