# private mode —— 執行摘要

## Run metadata

- **Feature slug**：`private-mode`
- **Board**：`.scratch/private-mode/spec.md`
- **Branch**：`private-mode`（板子的起點 `d9f511b`）
- **開始 / 結束**：2026-09-10 15:0x – 16:5x
- **票數**：起跑時 7 張，執行中 review 追加 1 張（票 08，未授權）
- **Circuit breaker 觸發**：否（零次硬停）

## 每張票

| 票 | 標題 | 狀態 | commit | 備註 |
|---|---|---|---|---|
| 01 | `init --private` 建出一塊 private board | done | `94fa7d9` + `3ce3146` | 修補：`hasLine` 的左右不對稱、拒絕排在 mkdir 之前 |
| 02 | `init --private` 的兩條拒絕 | done | `26dd976` + `980c15f` | 修補：`opLogsTracked` 收窄、改用 exit code、catch 收窄 |
| 03 | list / show 在 private board 上不再警告 | done | `b88b0f3` | |
| 04 | doctor 在 private board 上沉默 | done | `4d84ecf` | |
| 05 | doctor 說出 fs 與 git 不一致的兩種狀態 | done | `eda9006` + `502ae5b` | 修補：`ignoredByGit` 改問存在的 op-log 並搬上介面、studio 的窮盡表 |
| 06 | `nook share` 的升級路徑 | done | `820ec85` + `2421faf` | 修補：不印不冪等的 `git commit`、不先承諾再收回、拒收位置引數 |
| 07 | README、CONTEXT.md 詞彙與 ADR-0011 | done | `fee651b` | 由 `2421faf` 跟上 share 改掉的輸出 |
| 08 | exclude 規則必須是字面路徑，不是 glob | **backlog（未授權）** | — | review 追加；`queued` 是人給的授權，實作輪不自己發 |

其他 commit：`939bbe9`（票移進 queued）、`f2c940a`（派工前的板子修正）、`74bd9d2`（handler.ts 的成本註解）、以及三筆收票的 bookkeeping。

## Review findings

八次 review（四輪 × 兩軸），零次硬停。**auto-fixed** 的都寫在上表的「備註」欄，每一條都以 mutation 確認新斷言咬得到。最值得記的四條：

1. **`hasLine` 用 `trim()` 比對是靜默失敗**（票 01）。git 對那一行的兩側規則不對稱 —— 實測 `/.issues/␠␠␠` 與 `/.issues/\r` 照樣生效，`␠/.issues/` 與 `\t/.issues/` 不生效。收左側會讓 `inspectSharing` 答 private 而 `excludeBoard` 答 unchanged，使用者永遠等不到一條生效的規則。
2. **一個布林在回答兩個問題**（票 02→04）。`opLogsTracked` 問整個 `.issues/` 對 init 的拒絕是保守的，但 doctor 拿它當否決權，寬一格就變假陽性（一個被 commit 的 `.gitkeep` 會讓健康的 private board 吐診斷）。已收窄成 op-log 那個目錄。
3. **問目錄會漏報**（票 05）。`.gitignore` 是 `*.ndjson` 時，問 `.issues/issues` 沒命中、問一個存在的 op-log 才命中；反過來拿不存在的檔名去問，會在 `git add -f` 過的 board 上假警報。只有「存在的檔案」兩邊都對。
4. **`git commit` 不是冪等的**（票 06）。已 commit 的 board 上照樣印那兩行，會把使用者手上沒 commit 的 issue 編輯掃進一個謊報的訊息底下。

**escalated**：票 08（`boardPattern` 沒有轉義 gitignore 的 metacharacter），留在 backlog。

## 需要你決定的

沒有票因為五類硬停而卡住。兩件事等你決定：

1. **票 08 要不要做** —— 它在 backlog，把它移進 `queued` 就會被撿走。
2. **`.scratch` 那條「worker 不准跑 `npm run bench`」的約定在這個 repo 做不到** —— `test/integration/packed-smoke.test.ts` 自己會 `spawnSync('npm', ['run', 'bench'])`，所以每一次 `npx vitest run` 都連帶跑了 bench（走 `npm pack` → `prepack` → 重建 `dist/`）。要嘛把那條約定改成「跑 suite 時 `--exclude packed-smoke`」，要嘛承認 suite 會重建 dist。

## 硬指標（最後一次 `npm run bench`）

| metric | actual | limit |
|---|---|---|
| package size | 640,154 B | 3,145,728 B |
| studio assets | 441,497 B | 786,432 B |
| cold start | 25.8 ms | 500 ms |
| cli bundle | 0 markers | 0 |
| concurrent merge | 0 conflicts | 0 |
| agent token | 4,102 B | 4,608 B |

測試 **681 passed / 39 files**（基線 615 / 38），`tsc --noEmit` 0 錯誤。

## 下一步

- 決定票 08。
- `git log --grep "Ticket: private-mode/"` 可以依落地順序重播整塊板子。
- 這個分支還沒 push、也還沒開 PR —— 那需要你明說。
