# 01 Workspace 寫入路由核心：locateInWorkspace / memberAt

## Outcome

`locateInWorkspace(workspace, ref)` 能在一組成員 Board 裡找出擁有某個
完整 ULID 的那一個；`memberAt(workspace, path)` 能驗證某個路徑是否真的
屬於這個 workspace。兩者都是純 core、沒有任何指令看得到它們。

## Acceptance criteria

- [ ] `isFullRef()`（`core/ids.ts`）：26 碼合法字元 → true；25 碼或
      27 碼、或含不合法字元 → false
- [ ] `locateInWorkspace()`：
  - [ ] 給一個不是完整 26 碼的 ref（例如短前綴）→ `IncompleteRef`
  - [ ] 三個成員，都不擁有這個 ref → `RefNotFoundInWorkspace`
        （訊息帶出掃過幾個成員）
  - [ ] 三個成員，剛好一個擁有 → 回傳 `{ member, issue }`，`issue` 是
        摺好的完整 Issue（不是只有 id）
  - [ ] 人為造出兩個成員的 `.issues/issues/` 底下放同一個檔名（同一個
        ULID）的 op-log → `AmbiguousWorkspaceRef`（訊息列出兩個成員的
        路徑）
  - [ ] 對一個已刪除的 issue 呼叫 → 正常回傳（`issue.deleted === true`），
        不拋錯——同 `Board.get()` 對已刪 Issue 的既有行為（ADR-0009）
- [ ] `memberAt()`：
  - [ ] 給某個成員底下的子目錄（不是根目錄）→ 正確解析回那個成員
        （沿用 `openBoard()` 向上尋根）
  - [ ] 給一個完全獨立、有 `.issues/` 但不在這個 workspace 掃描範圍內的
        路徑 → `NotAWorkspaceMember`
  - [ ] 給一個完全不是 Board 的路徑 → 既有的 `BoardNotInitialized` 原樣
        冒出（不包裝成新錯誤）
  - [ ] 回傳的是 `workspace.members` 裡既有的那個物件（同一個 `board`
        實例），不是重新 `openBoard()` 開出來的新實例

## Test seam

`locateInWorkspace()`/`memberAt()`（`test/core/workspace.test.ts`，延續
既有檔案），`isFullRef()`（`test/core/ids.prefix.test.ts`，延續既有檔案）。
沿用 ADR-0004：真實 `mkdtemp` 多成員樹，不引入 mock。

## Write ownership

- `src/core/ids.ts`
- `src/core/types.ts`
- `src/core/workspace.ts`
- `test/core/workspace.test.ts`
- `test/core/ids.prefix.test.ts`

**不得碰**：`src/cli/*`——這票純粹是 core，沒有任何指令用到它。

## Shared resources

None。全部在各自獨立的 `mkdtemp` 暫存目錄裡操作。

## Blocked by

None——這是第一張票，沒有共用檔案的前置依賴。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
