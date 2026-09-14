# 08 README 與 AGENT.md 交代 Workspace 的六個寫入指令

nook ref：`01M2799ATCA4KETK37AHFQ8N4X`

## Outcome

README 與 AGENT.md 的 Workspace 章節補上 `new`/`set`/`mv`/`comment`/
`label`/`rm` 六個指令，且把「workspace 唯讀」這句舊的定論改掉，講清楚
現況：讀取彙整唯讀，但可以透過六個路由過的寫入指令對單一成員寫入。

## Acceptance criteria

- [ ] `README.md` 的「## workspace」一節更新：拿掉或改寫「**This cannot
      write anything.**」那一段，改成講清楚 `new` 需要 `--in`、其餘五個
      靠完整 ULID 自動路由、以及短前綴為什麼被拒絕
- [ ] `AGENT.md` 的「## workspace is read-only」章節標題與內文都要改—— 
      這個標題現在是錯的；同時要補上「queued 授權邊界對 workspace 的
      `mv` 仍然適用」（`nook workspace mv <ref> queued` 跟單一 Board的
      `nook mv <ref> queued` 一樣，是人給的授權，agent 不得自己下）
- [ ] `README.md` 的「## Commands」表格與 `AGENT.md` 的指令表都要反映新的
      六個子指令
- [ ] `test/agent-doc.test.ts` 雙向綠燈
- [ ] `CONTEXT.md` 與 `docs/adr/0012-*.md` 跟實際實作對過一遍，發現任何
      漂移就地修正（預期不需要改——這次沒有新的探測規則）
- [ ] `npm run bench` 整體跑過一次，六列閘門全綠

## Test seam

無新程式碼行為——這張票是文件與既有測試閘門
（`test/agent-doc.test.ts`、`npm run bench`）的驗證。

## Write ownership

- `README.md`
- `AGENT.md`
- `CONTEXT.md`（僅在發現與實作有出入時修正）
- `docs/adr/0012-workspace-discovers-members-by-filesystem-scan.md`
  （僅在有出入時修正）

**不得碰**：任何 `src/*`、`test/*`（非文件測試）。

## Shared resources

None。

## Blocked by

票 07——需要全部六個寫入指令都成立，才能完整、準確地寫文件。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
