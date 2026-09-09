# 02 調和 reducer 落地

nook ref：`01M224QW4BH4RN8C9RWSB63DJX`

## Outcome

把 `.scratch/studio-write/write-model.prototype.html` 裡已驗證的「可移植模組 A」
搬進正式程式碼。**這張票不接任何 UI** —— 它交付的是一個純函式模組加上它的測試。

## Acceptance criteria

- [ ] `src/studio/reconcile.ts` 匯出 `initialClient` / `clientReduce` / `project`
      與相關型別，**純函式，不碰 DOM、不 import React**
- [ ] 四條規則各有測試，每條都對應一個實際會壞的情況：
  - [ ] 飛行中的變更蓋過快照 —— 輪詢帶回舊快照時卡片**不彈回**
  - [ ] 同張 issue 只認最後一筆 —— 遲到的舊回應**不翻案**
  - [ ] 拖曳期間押後快照 —— 放開之前畫面**不動**，放開後押後的快照才套用
  - [ ] ACK 帶的是寫入當下的值 —— agent 後來居上時畫面**接受伺服器的值**
- [ ] `FAIL` 是唯一會回滾的動作（append-only 之下沒有「被拒絕的寫入」）
- [ ] **不得** import React Query / SWR 或任何假設「失敗就回滾」的資料抓取工具

## Test seam

`clientReduce(state, action)` 是純 reducer，直接單元測試，`environment: 'node'`。
prototype 裡已經用 node 跑過四個情境，測試照著搬即可 —— 但**要先看到紅燈**。

## Write ownership

- `src/studio/reconcile.ts`
- `test/studio/reconcile.test.ts`

**不得碰**任何其他檔案。`src/studio/` 底下其餘檔案屬於票 01，正在同批執行。
需要 `IssueView` 型別時，在本模組內自行宣告最小的結構型別，**不要**從票 01
還沒寫好的檔案 import。

## Shared resources

無。

## Blocked by

無。可與票 01 同批。

## Status

queued
