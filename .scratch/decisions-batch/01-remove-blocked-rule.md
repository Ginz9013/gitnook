# 01 拿掉 `blocked` 的留言規則

nook ref：`01M233VN4M4BW2SE40KM36BAV6`

## Outcome

使用者的決定：**「沒有這一條，都拿掉，他就只是一個狀態，不應該還要有額外
效果。」** 這是這一批最大的一個改動，也是唯一牽涉多個模組的。

## Acceptance criteria

**移除規則本身**

- [ ] `src/cli/run.ts` 的提醒（`提醒：blocked 要有一則說明原因的 comment`）
- [ ] `src/studio/drawer/changes.ts` 的 `needsReason`，以及 `statusChange`
      裡對 `blocked` 的特別處理
- [ ] `src/studio/board/lanes.ts` 的 `dropEffect`：`'needs-reason'` 這個
      `DropEffect` 隨之消失（它是為這條規則存在的）
- [ ] `src/studio/board/BlockedGate.tsx`：**規則沒了，攔一下也失去理由** ——
      整個閘門應該移除，而不是留一個不收原因的對話框
- [ ] `src/studio/board/announce.ts`：blocked 的播報不再提到原因要求
- [ ] `src/studio/drawer/StatusPicker.tsx`：不再擋
- [ ] `Board.tsx` / `Column.tsx` 相關接線（`onBlock` 這條路徑整條消失，
      拖進 blocked 變成一般搬移走 `onMove`）

**文件**

- [ ] `CONTEXT.md` 的「**Blocked**：…設為 `blocked` 時**必須同時留下一則
      Comment 說明原因**」那句移除
- [ ] `AGENT.md` 的同一條規則移除（`blocked` 必須同時留一則 comment 說明原因）
- [ ] `docs/adr/0003` 改寫，見下

**ADR-0003 的改寫 —— 這是這張票最需要想清楚的部分**

原文用那條規則 justify「`blocked` 留在 Status 內而 `archived` 被拆成欄位」：
「blocked 遺失的資訊（卡住前在做什麼）**可以由 Comment 補上**，而 archived
遺失的資訊沒有任何東西能補。代價是一條必須寫進文件的規則。」

規則拿掉，那個不對稱就沒有依據了。決定是**接受資訊遺失**：

- [ ] 改寫成「`blocked` 與 `archived` 的正交性問題相同，但我們接受 `blocked`
      的資訊遺失 —— 強制留言的成本高於它補回的價值，而**狀態不該帶有額外
      效果**」
- [ ] `blocked` **維持是 Status**。ADR-0003 的另一條理由（八個固定值讓 agent
      不必先查詢這個專案有哪些狀態）不受影響，那條要留著
- [ ] 不要假裝原本的論證還成立 —— 誠實記錄它為什麼被推翻

**測試**

- [ ] 釘住這條規則的測試一併移除。在報告裡**逐條列出刪了哪些、為什麼那不是
      覆蓋率損失** —— 特別是 `test/studio/board.test.ts` 裡釘住「blocked 的
      兩則播報都提到原因」的那幾條
- [ ] `test/core/board.comments.test.ts` 有提到 blocked，**先確認它測的是
      core 的 comment 行為還是這條規則** —— 如果是前者就不要動

## Test seam

既有的 393 條測試是迴歸網。這張票主要是減法，行為改變的部分（拖進 blocked
不再跳閘門）沒有自動化測試（React 組件），靠 `tsc` 與人工操作驗收。

## Write ownership

- `src/cli/run.ts`
- `src/studio/board/**`
- `src/studio/drawer/changes.ts` `src/studio/drawer/StatusPicker.tsx`
- `CONTEXT.md` `AGENT.md` `docs/adr/0003-*.md`
- `test/cli/run.test.ts` `test/studio/board.test.ts`

**不得碰**：`src/studio/api.ts` `src/studio/poll.ts`（票 04 同批）、
`src/server/**`（票 02 同批）、`src/render/**`（票 03 同批）、
`src/core/**`、`package.json`。

## Blocked by

無。

## Status

queued
