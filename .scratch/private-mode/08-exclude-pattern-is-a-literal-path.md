# 08 exclude 規則必須是字面路徑，而且沒生效時要有人說話

nook ref：`01M253VVADQTA9RRCR0081CSEA`

> **Review 追加（2026-09-10），使用者於同日授權執行。** 派工前把範圍從「轉義」
> 擴成兩片 —— 見下面的實測。

## Outcome

`boardPattern()` 把 board 的相對路徑直接拼進 gitignore pattern，**沒有轉義
metacharacter**。實測（git 2.50.1，board 在 `apps/[id]/` —— Next.js 動態路由的
目錄名）：

```
$ nook init --private
Ignored  .issues/  $GIT_DIR/info/exclude（這塊 board 不會被 commit）
$ grep issues .git/info/exclude      →  /apps/[id]/.issues/
$ git check-ignore -q .issues/issues →  沒有命中
$ git status --porcelain             →  ?? apps/         ← board 在 git 眼前
$ nook list 2>stderr                 →  stderr 0 bytes   ← 不警告
$ nook doctor                        →  0 bytes, exit 0  ← 說一切正常
```

**三個面都沉默，而 board 其實整塊進得了 git。** 使用者以為零 committed bytes，
下一次 `git add -A` 就把整塊 board 推給全隊。這是 private mode 目前唯一一種
沒有任何東西在看的失敗。

所以這一票有兩片，而**第二片才是值錢的那一半**：轉義只修掉我們想得到的成因，
doctor 的檢查抓的是整個類別。

## 片 1：寫出去與讀回來都是字面路徑

- [ ] board 路徑含 `*`、`?`、`[`、`]` 時，寫進 `info/exclude` 的規則以 `\` 轉義，
      且 `git check-ignore` 確認它只比對那一個目錄。實測基準：`/a[b]/.issues/`
      **不**命中、`/a\[b\]/.issues/` 命中，而後者正是 `git check-ignore -v`
      自己回寫的形狀
- [ ] 路徑含**尾端空白**的那一段也要轉義（git 會吃掉未轉義的尾端空白 —— 這與
      票 01 修掉的 `hasLine` 是同一件事的另一半：寫出去的與讀回來的必須是同一條
      規則）
- [ ] `inspectSharing` / `unexcludeBoard` 的整行比對在轉義後仍然一致 ——
      **寫什麼就認什麼**。`matchesExcludeRule` 的左右不對稱不得被動到
- [ ] 路徑以 `#` 或 `!` 開頭的那一段：那兩個字元只在**行首**有特殊意義，而我們
      寫的行以 `/` 開頭，所以推論上安全 —— **以真實 git 驗證這個推論**，不要靠
      記憶跳過
- [ ] 既有行為不變：不含 metacharacter 的路徑寫出來的那一行與現在一字不差
      （既有測試全綠就是這一條）

## 片 2：doctor 說出「fs 說 private、git 說沒 ignore」

- [ ] `diagnose()` 在這個狀態回報 `SharingMismatch`（沿用票 05 的 kind，第三種
      訊息），訊息要說清楚後果：**這塊 board 進得了 git，下一次 `git add -A`
      就會把它推出去**
- [ ] 下一步是 `nook init --private`（重寫那條規則），因為片 1 之後它就會寫出
      一條生效的規則 —— 訊息要講出來
- [ ] 健康的 private board 與健康的 shared board 都**不得**冒出這一條
- [ ] 這條檢查用已經在 `sharing.ts` 上的 `ignoredByGit`，**不得再抄一份子行程或
      解析**。目前它只在 fs 說 shared 時被問，這一片讓 fs 說 private 時也問
- [ ] **成本要守住**：多出來的 `git check-ignore` 只在 `diagnose()` 裡 spawn，
      絕不得進入讀取熱路徑（`list` / `show` 唯一的問法仍是純 fs 的
      `inspectSharing`，有 PATH 探針在守）
- [ ] studio 的 `boardAlerts()` 不必改 —— 沿用票 05 的 kind 就沿用它那一格
      （`ADVICE` 是窮盡表，多一個 kind 才會讓 tsc 變紅；這一片沒有多）

## Test seam

`excludeBoard` / `inspectSharing` / `unexcludeBoard` + 真實 `git check-ignore`
（`test/integration/private-mode.test.ts`），以及 `diagnose(dir)`
（`test/core/health.test.ts`，那裡已經有 `gitInit()` 與兩種 mismatch 的形狀可循）。

## Write ownership

- `src/core/sharing.ts`
- `src/core/health.ts`
- `test/integration/private-mode.test.ts`
- `test/core/health.test.ts`

**不得碰**：`src/cli/run.ts`、`src/core/types.ts`（不新增 kind）、`src/studio/**`、
`README.md`、`AGENT.md`、`CONTEXT.md`、`docs/adr/**`。文件面若需要補一句，回報
給整合者，不要自己開新的一張。

## Shared resources

暫存 git repo（`mkdtemp`）。**不得寫入這個 repo 的 `.issues/`**。目錄名含
`[`、`]`、`*` 的暫存目錄要記得引號包起來。

## Blocked by

票 01–07（全部已完成）。

## Status

queued（使用者於 2026-09-10 授權）
