# 06 blocked 閘門：真的收原因，關閉後焦點有地方去

nook ref：`01M22PKRSTTNPP0Z942G3D3NEW` ＋ `01M22NG4XJ1GPQ8PQ0D3RMYYHT`

> **兩張 nook issue 合併成一張票。** 它們都改 `BlockedGate.tsx` 與 `Board.tsx`，
> 而且本來就是同一段互動流程：閘門收原因 → 開 drawer → 關閉後焦點回哪裡。
> 分開必然碰撞，也會讓「焦點該回哪」在不知道流程長什麼樣的情況下被決定。

## Outcome

兩軸審查獨立發現的同一條，加上真實瀏覽器裡實測到的一條。

## 缺陷一：拖進 `blocked` 不會真的要求留言

CONTEXT.md：「設為 `blocked` 時**必須**同時留下一則 Comment 說明原因」。
這條規則補上的是「卡住前在做什麼」這項在扁平 Status 中會遺失的資訊 ——
**它是 ADR-0003 用來 justify 把 `blocked` 留在 Status 裡的唯一理由。**

現況兩條路徑不一致：
- **drawer**（`changes.ts:94`、`StatusPicker`）—— 有強制，沒原因就不送出
- **拖曳**（`lanes.ts:88` → `BlockedGate`）—— 沒有。`onConfirm` 是
  `() => void`，對話框**沒有輸入框**；確認後送出 `{status:'blocked'}` 並開啟
  drawer，但沒有任何東西逼使用者真的寫。關掉 drawer 就是「已經 blocked 但
  沒有人知道為什麼」，正是這條規則要防的狀態

前一批 worker 的取捨（「收了原因再丟掉比不收更糟」，因為 `onMove(id, status)`
帶不了 comment）推理成立，但結果是**放寬了驗收條件而不是達成它**。

## 缺陷二：Esc 關閉後鍵盤焦點無處可去

真實瀏覽器實測到的，不是推論。Radix 會把焦點還給觸發元素，但這個 drawer 是
從閘門**程式化**開啟的，沒有觸發元素。Esc 之後 `document.activeElement` 上的
`aria-roledescription` 是 `null` —— 鍵盤使用者在看板上失去了自己的位置。

## Acceptance criteria

- [ ] 拖進 `blocked` 時**無法**在沒有原因的情況下完成移動
- [ ] 原因與 status 進**同一份 `Change`**，讓 `board.apply()` 把兩個 op 一起
      append —— 不得出現「已經 blocked 但還沒留言」的中間狀態
      （drawer 那條路徑已經是這樣做的，兩條要一致）
- [ ] 取消不移動、不留言
- [ ] drawer 關閉後焦點回到一個**明確且合理**的地方。這是設計決定 ——
      選一個並在註解寫明理由（剛才那張卡片？那一欄？看板容器？）
- [ ] 兩條路徑（拖曳、drawer）對 `blocked` 的規則行為一致
- [ ] `BoardProps` / `BlockedGateProps` 的放寬要能讓 App 送出帶 comment 的
      `Change`

## Test seam

**本片段無自動化測試**（spec.md 的測試策略）。焦點行為在 jsdom 底下測等於
測 Radix，不是測我們的程式碼。

可判定的規則推進 `lanes.ts` / `changes.ts`（純模組），組件只把事件翻成 action。
「blocked 需要原因」這條規則目前被編碼兩次（`lanes.ts:88` 與
`changes.ts:needsReason`）且行為不同 —— 收成一份。

驗收靠 `npx tsc --noEmit`、`npx vite build`，以及實際操作：拖進 blocked、
不填原因、填原因、取消、Esc 關閉後按 Tab 看焦點在哪。

## Write ownership

- `src/studio/board/**`
- `src/studio/drawer/IssueDrawer.tsx`
- `src/studio/App.tsx`

**不得碰**：`src/studio/reconcile.ts`、`src/studio/drawer/` 的其他檔案、
`src/server/**`、`CONTEXT.md`。

## Blocked by

票 04（改名）、票 05（`BoardProps` 已放寬成 `ProjectedIssue`）。

## Status

queued
