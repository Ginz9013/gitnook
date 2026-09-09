# 08 ADR-0001 承諾的 `show` markdown 輸出：決定不做

nook ref：`01M233WYM93ME35JEZWVF3YKPS`

## Outcome

純文件。ADR-0001 在權衡「NDJSON 在 GitHub 網頁上不如 markdown 好讀」時寫下
的緩解手段有兩半：「緩解方式是讓 Op 的 JSON 單行可讀，**並提供 `show` 的
markdown 輸出**」。前半做了，後半從沒做。

## 決定（已定案）

**不做。** 那句緩解是 v1 規劃時寫的，而 v1 之後 studio 出現了 ——「在 GitHub
網頁上難讀」現在有更好的答案（在本機開 studio 看，而且它現在還能編輯），
而 `--json` 已經足以串接工具。

## Acceptance criteria

- [ ] ADR-0001 的那句改成**記錄實際發生的事**：緩解手段是「Op 的 JSON 單行
      可讀」加上「studio 提供人看的檢視」，markdown 輸出評估後不做
- [ ] 寫出**為什麼**不做（上面那兩個理由），不要只是把承諾刪掉 ——
      刪掉會讓下一個人重新提案一次
- [ ] 不要動 ADR-0001 的其他部分。它記著 spike 逼出來的四條不可協商的規則
      （trailing newline、未知 op 型別忽略、排序在 dedupe 之前、不真的刪除
      Issue 檔），那些是這個系統的地基
- [ ] 註解／文件的寫法要符合這個 repo 的標準：說清楚為什麼，以及不這樣做
      會怎樣

## Test seam

無 —— 純文件。既有測試必須維持全綠。**注意** `test/integration/
packed-smoke.test.ts` 會逐字比對 README 與 token 閘門的 fixture；
你不該碰 README，但若你的改動意外影響到它，那是訊號不是雜訊。

## Write ownership

- `docs/adr/0001-op-log-ndjson-with-git-union-merge.md`

**不得碰**：`src/**`、`test/**`、`README.md`、其他 ADR。

## Blocked by

無。

## Status

queued
