# 02 `init --private` 的兩條拒絕

nook ref：`01M2521MRT22FMA2EPF3Y7J963`

## Outcome

兩種「照做會騙人」的輸入，變成說得出解法的 exit 1：op-log 已經被 git 追蹤
（這塊 board 已經共享了），以及根本不在 git work tree 內。

第一條的理由是**靜默失敗**：tracked 勝過 ignore 規則（實測：tracked 的路徑
`git check-ignore` 預設回報 not ignored，因為它會查 index），所以照寫 exclude
規則會是一個完全沒有效果的動作，而使用者會以為成功了。

## Acceptance criteria

- [ ] op-log 已被 tracked 時 `init --private` exit 1，且**什麼都沒寫**
      （沒有新目錄、`info/exclude` 沒有多一行）
- [ ] 那句訊息要講出解法：`git rm -r --cached .issues` 由使用者自己跑 ——
      nook 不替他執行任何會寫入的 git 指令
- [ ] 不在 git work tree 內時 exit 1，訊息叫人直接 `nook init`（沒有 git 就
      沒有共享可言，也就沒有 private 可言）
- [ ] 兩個錯誤型別都進 `USER_ERRORS`（exit 1，不是 exit 2 的內部錯誤）
- [ ] 兩個錯誤型別都上 `src/index.ts` 的公開面，並更新 `test/index.test.ts`
      釘住的那份清單 —— `initBoard` 是公開的，它會丟的東西呼叫端必須
      `instanceof` 得到（同 `ConflictingGitAttributes` / `NestedBoard` 的理由）
- [ ] 判斷「已被 tracked」走 `git ls-files`，**只在 init 這條路徑上 spawn**

## Test seam

`initBoard(dir, { sharing: 'private' })` 丟出的錯誤型別，以及
`run(['init','--private'], io)` 的 exit code 與 stderr。
`test/integration/private-mode.test.ts`（票 01 建的檔）與 `test/index.test.ts`。

## Write ownership

- `src/core/sharing.ts`
- `src/core/gitattributes.ts`
- `src/cli/run.ts`
- `src/index.ts`
- `test/index.test.ts`
- `test/integration/private-mode.test.ts`

**不得碰**：`src/core/health.ts`（票 04 同批）、`test/cli/run.test.ts`
（票 03 同批之後會動它；這一票的 CLI 行為測在 integration 檔裡）。

## Shared resources

同票 01。暫存 git repo；不得寫入這個 repo 的 `.issues/`。

## Blocked by

票 01（同樣動 `sharing.ts` / `gitattributes.ts` / `run.ts`）。

## Status

todo
