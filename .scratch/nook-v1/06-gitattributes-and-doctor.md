# 06 `.gitattributes` 保證與 doctor 診斷

## Outcome

`init` 寫入 `merge=union` 那一行 —— **整個零衝突保證的唯一支柱**。`health()` 持續驗證它還在。

## Acceptance criteria

- [ ] `init` 在無 `.gitattributes` 時建立之，內含 `.issues/issues/*.ndjson merge=union`
- [ ] 已存在 `.gitattributes` 時**冪等 append**，不覆蓋既有內容
- [ ] 已含相同規則時不重複寫入
- [ ] 已存在**衝突規則**（如 `* -merge`，或對 `*.ndjson` 的其他 merge 設定）時**報錯停止**，不靜默改變使用者的 merge 行為，錯誤訊息指出衝突的那一行
- [ ] `init` 同時建立 `.issues/issues/` 目錄
- [ ] 重複 `init` 是冪等的
- [ ] `health()` 在該行缺失時回報 `MissingMergeDriver` 診斷（**這是唯一的單點失效**）
- [ ] `health()` 在非 git repo 中回報適當診斷而非崩潰
- [ ] `health()` 回報無法解析的行、黏合行、未知 op（後兩者的實作在票 05，本票只需定義診斷型別與彙整）

## Test seam

`init()` 與 `health()`，真實檔案系統與暫存目錄。

## Write ownership

- `src/core/gitattributes.ts`
- `src/core/health.ts`
- `test/core/gitattributes.test.ts`
- `test/core/health.test.ts`

不得修改 `src/core/board.ts`（票 01 已建立空殼委派）。

## Shared resources

暫存目錄。

## Blocked by

01

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
