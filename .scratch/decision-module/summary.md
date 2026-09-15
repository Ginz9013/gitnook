# Summary — decision-module

### Run metadata

- **Feature slug:** `decision-module`
- **Board:** `.scratch/decision-module/spec.md`
- **Branch:** `adr-module`
- **Start:** 2026-09-15 09:25 (baseline measured: 766 tests / 42 files, 0 型別錯誤)
- **End:** 2026-09-15 11:49
- **Total tickets:** 8（原 7 張 + review 於票 01 落地後追加的票 08）
- **Circuit breaker fired:** no

### Per-ticket table

| Ticket id | Title | Status | Commit sha | Reason |
| --- | --- | --- | --- | --- |
| 01 | Decision 核心地基 + init/new/show | done | `4f5b61a`（+ review 修 `e4d11c9`） | |
| 02 | nook decision list（title list 快速搜尋） | done | `6a46156` | |
| 03 | nook decision set | done | `fca486b` | |
| 04 | nook decision history | done | `35d71c5`（+ review 修 `a60318e`） | |
| 05 | CLI breaking change：nook issue \<verb\> | done | `730bb6b`（+ 整合修 `b6d2a4c` + review 修 `e1e4b20`） | |
| 06 | nook doctor 涵蓋 decisions 的 gitattributes 檢查 | done | `3f784ed` | |
| 08 | nook decision show 改用 compact header + 內文區塊 | done | `aaa70a1` | review 於票 01 落地後追加，非原始板上的票 |
| 07 | 遷移 12 篇既有 ADR 進 Decision Log + 全 repo 引用掃尾 | done | `5bda028`（+ 修 `1e64807` + 測試 `337efac` + 掃尾 `b829bfa`） | unbounded，最後單獨落地 |

`adr-module` 分支相對 `main` 共 23 個 commit（`7e2f06b`…`0a56a9d`），其中 22 個帶 `Ticket: decision-module/NN` trailer（第一個 `7e2f06b` 是規劃階段建板的 commit，早於任何票落地，因此沒有 trailer）——`git log --grep "Ticket: decision-module"` 可重播全部 22 個。

### Review findings

- **Auto-fixed（8 項，全部落地成獨立 commit，不 amend 原票 commit）：**
  1. `supersededBy` 缺形狀驗證 + 一處錯誤交叉引用註解 —— `e4d11c9`（票 01）
  2. `history` 的可查欄位漏掉 `legacyRef`，造成「不指名看得到、指名查不到」的真實不一致 —— `a60318e`（票 04）
  3. AGENT.md 一行漏補 `nook issue` 前綴、CHANGELOG 漏記 `list`/`doctor`、`issue.ts` 模組註解過度宣稱精確度 —— `e1e4b20`（票 05）
  4. 票 05 遺留的三個整合測試斷點（`private-mode.test.ts` 三處呼叫、`packed-smoke.test.ts` 的 `nook()` 呼叫與字面比對、`token-budget.test.ts` 的 `SKILL_DOC`）—— `b6d2a4c`
  5. **decision 指令在打包後的任何錯誤路徑都會炸成 `TypeError` 而非乾淨的 exit 1**（`decision.ts`／`run.ts` 循環 import 在 tsup bundle 裡的求值順序問題，`vitest` 測不出來，只有走 `bin/nook.js` 才踩得到）—— `1e64807`（票 07 dogfood 時發現）
  6. 補一個 packed-smoke 的 decision happy-path 煙霧測試，以及專門鎖住上一項 bug 的迴歸測試（人工還原成修復前版本、重新打包，確認真的轉紅後再確認轉綠）—— `337efac`
  7. `test/**` 裡四處遺漏的 `docs/adr/000X` 失效引用（票 07 的掃尾範圍原本只寫 `src/**` 沒含 `test/**`）—— `b829bfa`
- **Escalated（1 項，追加成新票並落地）：**
  - **票 08**（`nook decision show` 的輸出格式偏離 ADR-0005 的 compact table 慣例）——status: `done`（`aaa70a1`）

### Needs your decision

無——沒有任何票命中五個 hard-stop 分類，circuit breaker 沒有觸發。

### Next steps

- **考慮 push 這個分支並開 PR。** 目前只落在本機的 `adr-module` 分支，沒有推到遠端，也還沒開 PR——這兩件事都刻意留給你決定時機。
- **`nook decision` 目前刻意沒有 labels／comments／archived-deleted／private mode／workspace／studio 整合**——這是 spec.md 明講的 Non-goals，不是遺漏；如果之後想要 Decision 跟 Issue 功能對稱，需要開新的一批。
- **`supersededBy` 沒有存在性驗證**（只驗形狀）——spec.md 的既有風險記錄，等真的痛了再決定要不要加。
- **`.gitattributes` 的 decisions 檢查目前只覆蓋 merge=union 那一行**，不含黏合行／未知 op 的診斷（票 06 的既有範圍），對稱到 Issue 的完整 doctor 覆蓋率是可能的後續。
