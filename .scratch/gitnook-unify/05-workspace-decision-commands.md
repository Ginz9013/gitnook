# 05 `nook workspace decision list/new/set/show/history`

票檔：本檔（spec 同目錄 `spec.md`）

## 執行後追加（整合者記錄，票 02 驗證時發現）

`test/cli/workspace.test.ts` 裡 `writeGluedOpLog` 這個測試輔助函式（目前在檔案
第 97 行附近）仍硬編 `join(memberDir, '.issues', 'issues', ...)`，是這個檔案裡
唯一還沒跟著佈局改動的路徑字面值，導致 `dispatchWorkspace doctor --fix` 那條測
試持續紅（`health.ts`/`repair()` 本身是對的，已在票 02 驗證過）。這張票本來就
會動 `test/cli/workspace.test.ts`，動手時請順便把這個字面值改成
`'.gitnook', 'issues'`——純路徑替換，不是這張票原本範圍要求的新行為，但既然要
動這個檔案就一併帶上。

## Outcome

`nook workspace decision <list|new|set|show|history>`，比照既有
`nook workspace <list|new|set>`（issue 版）的既有模式：

- `list [--disposition <d>] [--json]`——依成員分組列出全部 decision，篩選語意同
  單一 board 的 `nook decision list`，空群組略過不印。
- `new --title <t> [--body <b>] [--disposition <d>] --in <path>`——`--in` 必填
  （同 issue 版 `new` 的既有規則，不 fallback 到 cwd），印出完整 ref。
- `set <ref> <title|body|disposition|supersededBy> <value|-> [--editor]`——不需
  要 `--in`，靠 `locateDecisionInWorkspace()` 找出擁有這個 ref 的成員。
- `show <ref> [--json]`／`history <ref> [<field>]`——issue 側 workspace 指令沒
  有這兩個可以照抄，這裡直接對稱單一 board 的 `nook decision show`/`history`，
  只是用 `locateDecisionInWorkspace()` 取代「對 io.cwd 開一塊 board」。

## Acceptance criteria

- [ ] `nook workspace decision list` 依成員分組列出，篩選（`--disposition`）與
      `--json` 語意同單一 board 版；空群組（篩選後這個成員一筆都沒有）整組不
      印，全部成員都空時印一句彙整版的「沒有 decision」
- [ ] decision log 尚未初始化的成員（例如舊版佈局還沒搬完）在 `list` 裡被當成
      「零 decision」略過，不是錯誤、不中止整個指令
- [ ] `nook workspace decision new --title <t> --in <path>` 在指定成員建立一筆
      decision，印出完整 26 碼 ref；缺 `--in` 丟 `UsageError`（訊息講清楚沒有
      fallback 到 cwd，同 issue 版既有措辭）
- [ ] `nook workspace decision set <ref> <field> <value>` 不知道 ref 屬於哪個成
      員也能改到正確的那一筆；`field` 限定 `title/body/disposition/
      supersededBy`（沿用單一 board 版既有的 `DECISION_SETTABLE`），給其他欄位
      丟 `UsageError`；`ref` 不是完整 26 碼丟 `IncompleteRef`
- [ ] `nook workspace decision show <ref>` 對存在的完整 ref 印出 detail 版面
      （沿用既有 `renderDecisionDetail`），`--json` 給結構化輸出
- [ ] `nook workspace decision history <ref> [<field>]` 對存在的完整 ref 印出既
      有的 op 歷史（沿用既有 `renderDecisionSetOps` 或等價的既有 render 函式）
- [ ] `show`/`history`/`set` 對找不到的 ref 丟新的
      `DecisionRefNotFoundInWorkspace`（票 04 已定義）；`ref` 不完整丟
      `IncompleteRef`
- [ ] `nook workspace decision` 不接任何未知子指令時給出清楚的 `UsageError`，列
      出可用清單（同 `dispatchWorkspace()` 既有的 unknown-subcommand 措辭）
- [ ] `nook --help`／`AGENT.md` 提到 `nook workspace decision`
      （`test/agent-doc.test.ts` 若存在雙向比對，需要保持綠燈——檢查這個測試檔
      是否存在，存在的話它在你的隱式寫入範圍內，因為它只驗證 HELP/AGENT.md 文
      字，不驗證行為）

## Test seam

- `dispatchWorkspaceDecision(argv, io)`（`src/cli/workspace.ts`，新函式）——整
  合測試，延續 `test/cli/workspace.test.ts` 既有的 `Io` capture adapter 手法
- `renderWorkspaceDecisionList(groups)`（`src/render/table.ts`，新函式）——單元
  測試，延續 `test/render/table.test.ts` 既有手法

## Write ownership

- `src/cli/workspace.ts`
- `src/render/table.ts`
- `test/cli/workspace.test.ts`
- `test/render/table.test.ts`
- `AGENT.md`（`nook workspace decision` 至少提一次——`test/agent-doc.test.ts`
  對 HELP 與 AGENT.md 的指令名做雙向比對，兩邊都要有）

**不得碰**：`src/core/*`、`src/server/*`——這張票純粹是接線（CLI + render），
`WorkspaceMember.decisionLog`/`locateDecisionInWorkspace` 是票 04 已經做完、未經
修改直接重用的既有成品。

## Shared resources

None。

## Blocked by

04

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests（`npx vitest run test/cli/workspace.test.ts
  test/render/table.test.ts test/agent-doc.test.ts`）與 `npx tsc --noEmit` 通過。
- 廣義回歸套件（`npx vitest run`）全綠。
- Standards and spec review blockers are resolved.
