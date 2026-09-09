# 03 Server 寫入面：POST 路由與方法白名單收窄

nook ref：`01M224QVHSVYDQV6C2PSBQ41FQ`

## Outcome

studio 可以寫。ADR-0007 解除了票 09「無任何寫入路徑」的契約。

## Acceptance criteria

- [ ] `POST /i/<ref>`，body 是 `Change` 的 JSON，成功回 200 + `IssueView`
- [ ] 直接鏡射 `board.apply(ref, change)` —— **不發明新詞彙**。`Change` 已經是
      領域裡「呼叫端表達的意圖」的型別（CONTEXT.md）
- [ ] 涵蓋 status 搬移、欄位編輯（title/description/archived）、留言、label 增減
- [ ] 錯誤對應：`RefNotFound`→404、`AmbiguousRef`→404 且內文含候選、
      `InvalidStatus`→400、body 非法 JSON 或非 `Change` 形狀→400
- [ ] **方法白名單收窄而非移除。** POST 只在 `/i/<ref>` 合法；POST 到 `/`、
      `/hash`、`/api/board`、`/assets/*` 一律 405。PUT / DELETE 一律 405
- [ ] 有測試證明「哪些路徑存在」不能決定「能不能寫」—— 這是票 09 那條防線的價值
- [ ] ref 原樣交給 core，前綴解析與穿越檢查只有一份實作
- [ ] **`blocked` 不在 server 端強制配留言。** CLI 目前是提醒而非拒絕，server
      保持一致 —— 在這裡加一條 CLI 沒有的規則會讓兩個介面分歧
- [ ] `serve.ts` 的註解更新：`--host` 從「暫時沒做」升格為「永遠不做」，並寫明
      兩個理由（沒有驗證、actor 是跑 studio 的那個人）
- [ ] 寫入後 `/hash` 換值（既有測試的性質不得破壞）
- [ ] **補回票 01 刪掉的覆蓋。** 票 01 移除了伺服器渲染的 `GET /i/<ref>`，
      連帶刪掉了「有歧義的 ref」那個 describe。目前**沒有任何測試**釘住
      `AmbiguousRef → 404 且內文含足以區分的候選`。在 `POST /i/<ref>` 上補回來

## Test seam

`handleRequest(board, req)` 純函數 + mkdtemp 的真實 board（ADR-0004）。
寫入後直接讀回 `.ndjson` 檔驗證 op 真的 append 了 —— 不要只信回應。

## Write ownership

- `src/server/handler.ts`
- `src/server/serve.ts`
- `test/server/handler.test.ts`
- `test/server/serve.test.ts`

**不得碰**：`src/core/**`（寫入語意屬於 `board.apply`，已經存在）、
`src/render/html.ts`（票 04 同批）、`src/studio/**`（票 05 同批）、`package.json`。

## Shared resources

Port 綁 0。暫存目錄獨立 `mkdtemp`。

## Blocked by

票 01 —— 它先把 `handler.ts` 改成服務 SPA shell 與 `/api/board`，這張票才在其上
加寫入路由。兩者不同批。

## Status

queued
