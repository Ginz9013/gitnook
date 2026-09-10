# 06 `nook share`：private → shared 的升級路徑

nook ref：`01M2522HSAVW53NB2YG5M5HXYE`

## Outcome

試用完、或團隊同意了之後，一條指令把 private board 變回共享的：移除 exclude
規則、補上 `merge=union`，然後**把該跑的 `git add` 印出來給使用者自己跑**。

nook 目前沒有任何一個會寫入的 git 指令，這一票不得破這個邊界。

## Acceptance criteria

- [ ] private board 上 `nook share`：從 `$GIT_DIR/info/exclude` 移除 nook 寫的
      那一行（只移除那一行，其餘內容與順序不動）、冪等補上
      `.issues/issues/*.ndjson merge=union`
- [ ] 印出使用者自己要跑的指令（`git add .issues .gitattributes` 與一次 commit），
      並說清楚 nook 不會替他執行
- [ ] 已經是 shared 的 board 上是個**說得出話的 no-op**，exit 0 —— 沉默會與
      成功長得一樣，而使用者問的正是「這次到底有沒有動到東西」
      （同票 05「init 說話」的理由）
- [ ] 移除規則之後 git **仍然**說那些檔案被 ignore 時（例如 committed
      `.gitignore` 也有一條），說出是哪個檔案第幾行在擋，並且**不要**假裝成功 ——
      這時 `git add` 會失敗，而使用者需要的是那條規則的位置。
      **`ignoredByGit(root)` 已經在 `src/core/sharing.ts` 上**（票 05 的 review
      修補 502ae5b 把它搬上介面），回傳 `{ ignored, source }`，`source` 就是
      `git check-ignore -v` 給的 `<file>:<line>:<pattern>` 原文 —— 直接用它，
      不得再抄一份子行程或解析
- [ ] `.gitattributes` 有衝突規則時照樣丟 `ConflictingGitAttributes`
      （exit 1）—— 不靜默改變別人的 merge 設定，這條在 shared 模式下回來生效
- [ ] 不是一塊 board 的目錄上 exit 1，訊息是「不是一個 Nook board」
- [ ] `share` 進 `HELP` 的指令表與 `COMMANDS`（打錯字的建議清單）
- [ ] `share` 也寫進 `AGENT.md`（反引號包起來的 `` `nook share` ``）——
      `test/agent-doc.test.ts` 把 HELP 與 AGENT.md 釘在一起，**只改一邊會讓
      測試變紅**
- [ ] 順手把 AGENT.md 那句「那個警告永遠不是雜訊」改成在 private board 上
      不適用，並交代 agent 不該自己決定 Sharing（要不要 private 是人的決定）

## Test seam

`run(['share'], io)` + 注入的 `Io`（`test/cli/run.test.ts`），以及
`unexcludeBoard` 在真實 repo 上的效果（`test/integration/private-mode.test.ts`）。
`test/agent-doc.test.ts` 不必改 —— 它是那條釘子，讓它自己驗。

## Write ownership

- `src/cli/run.ts`
- `src/core/sharing.ts`
- `AGENT.md`
- `test/cli/run.test.ts`
- `test/integration/private-mode.test.ts`

**不得碰**：`README.md` / `CONTEXT.md` / `docs/adr/**`（票 07 同批）、
`src/core/health.ts`、`src/studio/**`。

## Shared resources

暫存 git repo。**不得對這個 repo 跑 `nook share` 或 `git rm --cached`。**

## Blocked by

票 01、票 03（同一個 `src/cli/run.ts` 與 `src/core/sharing.ts`）。

## Status

done —— commit 820ec85（實作）+ 2421faf（兩軸 review 的修補）
