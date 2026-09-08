# 15 board 尋根

## Outcome

在 repo 的任何子目錄執行 `nook` 都能找到同一塊 board。目前**不能**，而且錯誤訊息主動把使用者導向一個靜默分裂 board 的操作。

## 背景（實測）

```
$ cd src/deep && nook list
不是一個 Nook board：.../src/deep（先執行 nook init）

$ nook init          ← 照它說的做
（靜默成功）

$ find . -name .issues
./.issues
./src/deep/.issues   ← board 被無聲切成兩個
```

`openBoard({ dir })` 只看該目錄。這是**資料完整性問題**，不只是便利性 —— 兩個 board 各自累積 Issue，而且沒有任何東西會提示。

## Acceptance criteria

- [ ] `openBoard({ dir })` 由 `dir` 向上尋找最近的 `.issues/issues/`，找到就用它（git 的行為）
- [ ] 找不到時仍拋 `BoardNotInitialized`，但訊息要指出**搜尋過的範圍**，不能只說「先執行 nook init」
- [ ] 尋根在 filesystem root 或 git repo 根目錄停止（擇一並在註解說明理由）
- [ ] `initBoard(dir)` 在**既有 board 的子目錄**中被呼叫時**拒絕並報錯**，指出既有 board 的位置。不得靜默建立第二個
- [ ] 已在 board 根目錄重複 `init` 仍然是冪等的（既有行為，不得破壞）
- [ ] 測試涵蓋：深層子目錄的 `list`/`show`/`new` 都作用在同一塊 board
- [ ] `list` 在子目錄執行時，回傳的 Issue 與在根目錄執行時**完全相同**

## Test seam

`openBoard()` 與 `initBoard()`，真實檔案系統 + `mkdtemp`。

## Write ownership

- `src/core/board.ts`
- `src/core/gitattributes.ts`
- `test/core/board.root.test.ts`（新增）
- `test/core/gitattributes.test.ts`

**不要動 `src/cli/run.ts`** —— 尋根是 core 的責任，CLI 不該知道這件事。若你認為 CLI 必須改才能完成，那是要回報的發現。

## Blocked by

14

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
