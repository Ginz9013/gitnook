# 10 reconcile 擴成 Change 形狀，收斂成單一調和器

nook ref：`01M22K4QDJZW4Y48Y9XHJZSZE8`（吸收 `01M22EFD3X3JGHVHJ5Y8HHXQDX`）

## Outcome

board 的設計錯誤修正。`reconcile.ts` 是從**拖拉** prototype 驗證出來的，
`PendingWrite.value` 是單一 status 字串；票 07 的 drawer 需要 label 增減、
留言、標題編輯，裝不下，只能自建 `drawer/pending.ts`。兩份樂觀狀態會分歧。

**決定：擴 `reconcile.ts`，只留一份調和器。** `drawer/pending.ts` 由票 12 刪除。

## Acceptance criteria

- [ ] `PendingWrite` 的值從單一 status 字串換成一份 `Change`
      （`title` / `description` / `status` / `archived` / `labels.add` /
      `labels.remove` / `comment`）
- [ ] `project()` 把飛行中的 Change 疊在快照上，各欄位依其型別合併：
  - [ ] `title` / `description` / `status` / `archived` 是 LWW —— 同欄位取最後一筆
  - [ ] `labels` 是集合運算，`add` 與 `remove` 都要反映
  - [ ] `comment` 是**附加**，且**不得混進 server 給的 comments 陣列中間**
        —— core 已用 `(t, a, id)` 全序排好，未確認的留言接在後面
- [ ] **票 02 的四條規則逐條維持**，且測試逐條保留：
  - [ ] 飛行中的變更蓋過快照
  - [ ] 同一張 issue 的同一欄位只認最後一筆
  - [ ] 拖曳期間押後快照
  - [ ] ACK 帶的是寫入當下的值，不是永恆真理
- [ ] `FAIL` 仍是唯一會回滾的動作
- [ ] `ACK` 收伺服器回的整張 `IssueView` 當該張 issue 的新快照
- [ ] **亂序 ACK 修掉**（原 `01M22EFD3`）：紅燈測試釘住
      `DROP(seq1)` → `DROP(seq2)` → `ACK(seq2)` → `ACK(seq1)`，
      在 `ACK(seq2)` 之後、`ACK(seq1)` 之前，`project()` **不得**落回 seq1 的值。
      修法：`ACK` 連同所有 `seq <= action.seq` 的 pending 一起移除
- [ ] 仍**不 import** `src/server/**` 或 `src/studio/api.ts` —— 結構型別在本檔宣告。
      票 11 正在改 `handler.ts`，import 會讓型別檢查依賴它的飛行中編輯

## Test seam

`clientReduce(state, action)`，純 reducer，`environment: 'node'`。同票 02。

## Write ownership

- `src/studio/reconcile.ts`
- `test/studio/reconcile.test.ts`

**不得碰**：`src/studio/drawer/**`、`src/studio/board/**`、`src/studio/App.tsx`
（都是票 12 的）、`src/server/**`（票 11 的）。

公開簽章可以擴充，但 `initialClient` / `clientReduce` / `project` 三個名字要留著。

## Blocked by

票 02（已完成）。

## Status

queued
