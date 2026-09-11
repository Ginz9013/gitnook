# 02 `nook workspace new --in <path>`

## Outcome

在母資料夾底下，`nook workspace new <title> --in <path>` 能把一張新
issue 建到 `<path>` 所屬的那個成員 Board 裡，不必先 `cd` 進去。

## Acceptance criteria

- [ ] `--in <path>` 指向某個成員的根目錄，或它底下任何子目錄，都能成功
      建立；印出的是完整 26 碼 ULID（同單一 Board `nook new` 的既有慣例）
- [ ] 缺少 `--in` → `UsageError`，訊息講清楚用法
- [ ] `--in` 指向一個 workspace 掃描範圍外的路徑（即使那裡真的有一塊
      Board）→ `NotAWorkspaceMember`
- [ ] `--description`/`--label`/`--editor` 語意與單一 Board `nook new`
      完全一致（含 `--editor` 非 TTY 時報錯的既有規則）
- [ ] 建立之後只有目標成員的 `.issues/` 有變化，其餘成員完全不受影響

## Test seam

`dispatchWorkspace(['new', ...], io)`（`test/cli/workspace.test.ts`，延續
既有檔案），真實 `mkdtemp` 多成員樹。

## Write ownership

- `src/cli/run.ts`（把 `fromEditor`、`longText`、`STDIN` 加上 `export`；
  `USER_ERRORS` 加入 `NotAWorkspaceMember`）
- `src/cli/workspace.ts`（延續既有檔案，新增 `new` 子指令）
- `test/cli/workspace.test.ts`（延續既有檔案）

**不得碰**：`src/core/*`（票 01 已定案的介面）、`src/render/*`、
`src/server/*`。

## Shared resources

None。

## Blocked by

票 01（`memberAt()`/`NotAWorkspaceMember` 必須先存在）。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
