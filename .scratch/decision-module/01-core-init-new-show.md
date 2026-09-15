# 01 Decision 核心地基 + init/new/show

nook ref：`01M2HBAFEE5HGCCBJX1X83VEC3`

## Outcome

`openDecisionLog().create({ title, body?, disposition? })` 寫出一個合法的
NDJSON op-log 檔到 `.decisions/decisions/<ULID>.ndjson`，`get(ref)` 把它
fold 回一個 `Decision`。這是貫穿儲存層到領域層的第一顆曳光彈，`nook
decision init/new/show` 是它的最小 CLI 出口。

工具鏈屬於第一個需要它的切片，所以在這張票內建立：泛型 op-log 引擎
（給 Decision 用，不動 Issue 既有的 `ops.ts`/`reduce.ts`）、
`gitattributes.ts` 的尋根/初始化泛化。

## Acceptance criteria

- [ ] `src/core/oplog.ts`：`serialize<T extends OpBase>`、`parseLine<T>`、
      `splitGluedLine`、`nextLamport<T extends OpBase>`、
      `orderOps<T extends OpBase>`——排序規則 `(t, a, id)` → dedupe by
      id，與 `core/reduce.ts` 既有 `orderOps` 的行為一致（可用相同的屬性
      測試手法驗證：任意打亂輸入順序，fold 結果不變）
- [ ] `src/core/decisionTypes.ts`：`Decision`（`id`/`title`/`body`/
      `disposition`/`supersededBy?`/`legacyRef?`）、`DISPOSITIONS`
      （`proposed`/`accepted`/`superseded`/`rejected`）、
      `resolveDisposition()`（同 `resolveStatus` 的無歧義前綴解析）、
      `CreateDecisionInput`、`DecisionChange`、`DecisionLog` 介面
      （`create`/`get`/`list`/`refs`/`apply`/`opLog`/`root`/`health`）、
      錯誤型別 `DecisionLogNotInitialized`/`DecisionNotFound`/
      `AmbiguousDecisionRef`/`InvalidDisposition`
- [ ] `src/core/decisionOps.ts`：`DecisionOp`（`create`/`set`，`k` ∈
      `title`/`body`/`disposition`/`supersededBy`/`legacyRef`），呼叫
      `oplog.ts` 的泛型函式，不自己重寫排序/dedupe
- [ ] `src/core/decisionReduce.ts`：`reduceDecision(id, ops)` 摺出
      `Decision`（全部 LWW，沒有 OR-Set／comments）、
      `decisionFieldWrites(ops, field?)`（供票 04 的 history 用，先把
      介面定義好）
- [ ] `src/core/decisionLog.ts`：`openDecisionLog(opts)` 實作
      `create`/`get`/`list`/`refs`/`apply`/`opLog`/`root`/`health`，
      存放於 `.decisions/decisions/<ULID>.ndjson`；未 init 的目錄呼叫
      `create` 拋 `DecisionLogNotInitialized`
- [ ] `src/core/gitattributes.ts`：抽出一個接受「marker 相對目錄 +
      gitattributes pattern」的泛化尋根/初始化函式；`findBoardRoot`/
      `initBoard` 變成呼叫它的 Issue 專用薄包裝，**既有 `gitattributes.test.ts`
      不改一行也要全綠**（Issue 的公開行為零變化）；新增一個給
      Decision 用的 `initDecisionRoot`/`findDecisionRoot`（或同等名稱）
- [ ] `nook decision init`：建立 `.decisions/decisions/` 與
      `.decisions/decisions/*.ndjson merge=union` 那一行；已存在衝突
      規則時報錯停止，不靜默覆蓋
- [ ] `nook decision new --title <t> [--body <b>] [--disposition <d>]`：
      印出完整 26 碼 ULID（同 `nook new` 既有理由：短 ID 只在印出當下
      無歧義）
- [ ] `nook decision show <ref> [--json]`：印出 title/body/disposition/
      supersededBy（有值才印）
- [ ] `src/index.ts` 新增 Decision 相關公開匯出：`openDecisionLog`、
      `Decision`、`DecisionChange`、`CreateDecisionInput`、`DecisionLog`、
      `Disposition`、`DISPOSITIONS`、上述錯誤型別——**比照既有那份
      docstring 的紀律**：寫清楚為什麼匯出這些、刻意不匯出什麼（例如
      `DecisionOp` 的個別成員、`decisionFieldWrites` 這類內部工具）
- [ ] `CONTEXT.md` 新增詞條：**Decision**、**Decision Log**、
      **Disposition**，各自帶 `_Avoid_`；在既有 **Board** 詞條補一句
      交叉引用（不是 Decision Log 的上位詞）、在既有 **Status** 詞條補
      一句交叉引用（Disposition 是不同的語意軸，不能互換）

## Test seam

`openDecisionLog()`——整合測試，真實檔案系統、暫存目錄（ADR-0004，不
引入 mock）。`oplog.ts` 的排序/dedupe 用屬性測試。`nook decision
init/new/show` 用既有 `Io` capture adapter（同 `test/cli/run.test.ts`
的手法）。

## Write ownership

- `src/core/oplog.ts`（新）
- `src/core/decisionTypes.ts`（新）
- `src/core/decisionOps.ts`（新）
- `src/core/decisionReduce.ts`（新）
- `src/core/decisionLog.ts`（新）
- `src/core/gitattributes.ts`
- `src/cli/decision.ts`（新，只做 `init`/`new`/`show`）
- `src/cli/run.ts`（只新增 `case 'decision': return dispatchDecision(rest, io)` 這一行 + import）
- `src/index.ts`
- `CONTEXT.md`
- 上述各檔對應的 `test/core/*` 與 `test/cli/decision.test.ts`（新）

**不得碰**：`src/core/ops.ts`、`src/core/reduce.ts`、`src/core/board.ts`、
`src/core/types.ts`——Issue 的既有核心一行都不動。`src/cli/run.ts` 除了
那一行 `case` 之外不得動其餘 dispatch 內容（票 05 負責整個 Issue 側的
拆分，這裡動了會跟它衝突）。

## Shared resources

暫存目錄（每個測試用例獨立 `mkdtemp`）。

## Blocked by

None——這是第一張票。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
