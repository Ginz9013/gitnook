# 03 ACK 帶回不在快照裡的 issue 時不得靜默

nook ref：`01M22NG4YTC4AK5EX47A4XTGR0`

## Outcome

`reconcile.ts` 的 `ACK` 做的是 `snapshot.map(...)`，從不 append。所以 `ACK`
帶回一張不在當前快照裡的 issue 時，它被**靜靜丟掉**，樂觀值永遠留在畫面上，
沒有錯誤、沒有 log、也沒有任何測試抓得到。

今天不會發生：`/api/board` 是 `all: true` 的全量快照，studio 不能建立 issue，
nook 也沒有刪除。**但這是個潛伏的陷阱** —— 只要有人給 `/api/board` 加上過濾
（`?status=`、或拿掉 `all: true`），對一張被過濾掉的 issue 寫入就會踩到。

票 10 與票 12 兩位 worker 各自獨立回報同一件事。

## Acceptance criteria

- [ ] 紅燈測試釘住：`ACK` 帶一個不在 `snapshot` 裡的 `issueId` 時，
      **現況是靜默**（先證明這件事），修完之後變成看得見的結果
- [ ] 「看得見」的形狀由這張票決定 —— 選一個並在註解寫明理由。至少要讓
      pending 退場，不要讓樂觀值無限期留在畫面上
- [ ] **不得**改成無條件 append。快照的成員資格由 server 決定，
      client 憑一則回應就把一張 issue 塞進快照是另一種錯
- [ ] 既有 19 條測試全綠，**公開簽章不變**
      （`initialClient` / `clientReduce` / `project`）

## Test seam

`clientReduce(state, action)`，純 reducer，`environment: 'node'`。

## Write ownership

- `src/studio/reconcile.ts`
- `test/studio/reconcile.test.ts`

**不得碰**任何其他檔案。特別是**不要**去改 `handler.ts` 的 `boardSnapshot`
讓它「保證不會發生」—— 那是另一張票的範圍，而且不解決 reducer 這一側的靜默。

## Blocked by

無。

## Status

queued
