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

## 追加：`Board` 需要一個廉價的 id 來源（票 14 揭露）

票 14 撞到兩個互相衝突的要求，兩者有同一個解。

`cmdShow` 若要用整個 board 的長度算短 ID，就得呼叫 `list({ all: true })`，
那會**摺疊每一份 op-log**，直接打破票 13 立下的效能保證（`show 只讀它要的
那一張 —— 另一張的 op-log 讀不得也不影響`）。`cmdList` 則是對**過濾後**的
集合算長度，於是 `nook list` 印出的 ref 可能被 `nook show` 判為有歧義。

根因是：**算顯示長度只需要一串 id，不需要摺疊任何東西**。`logIds()` 已經
存在於 `src/core/board.ts:31`（單純 `readdirSync`），但不在 `Board` 介面上。

- [ ] `Board` 介面加上一個廉價的 id 來源，只做目錄列舉、不摺疊任何 op-log
- [ ] 測試釘住：取得全部 id **不會**讀取任何 `.ndjson` 的內容（可用一個讀不得的檔案當探針，同票 13 的做法）
- [ ] 命名請遵守 `CONTEXT.md` 的 Ref 詞條（`_Avoid_: id, key, slug`），自行決定合適的名稱並說明理由

**接線留給票 16** —— `cmdShow` 與 `cmdList` 在 `src/cli/run.ts`，不在本票範圍。這與票 04 提供 `shortIdLength`、票 12 接線是同一個分工。

## Test seam

`openBoard()` 與 `initBoard()`，真實檔案系統 + `mkdtemp`。

## Write ownership

- `src/core/board.ts`
- `src/core/types.ts`（僅新增廉價 id 來源到 `Board` 介面）
- `src/core/gitattributes.ts`
- `test/core/board.root.test.ts`（新增）
- `test/core/gitattributes.test.ts`

**不要動 `src/cli/run.ts`** —— 尋根是 core 的責任，CLI 不該知道這件事。若你認為 CLI 必須改才能完成，那是要回報的發現。

## Blocked by

14

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
