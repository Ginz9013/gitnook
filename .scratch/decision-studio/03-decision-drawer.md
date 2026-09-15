# 03 Decision drawer：看＋改

nook ref：`01M2HN166T4M22A6J36FSDJ8R8`

## Outcome

點清單上一筆 Decision 開 drawer：看得到 title、body（渲染 markdown）、
disposition、supersededBy（有值才顯示）、legacyRef（有值才顯示，唯讀
小標記）。能改 title/body/disposition/supersededBy，沒有變化的編輯不送
出任何請求。

## Acceptance criteria

- [ ] `src/server/handler.ts`：`POST /d/<ref>`，body 是一份
      `DecisionChange` JSON，回應是套用後的整份 `DecisionView`——直接
      鏡射 `decisionLog.apply(ref, change)`，不發明新詞彙；對不認得的
      欄位回 400（同 `POST /i/<ref>` 的規則）；`RefNotFound`→404，
      `InvalidDisposition`→400

      > **完成後更正**：這裡原本寫「有歧義前綴→409」，是錯的——這個
      > repo 從來沒用過 409。`POST /i/<ref>` 對 `AmbiguousRef` 的既有
      > 行為就是 404（同 `RefNotFound` 共用 `notFound()`），`POST
      > /d/<ref>` 照實鏡射這個既有行為：`AmbiguousDecisionRef` 一樣
      > →404，不是 409。
- [ ] `src/studio/api.ts`：`postDecisionChange(ref, change)`，重用既有
      `postJson`（不改）
- [ ] `src/studio/decisionDrawer/`（新目錄）：
  - `decisionChanges.ts`：純函數 `titleChange`/`bodyChange`/
    `dispositionChange`/`supersededByChange`，逐一比照
    `drawer/changes.ts` 的「沒有變化就回 `undefined`」規則（`title`
    trim 後為空視為誤觸；`body`／`supersededBy` 不 trim，理由同
    `descriptionChange` 對 markdown 縮排/尾端空行的既有態度）
  - `DispositionPicker.tsx`：比照 `StatusPicker.tsx` 的下拉選單節奏，
    但只有四個固定值（`proposed`/`accepted`/`superseded`/
    `rejected`），**沒有任何值需要「選到就先問原因」的特例**——那條
    規則連 Status 的 `blocked` 都已經拿掉了，Disposition 從來沒有過，
    不要重新發明
  - `DecisionDetail.tsx`：title/body 可編輯欄位（同 Issue drawer 的
    inline 編輯節奏）、`DispositionPicker`、supersededBy 純文字輸入
    （不解析、不驗證、不顯示連結——見 spec.md 的 Non-goals）、legacyRef
    有值才顯示的唯讀小標記
  - `DecisionDrawer.tsx`：Sheet 外殼，比照 `IssueDrawer.tsx`
- [ ] `src/studio/DecisionApp.tsx`：接上編輯的 `apply` handler——同
      `IssueApp.tsx` 既有的「畫面先動（EDIT action）、POST 隨後、回應
      蓋回快照（ACK）、送不到就退場（FAIL）」節奏，重用票 01 已完整
      實作的 `decisionReconcile.ts` 的 EDIT/ACK/FAIL action
- [ ] 沒有變化的編輯（例如 blur 但沒改字）不呼叫 `postDecisionChange`
- [ ] `npx tsc --noEmit`：`DecisionChange` 這個型別要能指派給 core 的
      `DecisionChange`（同 `DrawerChange` 對 `Change` 的既有收斂關係）

## Test seam

`decisionChanges.ts` 的四個函式（純函數單元測試，同
`drawer/changes.test.ts` 手法）、`handleRequest` 的新路由（server
整合測試，涵蓋 404/400 兩種既有狀態碼路徑——見上面對 409 那句的更正）。

## Write ownership

- `src/studio/decisionDrawer/DecisionDrawer.tsx`（新）
- `src/studio/decisionDrawer/DecisionDetail.tsx`（新）
- `src/studio/decisionDrawer/DispositionPicker.tsx`（新）
- `src/studio/decisionDrawer/decisionChanges.ts`（新）
- `src/server/handler.ts`
- `src/studio/api.ts`
- `src/studio/DecisionApp.tsx`
- 上述各檔對應的測試

**不得碰**：`src/studio/decisions/**`（票 01/02 的範圍，這票不動清單/
表單）、`src/studio/drawer/**`（Issue 既有 drawer，票 04 才會碰
`HistoryPanel.tsx`）。

## Shared resources

暫存目錄（server 測試各自 `mkdtemp`）。

## Blocked by

票 01（`DecisionApp.tsx`／`handler.ts`／`api.ts` 的既有形狀，
`decisionReconcile.ts` 的 EDIT/ACK/FAIL action）。**與票 02 對
`DecisionApp.tsx`／`handler.ts`／`api.ts` 是同一批共用檔案，建議排在
02 之後執行以降低衝突。**

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
