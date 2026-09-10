# 01 `nook init --private` 建出一塊 private board

nook ref：`01M2520XC9J1C0R96GFSAD3ZCK`

## Outcome

在一個乾淨的 git repo 裡 `nook init --private`，得到一塊可用的 board，而
`git status --porcelain` 是空的 —— **zero committed bytes**。這是這一批的
tracer bullet：它一次把新模組、`initBoard` 的第二條路徑、CLI 旗標與輸出
全部打通到可觀察為止。

## Acceptance criteria

- [ ] `nook init --private` 建出 `.issues/issues/`，並把
      `/.issues/` 冪等寫進 `$GIT_DIR/info/exclude`
- [ ] **完全不碰 `.gitattributes`**：原本不存在就不會被建出來；原本存在就
      一個 byte 都沒變（含既有的 conflicting 規則 —— 那條規則在這個模式下
      無意義，不得因此報錯）
- [ ] 之後 `git status --porcelain` 是空的，`git ls-files .issues` 是空的
- [ ] `nook new` → `nook list` 在這塊 board 上照常工作
- [ ] **linked worktree**：在 `git worktree add` 出來的工作目錄裡
      `init --private`，規則要寫進**共用**的 `info/exclude`（`.git` 在那裡是
      一個檔案，且 linked worktree 的 `$GIT_DIR` 還要再讀 `commondir` 才
      找得到它）。實測基準：`git rev-parse --git-path info/exclude` 指向
      common dir，而 `git check-ignore` 在 worktree 內確實吃到那條規則
- [ ] board 不在 work tree 頂端時（repo 根目錄以外的子目錄），寫進去的 pattern
      是 `/<相對路徑>/.issues/` 而不是 `/.issues/`，且 `git check-ignore` 確認
      它真的生效
- [ ] 重跑一次是冪等的：規則不會被寫成兩行，且輸出說得出這次什麼都沒做
      （沿用票 05「init 說話、doctor 沉默」的三分法）
- [ ] 輸出至少講出一條代價：`git clean -xdf` 會把整塊 board 刪掉、沒有備份
- [ ] 既有的 `nook init`（不帶旗標）行為與輸出**一字不變**

## Test seam

- `initBoard(dir, { sharing: 'private' })` 與 `inspectSharing(root)`：
  `test/integration/private-mode.test.ts`（新檔，真實 git repo 與真實 linked
  worktree，一律 `mkdtemp`，照 `test/core/health.test.ts` 的 `gitInit()` 形狀
  只設 local 設定）
- CLI 旗標與輸出：`run(argv, io)` + 注入的 `Io`，照 `test/cli/run.test.ts`
  既有的 init 測試形狀加

## 實作筆記

`inspectSharing` **只比對 nook 自己寫的那一整行**，不實作 gitignore 的 pattern
與優先序規則 —— 它要被 list / show 每次呼叫，**不准 spawn 任何子行程**。
這一條是刻意的窄，理由寫在 spec.md 的 Design contract，不要「順手」做成通用
的 pattern 比對。

## Write ownership

- `src/core/sharing.ts`（新）
- `src/core/gitattributes.ts`
- `src/cli/run.ts`
- `test/integration/private-mode.test.ts`（新）
- `test/cli/run.test.ts`

**不得碰**：`src/core/health.ts`（票 04）、`src/index.ts`（票 02）、
`src/studio/**`（票 05）、`README.md` / `AGENT.md` / `CONTEXT.md` / `docs/adr/**`
（票 06、07）。

這一票**只做快樂路徑**。「已共享的 board 上 `--private`」與「不在 git repo 內」
兩條拒絕是票 02 —— 在它落地之前，`initBoard` 的 private 路徑確實還擋不住那兩種
輸入，這是刻意的切法，不是漏掉。

## Shared resources

`mkdtemp` 出來的暫存目錄與暫存 git repo。**不得寫入這個 repo 的 `.issues/`**，
也不得對這個 repo 跑 `init --private`。不要跑 `npx tsup` 或 `npm run bench`。

## Blocked by

None.

## Status

todo
