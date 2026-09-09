# 03 補上純模組的測試

nook ref：`01M22SV2Q73Z3HZCNK27758B4S`

## Outcome

規劃的疏失，不是實作的。`spec.md` 說的是「只測純邏輯，**React 組件**不寫
測試」，但票面被寫成「本片段無自動化測試」，把純模組也一起豁免掉了。

前幾輪的 worker 正確地把可判定的邏輯推進這些純模組（那是對的），
然後因為票面說不用測而沒測它們。**邏輯放對了位置，網子卻沒張開。**

這張票**不是放寬測試策略**，是回到它原本的樣子。

## Acceptance criteria

一個新檔 `test/studio/board.test.ts`，涵蓋：

- [ ] `board/lanes.ts`：`dropEffect`（`needs-reason` 與 `opens-lane` 的每個
      分支）、`isStatus`（要能擋掉 `'archived'` 與 `'toString'`）、
      `groupByStatus`（空的 Status 仍要有一組）
- [ ] `board/announce.ts` 的拖曳播報：`announceGrab` / `announceOver` /
      `announceDrop` / `announceCancel`。**特別要釘住 `queued` 的措辭與
      一般搬移不同**，以及 `blocked` 的兩則都提到原因 ——
      那是 ADR-0008 選 React 的唯一理由在播報上的體現
- [ ] `board/announce.ts` 的狀態播報：`pendingParts`（欄位排序、
      comment 折入）、`pendingLabel`、`announceIssueState`
      （`held` × `pending` 的組合）
- [ ] `src/studio/statuses.ts` 的 `STATUS_ORDER` 與 core 的 `STATUSES` 一致
      （順序守衛已經是編譯期的，這裡是執行期的第二道）

## 這張票的紀律

- **不得引入** jsdom、`@testing-library/*`、playwright。這些全是純函式，
  在 `environment: 'node'` 下直接呼叫
- **不得改任何 src 檔案。** 如果測試讓你發現某個純模組真的有 bug，
  **回報，不要修** —— 另一位 worker 這一輪正在改 `board/` 底下的註解
- 斷言要釘住**行為與意圖**，不要只是把實作抄成期望值。
  例如 `queued` 的播報，該斷言的是「它與一般搬移不同、而且提到授權」，
  不是逐字複製那串中文

## Test seam

全部是純函式，`environment: 'node'`。

## Write ownership

- `test/studio/board.test.ts`（新，**只有這一個檔**）

**不得碰**任何其他檔案。

## Blocked by

無。

## Status

queued
