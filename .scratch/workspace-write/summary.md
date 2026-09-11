# Summary — Workspace 可寫入（develop-loop 執行紀錄）

## Run metadata

- **Feature slug**: `workspace-write`
- **Board**: `.scratch/workspace-write/spec.md`
- **Start**: 2026-09-11 11:58（票 01 第一個 commit `d75026f`）
- **End**: 2026-09-11 12:56（`npm run bench` 六列閘門全綠，收掉舊的 future
  佔位票，commit `f8f174a`）
- **Total ticket count**: 8（全部執行票；另有一張舊的 `backlog` 佔位票
  `01M26B2MARRQ7DACJSCW89YJ0D` 在收尾時一併關閉，不算在這 8 張裡）
- **Circuit breaker fired**: no

## Per-ticket table

| Ticket id | Title | Status | Commit sha | Reason |
| --- | --- | --- | --- | --- |
| workspace-write/01 | locateInWorkspace / memberAt——寫入路由核心 | done | `d75026f` | |
| workspace-write/02 | `nook workspace new --in <path>` | done | `37b5ae8` | |
| workspace-write/03 | `nook workspace set` | done | `d69701c` | 第一次嘗試 unverified 被 quarantine（見下）；`d69701c` 是第二次嘗試的落地 commit |
| workspace-write/04 | `nook workspace mv` | done | `0667ef9` | |
| workspace-write/05 | `nook workspace comment` | done | `4b39879` | |
| workspace-write/06 | `nook workspace label` | done | `5d58f16` | |
| workspace-write/07 | `nook workspace rm` | done | `e08d483` | |
| workspace-write/08 | README/AGENT.md 文件 | done | `ccf2ed9` | |

全部八張票都是 `done`。除了票 01（純 core，無共用檔案）之外，02→08 因共用
`src/cli/workspace.ts`（部分也共用 `src/cli/run.ts` 的漸進匯出）是一條全序
鏈，如 spec.md 一開始就講明的——沒有一輪真正平行過，這是誠實反映而非規劃
缺陷。

## 特別事件：票 03 第一次嘗試被 quarantine

票 03 的第一次 worker 執行回報 `Status: unverified`——它自己誠實揭露只有
「缺 `set` 子指令」這一片有真的紅燈，其餘驗收條件都是先寫完整支
`cmdSet` 才補測試、第一次跑就綠，沒有真正的紅綠證據。develop-loop 的
既定政策把這種情況當 `blocked` 處理（不是整合者自己判斷要不要放行），
所以：

1. 用 `git stash` 撤掉那次的變更（沒有進任何 commit）
2. 標記票 03 為 `blocked`，記錄原因
3. 重新派工，這次在委派封包裡明講「一次一個行為、每一條驗收條件都要有
   自己的真紅燈，第一次跑就綠的要暫時弄壞邏輯逼出證據」
4. 第二次嘗試完全達標，落地為 `d69701c`

這個事件之後，票 04~08 的委派封包都延續了「每一條驗收條件都要有真紅燈」
的明確要求，且全部一次到位，沒有再發生同樣的情況。

## Review findings

每一張票的兩軸 review 都在 commit 之後、對著那次的 base sha 跑。全部發現
都是小型、當場修掉，沒有一條被升級成新票：

- **票 01**：`locateInWorkspace` 只接 `RefNotFound` 繼續下一個成員的設計
  依賴一個沒寫出來的不變量（完整 ULID 讓單一成員內的 `resolvePrefix()`
  退化成相等比對）——補上註解讓假設不再隱藏。
- **票 02**：`cmdNew`（workspace 版）整段複製了單一 Board 版本的
  `CreateInput` 組裝邏輯，跟同一支 diff 才剛建立的「匯出共用函式」慣例
  不一致——抽成 `assembleCreateInput()`，兩邊共用。
- **票 03**：（見上面「特別事件」）第二次落地後兩軸 review 乾淨，只有
  一條「`cmdSet` 跟單一 Board 版本控制流程幾乎一樣」的觀察，判定為可接受
  的判斷（兩條路徑的錯誤處理確實不同），留著觀察後續票會不會累積成問題。
- **票 04**：兩軸 review 都乾淨，無發現。
- **票 05**：少了 `set`/`mv` 兩個兄弟指令都有的
  「找不到 → `RefNotFoundInWorkspace`」測試——已補上。
- **票 06**：兩軸 review 都乾淨；這次一開始就把 `RefNotFoundInWorkspace`
  測試寫齊，沒有重演票 05 事後才補的狀況。
- **票 07**：兩條——(1) 成功刪除的輸出印了使用者輸入的 `ref` 原文而非
  正規化後的 `issue.id`（ref 大小寫不敏感，跟單一 Board `cmdRm` 的既有
  行為不一致）——已修正；(2) `core/types.js` 被拆成三行 import——合併
  成一行。
- **票 08**（文件）：「cross-repo read」當名詞讀起來卡，跟旁邊 `history`
  那一行「read-only」的形容詞寫法不一致——改回「cross-repo, read-only」。

**Escalated：無。** 沒有任何一條發現大到需要升級成新票（票 03 那次是流程
問題被 quarantine 重做，不是 review escalation）。

## Needs your decision

沒有任何票撞到 hard-stop 分類，全部順利落地，沒有需要你做的決定。

## Next steps

- `npm run bench` 六列閘門全綠（package size / studio assets / cold start /
  cli bundle 0 markers / concurrent merge / agent token），確認寫入指令沒有
  把任何重東西拖進 CLI 冷啟路徑。
- 全部 42 個測試檔、766 個測試綠，`tsc --noEmit` 0 錯誤，工作樹乾淨。
- 舊的 `01M26B2MARRQ7DACJSCW89YJ0D`（future 佔位票）已經在這次收尾時
  一併關閉。
- `nook workspace` 現在有完整的九個子指令（三個唯讀 + 六個寫入）。如果
  之後還想擴充（例如 workspace 版的 `history`/`show`，或跨成員的批次
  操作），那是下一輪新的 `plan` 循環。
- 分支 `monorepo-mode` 目前累積了兩輪 Workspace 功能（唯讀彙整 + 這次的
  寫入路由）的完整實作，尚未合併回 `main`、尚未 push——是否要開 PR 或
  合併，由你決定。
