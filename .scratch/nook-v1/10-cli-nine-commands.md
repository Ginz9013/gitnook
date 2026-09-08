# 10 CLI 九個指令

## Outcome

`run(argv, io)` 解析參數、呼叫 `Board`、渲染、回傳 exit code。透過注入的 `Io` 測試，**不 spawn 子行程**。

指令刻意保持薄 —— 複雜度屬於 `Board`。

## Acceptance criteria

**九個指令**

- [ ] `init` — 建立 `.issues/issues/` 與 `.gitattributes` 那一行
- [ ] `new <title>` — 建立票，印出短 ID
- [ ] `list` — 緊湊表格；支援 `--all` / `--status` / `--label` / `--json`
- [ ] `show <ref>` — 詳情
- [ ] `set <ref> <field> <value>` — 更新 `title` / `description` / `status` / `archived`
- [ ] `mv <ref> <status>` — 狀態流轉的捷徑（一張票生命週期會用 4 次以上，因頻率而回本）
- [ ] `comment <ref> <body>` — 新增留言
- [ ] `doctor` — 印出 `health()` 診斷；有問題時 exit code 非 0
- [ ] `studio` — 開 server 並印出 URL

**長文輸入（兩條路都要）**

- [ ] `-` 讀 stdin：`nook set X description - < bug.md` —— agent 的正解，零 shell 跳脫問題
- [ ] `--editor` 開 `$EDITOR` —— 人的正解，`new` 與 `set description` 皆支援；非 TTY 時應報錯而非卡住

**通則**

- [ ] 成功 exit 0，使用者錯誤 exit 1，內部錯誤 exit 2
- [ ] 錯誤訊息寫 stderr，資料寫 stdout
- [ ] `AmbiguousRef` 的訊息列出候選短 ID
- [ ] `.gitattributes` 缺失時 `list` / `show` 印一行警告到 stderr（單點失效需主動監看）
- [ ] `--help` 與 `--version` 可用
- [ ] 未知指令 exit 1 並提示最接近的指令
- [ ] 全部測試透過注入的 `Io` 進行，**不得 spawn 子行程**

## Test seam

`run(argv, io)` —— `Io` 提供 stdout / stderr / stdin / env / cwd 的捕獲用 adapter。

## Write ownership

- `src/cli/run.ts`
- `bin/nook.js`
- `test/cli/run.test.ts`

## Shared resources

暫存目錄（作為 cwd）。`studio` 的測試綁 port 0。

## Blocked by

04, 06, 07, 09

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
