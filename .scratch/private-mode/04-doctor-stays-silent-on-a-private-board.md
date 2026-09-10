# 04 private board 上 doctor 沉默

nook ref：`01M2521MV5WCSGCRW45G7J213T`

## Outcome

`diagnose()` 在一塊健康的 private board 上回傳空清單，`nook doctor` exit 0、
一個字都不印。零衝突保證在 private board 上是**不需要**，不是缺少 —— 被 ignore
的 op-log 永遠不會 merge，所以那條 Diagnostic 在這裡不是被壓掉的真問題，是一個
不存在的問題。

`doctor` 會進 CI，所以這裡的正確行為是沉默，不是換一句溫和的提醒。

## Acceptance criteria

- [ ] 健康的 private board：`diagnose(dir)` 回傳 `[]`，`nook doctor` exit 0
      且無輸出
- [ ] private board 上**其餘檢查照舊**：黏合行、未知 op、`NotAGitRepo` 都還在，
      而且 `doctor --fix` 照樣修得動黏合行
- [ ] shared board 的行為**一字不變**（缺 MERGE_RULE 照報、conflicting 的那行
      照報）
- [ ] 壓制的條件是「private **且** op-log 沒有被 tracked」。兩者都成立才沉默 ——
      只靠 `inspectSharing` 就閉嘴會在「exclude 規則在、檔案卻被 `git add -f`
      進去了」時漏掉一個真問題（那一種狀態由票 05 負責說話）
- [ ] private board 多出來的 `git ls-files` 只在 `diagnose()` 裡 spawn。
      `diagnose` 本來就會 spawn 一個 `git rev-parse`，不得讓它進入任何讀取指令
      的路徑

## Test seam

`diagnose(dir)` 直接呼叫（`test/core/health.test.ts` 已經建真實 git repo，
照它的 `gitInit()` 形狀加），必要時同檔再加一例從 `openBoard().health()` 進去，
確認 `doctor` 走的那一條也成立。

## Write ownership

- `src/core/health.ts`
- `test/core/health.test.ts`

**不得碰**：`src/core/types.ts`（新 Diagnostic kind 是票 05）、
`src/core/sharing.ts` / `gitattributes.ts` / `run.ts`（票 02 同批）、
`src/studio/**`（票 05）。

## Shared resources

暫存 git repo。不得寫入這個 repo 的 `.issues/`。

## Blocked by

票 01（要有 `sharing.ts` 才問得出 Sharing）。

## Status

todo
