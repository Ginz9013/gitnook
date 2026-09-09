# 09 亂序抵達的 ACK 會讓卡片閃回舊欄位

nook ref：`01M22EFD3X3JGHVHJ5Y8HHXQDX`

## Outcome

票 02 的 worker 找到、且刻意沒有自作主張修掉的角落。票 06 的「快速連拖兩次
同一張卡片」讓這條路徑變成可達的，症狀是使用者看得見的閃動。

## Acceptance criteria

- [ ] 紅燈測試釘住這個序列：`DROP(seq1)` → `DROP(seq2)` → `ACK(seq2)` → `ACK(seq1)`。
      在 `ACK(seq2)` 之後、`ACK(seq1)` 之前，`project()` **不得**落回 seq1 的值
- [ ] 修法：`ACK` 連同所有 `seq <= action.seq` 的 pending 一起移除，而不是只移除
      `action.seq` 那一筆。`FAIL` 是否比照辦理要想清楚並在註解裡說明理由
- [ ] 既有的十個測試全數維持綠燈，**公開簽章不得改變**
      （`initialClient` / `clientReduce` / `project`）—— 票 05/06/07 正在 import 它

## Test seam

`clientReduce(state, action)`，同票 02。`environment: 'node'`。

## Write ownership

- `src/studio/reconcile.ts`
- `test/studio/reconcile.test.ts`

**不得碰**任何其他檔案。

## Blocked by

票 02（已完成）。

## Status

backlog
