# 03 private board 上 list / show 不再警告

nook ref：`01M2521MT2EBQHSJFH14MGQT1Q`

## Outcome

`warnIfUnguarded` 在 private board 上閉嘴。沒有這一票，private mode 會在
**每一次** `list` / `show` 噴「缺少 merge=union」—— 一句在這個模式下是錯的話，
而且會教使用者學會忽略警告。

## Acceptance criteria

- [ ] private board 上 `nook list` / `nook show` 的 **stderr 是空的**
- [ ] shared board 上那句警告**一字不變**（缺 MERGE_RULE 時照噴、有就不噴）
- [ ] 判斷只走 `inspectSharing`，**不 spawn 任何子行程** —— `src/cli/run.ts`
      的 `boardDir` 與 `warnIfUnguarded` 既有註解把「list 不 spawn git」當成
      承諾在守，這一票不得破它。新增成本上限是一次 `existsSync` 加一個小檔
      的讀取
- [ ] 成本問的是 board 根目錄那一塊（`boardDir(io)`），不是 `io.cwd` ——
      在子目錄執行時答案必須一樣

## Test seam

`run(argv, io)` + 注入的 `Io`，分別捕獲 stdout 與 stderr。
`test/cli/run.test.ts`。

## Write ownership

- `src/cli/run.ts`
- `test/cli/run.test.ts`

**不得碰**：`src/core/**`（票 01、02、04、05 已經／正在定案它們）、任何文件。

## Shared resources

暫存 git repo。不得寫入這個 repo 的 `.issues/`。

## Blocked by

票 01、票 02（同一個 `src/cli/run.ts`）。

## Status

todo
