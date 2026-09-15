# 05 CLI breaking change：nook issue <verb>

nook ref：`01M2HBAFJZ1P3YVX7RMC0CKZ1J`

## Outcome

既有 11 個扁平 Issue 指令（`init`/`new`/`list`/`show`/`history`/`set`/
`rm`/`mv`/`comment`/`label`/`share`）全部搬進 `nook issue <verb>`，行為
逐字不變。`doctor`/`studio`/`workspace`/`--help`/`--version` 留在頂層。
與 `nook decision <verb>`（票 01–04）完全對稱。**Breaking change**——
專案目前 0.4.x，pre-1.0，CHANGELOG 的既有政策明講允許。

## Acceptance criteria

- [ ] `src/cli/issue.ts`（新）：`dispatchIssue(argv, io)`，仿
      `src/cli/workspace.ts` 的 `dispatchWorkspace` 先例，把
      `cmdInit`/`cmdNew`/`cmdList`/`cmdShow`/`cmdHistory`/`cmdSet`/
      `cmdRm`/`cmdMv`/`cmdComment`/`cmdLabel`/`cmdShare` 十一個函式
      本體剪貼過去，**邏輯一行都不改**，只調整 import 路徑
- [ ] `src/cli/run.ts`：dispatch 縮成 `case 'issue': return
      dispatchIssue(rest, io)`（十一個舊 case 全部移除，只留
      `doctor`/`studio`/`workspace`）；票 01 加的 `case 'decision'` 那一
      行原樣保留、一併整理進新的 switch 結構
      （不覆蓋、不刪掉票 01 的成果）
- [ ] `nook --help` 更新：印出 `nook issue <verb>` 與 `nook decision
      <verb>` 兩組命令的說明（decision 那組的說明文字由票 01–04 各自
      補上它負責的動詞，這張票只需要確保 `issue` 那組完整、格式一致）
- [ ] `nook <舊扁平指令>`（例如直接打 `nook new`）→ 明確的
      `UsageError`，訊息指向 `nook issue new`，不是模糊的
      「unknown command」
- [ ] 既有 `test/cli/run.test.ts` 的全部案例改成 `nook issue <verb>`
      呼叫，行為斷言不變；依規模拆成 `test/cli/issue.test.ts`（新，裝
      十一個動詞的測試）+ 精簡後的 `test/cli/run.test.ts`（只留
      dispatch／help／doctor／studio 相關）
- [ ] `README.md`／`README.zh-TW.md`／`AGENT.md`：所有指令範例改成
      `nook issue <verb>`／`nook decision <verb>` 的新形式
- [ ] `CHANGELOG.md`：新增條目說明這是 breaking change，照專案既有政策
      放在 Changed/Removed，講清楚「為什麼」與「怎麼遷移」
- [ ] `test/integration/packed-smoke.test.ts` 逐字比對 README/AGENT.md
      的 fixture——這張票一定會讓它先紅，改完文件後要同步更新 fixture，
      不是繞過它
- [ ] `npm run bench` 六列閘門全綠，尤其 agent token 預算（`--help` 與
      README 變長可能吃到既有的 9.4% 餘裕，見 nook-v1 spec 的既有風險
      記錄）

## Test seam

`dispatchIssue(argv, io)`／`dispatchDecision(argv, io)`（票 01 已建立）
的 dispatch 邏輯——CLI 整合測試，既有 `Io` capture adapter，沿用
ADR-0004（不 spawn 子行程）。

## Write ownership

- `src/cli/run.ts`
- `src/cli/issue.ts`（新）
- `test/cli/run.test.ts`
- `test/cli/issue.test.ts`（新）
- `README.md`
- `README.zh-TW.md`
- `AGENT.md`
- `CHANGELOG.md`

**不得碰**：`src/cli/decision.ts`（票 01–04 的範圍）、`src/core/**`。

## Shared resources

None。

## Blocked by

票 01（避免同時改 `src/cli/run.ts` 的 dispatch 區塊；票 01 只加一行，
這張票落地時要把那一行原樣併進新的 switch 結構）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
