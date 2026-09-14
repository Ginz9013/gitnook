# Summary — Workspace（develop-loop 執行紀錄）

## Run metadata

- **Feature slug**: `workspace`
- **Board**: `.scratch/workspace/spec.md`
- **Start**: 2026-09-11 03:03（五張執行票移進 `queued`，commit `a393eb6`）
- **End**: 2026-09-11 04:01（`npm run bench` 六列閘門全綠，commit `74270ab`）
- **Total ticket count**: 6（5 張執行票 + 1 張刻意留在 `backlog` 的 future 票）
- **Circuit breaker fired**: no

## Per-ticket table

| Ticket id | Title | Status | Commit sha | Reason |
| --- | --- | --- | --- | --- |
| workspace/01 | Workspace 核心：遞迴掃描找出全部成員 Board | done | `585e0d7` | |
| workspace/02 | `nook workspace list`：依子專案分組的彙整清單 | done | `967736e` | |
| workspace/03 | `nook workspace doctor`：跨子專案的健康檢查 | done | `80d4375` | |
| workspace/04 | `nook workspace studio`：入口頁 + 點了才啟動的子 studio | done | `4be71e3` | |
| workspace/05 | README 與 AGENT.md 完整交代 Workspace | done | `5f2a997` | |
| workspace/future | Workspace 可寫入 —— 跨 board 的 new/set/mv | skipped | | 規劃階段刻意排除在這次範圍外；留在 `backlog`，沒有設計，等之後另外規劃 |

全部五張執行票都是 `done`：全序鏈（01 → 02 → 03 → 04 → 05）如 spec.md 一開始就講明的，因為 02~05 共用同一個新檔案 `src/cli/workspace.ts`，沒有一輪真正平行過。

## Review findings

每一張票的兩軸 review 都在 commit 之後、對著那次的 base sha 跑。全部發現都是小型、當場修掉，沒有一條被升級成新票：

- **票 01**：`hasBoard()` 與 `findBoardRoot()` 各自重寫一份 `.issues/issues` 判斷（已抽出 `ISSUES_DIR` 共用）；`entry.isSymbolicLink()` 是死碼加誤導註解（`Dirent` 是 lstat 語意，前一行已經擋掉symlink）——實測驗證後修正。Fix commit：`722ff9b`。
- **票 02**：`renderSetOps` 的既有註解被新程式碼夾在中間、掛到錯的函式上；未知子指令繞過 `UsageError` 這條唯一路徑；`shortIdLength(refs())` 重算了一次違反 ADR-0006。三條都修。另外：worker 誠實揭露 `--status`/`--label`/`--json` 的斷言不是乾淨的逐條 red-green（先寫完實作才補測試），改用突變測試補證據，整合者讀過測試內容後判斷為可信、採計 done。Fix commit：`2a869cf`。
- **票 03**：`formatDiagnostic`/`formatRepaired` 的措辭在 run.ts 單一 board 版本裡重打了一次（已抽共用）；`label`/`path` 命名不一致（統一）；**真的抓到一個沒被測到的邊界**——workspace 根目錄自己是成員時，diagnostic 行原本印一個孤零零的「.」，讀起來像 workspace 工具自己的問題，補上 `doctorLabel()` 特判與測試。三條在第一次 commit 前就收掉，沒有另外的 fixup commit。
- **票 04**：`/launch/<n>` 的 `.then()` 沒有搭配 `.catch()`——`serve()` 不是全函數，`EMFILE`/`EACCES` 這類例外會變成沒人接的 rejection、拖垮整個 landing process。已補上錯誤分支（記 stderr、回 500），沒有為此另外寫測試（穩定重現需要真的耗盡 fd，跟 ADR-0004 的「測真實 fs/server」衝突）。Fix commit：`4be71e3`（與實作同一個 commit）。
- **票 05**（文件）：AGENT.md 指令表把 `workspace` 收成 `list|doctor|studio`（跟票 02 HELP 那行同一個 token 預算取捨，接受）；README 結尾重複列了整份單一 board 指令表，比兄弟章節囉唆，已收短。Fix commit：`5091bc5`。

**Escalated：無。** 沒有任何一條發現大到需要升級成新票。

## Needs your decision

沒有任何票撞到 hard-stop 分類，這次全部順利落地，沒有需要你做的決定。

**唯一值得留意的一件事（非 hard-stop，是流程觀察）**：票 01 的第一次 worker 執行時，工作樹裡出現了 8 張已完成的 private-mode 舊票被加上 `archived: true` 的 op——不在那張票的寫入範圍內，也沒有人授權。已經在 commit 之前用 `git restore` 撤掉，沒有進任何 commit，對這個 repo 的 board 沒有留下任何痕跡。後續每一次派工都在委派封包裡加了明確的「不要對這個 repo 自己的 `.issues/` 跑 nook CLI」提醒，之後三票都沒有再發生。記在這裡純粹是留紀錄，不是要你做什麼決定。

## Next steps

- `npm run bench` 六列閘門全綠（package size / studio assets / cold start / **cli bundle 0 markers** / concurrent merge / agent token），`src/cli/workspace.ts` 確認沒有把 studio/React 拖進 CLI 冷啟路徑。
- 全部 42 個測試檔、723 個測試綠，`tsc --noEmit` 0 錯誤，工作樹乾淨。
- 若要開始規劃「Workspace 可寫入」（`01M26B2MARRQ7DACJSCW89YJ0D`，目前在 `backlog`），那是一次新的 `plan` 循環——這次的 spec.md 已經把「一個 Change 該落在哪個成員 board」列為那個未來規劃要解決的核心問題。
- 分支 `monorepo-mode` 目前領先 `main` 五張票的實作 + 這份規劃/收尾紀錄，尚未合併、尚未 push——是否要開 PR 或合併回 `main`，由你決定。
