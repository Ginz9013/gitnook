# 13 label 指令、doctor --fix，與 warnIfUnguarded 的效能修正

## Outcome

補上三個由票 10 揭露的缺口。前兩個是 v1 的功能漏洞，第三個直接影響「冷啟 < 500ms」這個硬指標。

## 背景

**這是規劃階段的漏洞，不是實作問題。** 票 10 的九個指令清單是在訪談第三輪定下的，當時漏了 label 完全沒有 CLI 路徑。

## Acceptance criteria

### label 指令（v1 的功能漏洞）

- [ ] `nook label <ref> +bug -ui` 新增與移除 label，一次可多個
- [ ] `CONTEXT.md` 明文寫著「Nook 沒有優先級欄位 —— 優先級用 Label 表達」，而 `list --label` 目前在過濾一個 CLI 根本建不出來的東西
- [ ] `test/render/token-budget.test.ts` 的 skill 文件草稿**已經在宣傳 `nook label <ref> +bug -ui`**。票 11 若照它寫 README，會教一個不存在的指令
- [ ] 走 core 既有的 `apply(ref, { labels: { add, remove } })` —— OR-Set 的 `seen` 語意在 core，CLI 不得自行實作
- [ ] `new --label bug --label p1` 亦可（`create({ labels })` 已就位）

### doctor --fix

- [ ] `doctor` 目前回報 `GluedLine ... 可修復`，但**使用者沒有任何辦法修復它**
- [ ] `repair(dir)` 已於票 05 實作並匯出，接上即可
- [ ] `--fix` 後重跑診斷，印出修復了什麼

### warnIfUnguarded 的效能（影響冷啟硬指標）

- [ ] 目前每次 `list` / `show` 都呼叫 `diagnose()`，代價是**一次全量掃描加上一個 `git rev-parse` 子行程**
- [ ] `src/core/gitattributes.ts` 的 `inspectMergeGuarantee` 才是該問的問題，但未從 `src/index.ts` 匯出
- [ ] 匯出它並替換兩個呼叫點；以測試釘住 `list` 不再觸發全量診斷

## ⚠️ token 預算

閘門現在是 **4030B / 4096B，餘裕 66B（1.6%）**。`label` 指令會增加 skill 文件的篇幅。**若你撞破了它，那是要回報的發現，不是可以調鬆的門檻** —— 上限本身是否該重新校準是 orchestrator 的決定。

## Test seam

`run(argv, io)`，注入的 `Io`，不得 spawn `nook` 子行程。

## Write ownership

- `src/cli/run.ts`
- `src/index.ts`（僅限新增 `inspectMergeGuarantee` 的 re-export）
- `test/cli/run.test.ts`

## Shared resources

暫存目錄。`studio` 相關測試綁 port 0。

## Blocked by

10

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
