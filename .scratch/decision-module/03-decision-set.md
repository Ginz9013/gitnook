# 03 nook decision set（title/body/disposition/supersededBy）

nook ref：`01M2HBAFGRPDGVTK6YA6X11HQW`

## Outcome

`nook decision set <ref> <title|body|disposition|supersededBy>
<value|-> [--editor]`：能個別修改 Decision 的任一 LWW 欄位，語意（讀
stdin 的 `-`、`--editor`、欄位驗證）與 Issue 的 `nook set` 一致。

## Acceptance criteria

- [ ] `DecisionLog.apply(ref, change)` 已在票 01 實作完（純 core），這
      張票只需要把 CLI 動詞接上
- [ ] `nook decision set <ref> title <value>`：更新後印出這一列（同
      `nook set` 既有的回印風格）
- [ ] `nook decision set <ref> body <value|-> [--editor]`：`-` 從 stdin
      讀、`--editor` 開啟 `$EDITOR`，兩者互斥時的既有規則沿用
      （`fromEditor`/`longText`，不重寫）
- [ ] `nook decision set <ref> disposition <value>`：`value` 接受無歧義
      前綴（同 `resolveDisposition`）；不合法值拋 `InvalidDisposition`，
      訊息列出四個合法值
- [ ] `nook decision set <ref> supersededBy <value>`：只驗證 ref 形狀
      （`isValidRef`），不驗證目標存在——同 spec 的 Non-goals，故意不做
- [ ] 給不存在的欄位名（例如 `nook decision set <ref> status ...`，
      `status` 是 Issue 的詞不是 Decision 的）→ 清楚的 `UsageError`，
      列出四個合法欄位名
- [ ] 給不存在的 ref → `DecisionNotFound`；給有歧義的前綴 →
      `AmbiguousDecisionRef`

## Test seam

`dispatchDecision(argv, io)` 的 `set` 分支——CLI 整合測試，既有 `Io`
capture adapter。

## Write ownership

- `src/cli/decision.ts`（擴充 `set`）
- `test/cli/decision.test.ts`（擴充）

**不得碰**：`src/core/decisionLog.ts`（`apply()` 已在票 01 做完）。

## Shared resources

None。

## Blocked by

票 01（`DecisionLog.apply()` 與型別）。**與票 02、04 對
`src/cli/decision.ts` 是同一個檔案，三張票必須序列化執行，不能同批次
平行**——誠實反映而非刻意製造（同 `workspace-write` 那批的先例）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
