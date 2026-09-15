# Summary — decision-studio

### Run metadata

- **Feature slug:** `decision-studio`
- **Board:** `.scratch/decision-studio/spec.md`
- **Branch:** `decision-studio`
- **Start:** 2026-09-15 12:55（板 commit `39346ec`）
- **End:** 2026-09-15 13:53
- **Total tickets:** 5（原 4 張 + review 於票 01 落地後追加的票 05）
- **Circuit breaker fired:** no

### Per-ticket table

| Ticket id | Title | Status | Commit sha | Reason |
| --- | --- | --- | --- | --- |
| 01 | 視圖切換殼 + 唯讀 Decision 清單 | done | `af96bb2`（+ review 修 `e3a1477`） | |
| 02 | 新增 Decision 表單 | done | `7d0b8dd`（+ review 修 `14ea8c7`） | |
| 03 | Decision drawer：看＋改 | done | `1c2b75d`（+ 票面更正 `4fb8dea` + review 修 `758b358`） | |
| 04 | Decision 修改紀錄面板 | done | `47ac5ac` | |
| 05 | 泛化 poll.ts 的 startPolling | done | `ae1ce55` | review 於票 01 落地後追加，非原始板上的票 |

`decision-studio` 分支相對 `main` 共 16 個 commit，其中 15 個帶
`Ticket: decision-studio/NN` trailer（第一個 `39346ec` 是規劃階段建板
的 commit，早於任何票落地，因此沒有 trailer）——`git log --grep
"Ticket: decision-studio"` 可重播全部 15 個。

### Review findings

- **Auto-fixed（6 項，全部落地成獨立 commit，不 amend 原票 commit）：**
  1. 票 01 新檔案裡 7 處用「這一票」/「這票」自我指涉當前工作，違反
     CONTEXT.md 語言規則 —— `e3a1477`
  2. 票 02 一個更隱蔽的版本：帶編號的「票 02」用來自我指涉當前工作
     （規則只允許帶編號的形式指**別的**票），4 處 —— `14ea8c7`
  3. **DecisionDrawer.tsx 缺少 `onCloseAutoFocus`**，對照
     `IssueDrawer.tsx` 明文記載過的同一個 Radix 受控 Dialog 焦點掉回
     `<body>` 的真實 bug —— `758b358`
  4. 泛化 `poll.ts` 消除 `DecisionApp.tsx` 自己接的那份重複輪詢迴圈
     （見下方 Escalated）—— `ae1ce55`
- **Escalated（1 項，追加成新票並落地）：**
  - **票 05**（spec.md 原本斷言「`poll.ts` 的 `startPolling` 已經是
    泛型函式」是沒查證的錯誤假設，導致 `DecisionApp.tsx` 自己另接一份
    幾乎一樣的輪詢迴圈——這個 repo commit 463343d 那個教訓的同類情況）
    ——status: `done`（`ae1ce55`）
- **票面文字更正（非程式碼缺陷，2 項）：**
  - 票 01/spec.md 對 `poll.ts` 泛型性的錯誤假設
  - 票 03 對 409 狀態碼的錯誤斷言（這個 repo 從沒用過 409，
    `AmbiguousRef`/`AmbiguousDecisionRef` 既有行為都是 404）
- **判定為 false positive、未處理（1 項）：** 票 04 的 review 重申
  「這一批（票 04）」違反語言規則，但這與票 02、03 兩輪 review 已明確
  判定同一寫法合規的結論矛盾，且 CONTEXT.md 規則原文只禁止用「票」
  自我指涉、未禁止括號附註票號——判定為過度延伸，不處理。

### Needs your decision

無——沒有任何票命中五個 hard-stop 分類，circuit breaker 沒有觸發。

### Next steps

- **考慮 push 這個分支並開 PR。** 目前只落在本機的 `decision-studio`
  分支，沒有推到遠端，也還沒開 PR。
- **手動驗證一輪。** 這批大量是 UI，靜態檢查與測試看不到版面對不對——
  建議實際 `nook studio` 打開瀏覽器，跑一次「切視圖→新增→編輯
  disposition→改 supersededBy→展開 history」的完整路徑。
- **`src/studio/poll.ts:174` 附近有一處「這一批（票 05）」少打了
  「這一批」前綴**（只有裸的「（票 05）」），review 判定是措辭不一致
  而非違規，但下次路過可以順手補齊。
- **`src/studio/drawer/IssueDetail.tsx` 頂部有一處 pre-existing 的
  「這一票沒有自動化測試」**，早於這個板子存在，不在任何一張票的寫入
  範圍內，沒有處理——之後若有票會碰這個檔案可以順手修掉。
- **studio assets 相對票 01 之前的基線漲了約 3.9%**（462,218 B →
  480,006 B），距離 786,432 B 的硬指標還有 306,426 B 餘裕，暫不構成
  風險，值得留意的是往後每加一批 UI 都會持續往上疊。
- **`supersededBy` 沒有存在性驗證與連結顯示**——spec.md 明講的
  Non-goals，之後若真的需要更豐富的體驗，屬於獨立的後續。
- Decision 目前在 studio 上仍然沒有 labels／comments／archived-deleted／
  private mode／workspace 整合——同 decision-module 板既有的 Non-goals，
  不是這批的缺口。
