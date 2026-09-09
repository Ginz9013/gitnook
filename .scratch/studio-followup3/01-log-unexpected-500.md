# 01 未預期的 500 要留下痕跡

nook ref：`01M2307YJ85EQB4HKZMRZJ8FDX`

## Outcome

`serve.ts` 沒有任何 `console` 呼叫，所以一個未預期的 500 除了那份 HTTP
回應之外不留任何痕跡 —— 跑 studio 的那個終端機上什麼都看不到。

票 02 的 worker 因此刻意把橫幅寫成**不會叫使用者去終端機看一則從沒被印出
的訊息**。這張票讓它真的被印出來：那個終端機本來就開著。

## Acceptance criteria

- [ ] 未預期的 500 在 server 端留下一則看得懂的紀錄
- [ ] **只記未預期的那些。** 404（ref 找不到）、400（status 不合法）、
      405（方法不對）都是正常的、預期中的回應，不該洗版 —— 一個每次
      `nook list` 都在噴東西的終端機等於沒有紀錄
- [ ] 有測試證明「未預期的例外會留下紀錄」與「正常的 4xx 不會」
- [ ] **`handleRequest` 的純函數性質不得破壞。** log 是副作用；
      前一批才剛為了純度把 500 的兜底放進 `handleRequest`，
      不要在同一個地方加上輸出

## 形狀是這張票要決定的事

`serve.ts` 目前沒有任何輸出管道。至少三條路，挑一條並在註解寫明理由：

- 直接 `console.error` —— 最小，但測試要攔全域 console
- `ServeOptions` 加一個選用的接收器（它已經有 `port` 與 `assetsDir`）
- 沿用 CLI 既有的 `Io` adapter（`src/cli/run.ts` 已經有這個模式，
  而 `cmdStudio` 本來就拿得到 `io`）—— 但 `serve()` 目前不收它，
  而且 `src/cli/run.ts` **不在你的寫入範圍**

**注意 ADR-0004**：只有單一 adapter 的介面是掩體不是接縫。如果你選了注入，
要說得出第二個真實的使用者是誰；說不出來就選 `console` 那條，
並想清楚測試怎麼寫才不噁心。

若你判斷正確的修法非動 `src/cli/run.ts` 或 `src/server/handler.ts` 不可，
**回報 blocked 並附上你的提案**，不要越界。

## Test seam

`serve()` 的整合測試，綁 port 0，board 用 `mkdtemp`（ADR-0004：打真實的
檔案系統）。讓 board 在 server 起來之後失效就能造出一個未預期的 500 ——
前一批的 `serve.test.ts` 已經有這個手法，照抄即可。

## Write ownership

- `src/server/serve.ts`
- `test/server/serve.test.ts`

**不得碰**：`src/server/handler.ts`、`src/cli/run.ts`、`src/core/**`、
`src/studio/**`、`package.json`。

## Blocked by

無。

## Status

queued
