# 05 README 與 AGENT.md 完整交代 Workspace

## Outcome

一個沒讀過這次規劃過程的人，光看 README 與 AGENT.md 就知道 Workspace
是什麼、什麼時候該用、跟 Board 的關係、以及三個子指令的用法。

## Acceptance criteria

- [ ] `README.md` 新增「## workspace」一節，份量比照既有「## private
      mode」／「## studio」——講清楚：這是唯讀彙整、探測規則（掃
      `.issues/issues/`，跳過 `.git`/`node_modules`，不讀 `.gitmodules`）、
      三個子指令各自做什麼、以及「這次不能寫入」這條明確的邊界
- [ ] `README.md` 的「## Commands」表格新增 `workspace` 一行
- [ ] `AGENT.md` 的 Workspace 說明從票 02 的最小一行擴充成完整一節：
      三個子指令的語法、`queued`/寫入邊界對 Workspace 不適用的原因
      （因為它本來就唯讀）
- [ ] `test/agent-doc.test.ts` 兩個方向都維持綠燈
- [ ] `CONTEXT.md` 與 `docs/adr/0012-*.md`（規劃階段已寫定）與最終實作
      的實際行為互相對照一遍，發現任何漂移就地修正（例如探測是否真的
      跳過 symlink、是否真的不設深度上限）
- [ ] `npm run bench` 整體跑過一次，六列閘門全綠，CLI bundle 的
      React/studio 痕跡是 0

## Test seam

無新程式碼行為——這張票是文件與既有測試閘門（`test/agent-doc.test.ts`、
`npm run bench`）的驗證。

## Write ownership

- `README.md`
- `AGENT.md`
- `CONTEXT.md`（僅在發現與實作有出入時修正，預期多半不需要改）
- `docs/adr/0012-workspace-discovers-members-by-filesystem-scan.md`
  （同上，僅在有出入時修正）

**不得碰**：任何 `src/*`、`test/*`（非文件測試）——這張票不改行為，只改
文件；如果文件跟行為對不上，回報 blocked 而不是偷改程式碼來配合文件。

## Shared resources

None。

## Blocked by

票 04——需要全部三個子指令都成立，才能完整、準確地寫文件。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
