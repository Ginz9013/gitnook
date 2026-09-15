# 08 nook decision show 改用 ADR-0005 的 compact header + 內文區塊

nook ref：`01M2HDCWB74NA3BF302V2G4QPS`

## 從哪來

票 01 落地後的 Standards-axis review 發現：`nook decision show` 目前用
`renderDecisionText`（`src/cli/decision.ts`）逐欄印 `title: …`／
`disposition: …`／`body: …`／`supersededBy: …`，跟 ADR-0005「預設輸出是
緊湊表格」的既有慣例不一致——Issue 的 `nook show` 走 `renderTable`
（單張時走 `renderDetail`）：一行 compact header（短 ref／status／title／
labels）＋空行＋完整 description／comments 區塊，**不是**逐欄位的
key:value 傾印。review 判定這是「值得репo owner 拍板，不是隨手小修」的
設計問題，原因是它牽涉到 Decision 的 compact 渲染器該長什麼樣——而那個
渲染器本來就是票 02 的範圍（`nook decision list` 需要一份 compact table）。
先讓票 02 把 `render/table.ts` 裡 Decision 的渲染基礎打好，這張票再回頭
讓 `show` 跟 `list` 共用同一份版面規則，避免兩份渲染邏輯各自長大後才發現
要合併。

## Outcome

`nook decision show <ref>` 印出的格式跟 Issue 的 `nook show` 同一套版面
語言：一行 compact header（短 ref／disposition／title），空行，接著
`body`（不截斷——原因同 Issue 的 description：這是唯一拿得回完整內容的
地方）、`supersededBy`（有值才印）。**不是**逐欄 key:value 傾印。

## Acceptance criteria

- [ ] `render/table.ts`（票 02 已經新增 Decision 的 compact table 渲染
      函式）現在補上單張 Decision 的 detail 版面，比照既有 `renderDetail`
      的節奏：header 一行（`shortId`／`disposition`／`title`），空白區塊
      整個略去（同既有規則：空白行既無資訊也佔 token）
- [ ] `nook decision show <ref>` 改叫這個新函式，刪除 `cli/decision.ts`
      裡原本的 `renderDecisionText`
- [ ] `--json` 輸出（`renderDecisionJson`）**不受影響**——這張票只動預設
      輸出的版面，不動 JSON 形狀
- [ ] 既有 `test/cli/decision.test.ts` 裡對 `renderDecisionText` 輸出格式
      的斷言要跟著改, 改成斷言新格式（header 一行 + body 區塊），不是
      刪掉不測
- [ ] `npm run bench` 的 token 預算閘門：確認新格式沒有讓輸出變得比舊的
      逐欄格式更肥（compact header 通常更省，但要實測不要假設）

## Test seam

`render/table.ts` 的新渲染函式——純函數單元測試。`dispatchDecision`
的 `show` 分支——CLI 整合測試，既有 `Io` capture adapter。

## Write ownership

- `src/render/table.ts`
- `src/cli/decision.ts`（刪除 `renderDecisionText`，改叫新函式）
- `test/render/table.test.ts`
- `test/cli/decision.test.ts`

**不得碰**：`src/core/decisionLog.ts`／`decisionReduce.ts`（純渲染層問題，
不動核心）。

## Shared resources

None。

## Blocked by

票 02（`render/table.ts` 裡 Decision 的 compact table 渲染基礎要先存在，
這張票才有東西可以共用而不是重新發明一份版面規則）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
