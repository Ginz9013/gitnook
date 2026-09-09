# 01 ACK 用 pending 的 issueId 選槽，卻寫入回應帶的 issue

nook ref：`01M22RFASKG84VB0K4BFS85J4T`

## Outcome

票 03 的 worker 讀碼發現，刻意沒修因為超出當時票面。

```ts
snapshot: state.snapshot.map((i) => (i.id === p.issueId ? action.issue : i)),
```

槽位用 `p.issueId` 選，寫進去的值是 `action.issue`。兩者不同時，reducer 會把
回應寫進**錯的槽**：快照出現重複 id，原本那張 issue 消失。

**這是讀碼推論，不是實測。** 第一步是先證明它真的會發生。

## Acceptance criteria

- [ ] 紅燈測試釘住：`ACK` 帶的 `issue.id` 與 pending 的 `issueId` 不同時，
      現況會產生重複 id 且原本那張消失
- [ ] 修掉。成員資格檢查與寫入都以**同一個 id** 為準
- [ ] 決定該以哪一個為準並在註解說明。`action.issue.id` 是伺服器的說法，
      `p.issueId` 是我們送出時的說法 —— 兩者不一致本身就是異常，
      想清楚是要信誰、還是要把它當成票 03 那種「落空」處理
- [ ] 既有測試全綠，公開簽章不變

## Test seam

`clientReduce(state, action)`，純 reducer，`environment: 'node'`。

## Write ownership

- `src/studio/reconcile.ts`
- `test/studio/reconcile.test.ts`

## Blocked by

無。

## Status

queued
