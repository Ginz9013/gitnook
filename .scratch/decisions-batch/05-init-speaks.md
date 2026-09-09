# 05 `init` 說話，`doctor` 維持沉默

nook ref：`01M21Z436TR4XZC3H35KH134DE`

## Outcome

dogfood 第一天撞到的票，從沒被處理過（歸檔只是讓它從預設檢視消失）。
2026-09-09 實測仍然成立：`init` 兩次、`doctor` 一次，全部空輸出 exit 0。

## 決定（已定案）

**`init` 說話，`doctor` 維持沉默。** 票面原本主張兩個都說話，這裡收窄。

`doctor` 沉默符合 unix 慣例「沒消息就是好消息」，而且它會進 CI（`.github/
workflows/ci.yml` 有跑）—— 健康時噴東西反而是雜訊。`init` 不同：它是一次性
的建置動作，使用者需要知道建了什麼、以及**這次是不是 no-op**。

## Acceptance criteria

- [ ] `nook init` 第一次：印出建立了哪些路徑（`.issues/issues/` 與
      `.gitattributes` 的那一行）
- [ ] `nook init` 第二次（已存在）：**明確說出這次什麼都沒做**，
      不能與第一次長得一樣。exit code 仍是 0 —— 那不是錯誤
- [ ] `.gitattributes` 已存在但缺少 merge=union 那行的情況（`init` 會補上）
      也要說得出它做了什麼 —— 那是第三種結果，不是前兩種之一
- [ ] `doctor` 健康時**維持完全沉默**，exit 0。不得順手改它
- [ ] 輸出走 stdout（資料）而非 stderr —— 沿用這個 repo 既有的分工
- [ ] ADR-0005 的 token 預算不受影響：`init` 一輩子只跑一次，不在 40 票情境
      的量測範圍內。但仍要跑一次確認 bench 沒動

## Test seam

`run(argv, io)` + 注入的 `Io`（ADR-0004 唯一設了接縫的兩處之一）。
`test/cli/run.test.ts` 既有的 init 測試就在那裡，照它的形狀加。

## Write ownership

- `src/cli/run.ts`
- `test/cli/run.test.ts`

**不得碰**：`src/core/gitattributes.ts`（`initBoard` 已經回傳得出它做了什麼，
先讀它的回傳值再決定要不要動 core —— 若真的需要，回報 blocked）、
`AGENT.md`（票 06 同批）、`README.md`。

## Blocked by

票 01（已完成，它動過同一個檔案）。

## Status

queued
