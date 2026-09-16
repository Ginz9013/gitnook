# 06 文件、ADR-0012 supersede、nook 自己的 repo 搬遷

票檔：本檔（spec 同目錄 `spec.md`）

## Outcome

README、AGENT.md、CONTEXT.md 完整交代這次的四個變化（`nook init` 統一、
`.gitnook/` 佈局、workspace 可選遞迴、`nook workspace decision`）；ADR-0012 被一
條新 Decision 記錄 superseded；nook 自己這個 repo 的 `.issues/`／`.decisions/`
搬到 `.gitnook/` 底下，讓專案自己吃自己的新佈局（dogfood）。

## Acceptance criteria

- [ ] `README.md`：`## workspace` 一節補上 `nook workspace decision` 的用法
      （比照既有 `list`/`new`/`set` 的份量）；`.gitnook/` 佈局取代所有提到
      `.issues/`/`.decisions/` 的地方；`nook init` 取代 `nook issue init`/
      `nook decision init` 的說明；`--workspace`/`--private` 兩個旗標各自有一
      句話交代語意
- [ ] `AGENT.md`：跟票 01/05 已經補上的 HELP 對應內容整合成完整一節（不是只有
      指令名，要交代 `--workspace` 這個旗標存在、以及它跟遞迴掃描的關係）
- [ ] `CONTEXT.md` 的 **Workspace** 詞條補一句：探測預設仍是純檔案系統掃描
      （找到 Board 就不再往它底下更深處找），但一個 Board 可以透過
      `.gitnook/config.json` 的 `workspace: true` 主動宣告自己也是一個
      workspace 節點，此時掃描會繼續往它底下鑽
- [ ] `CONTEXT.md` 的 **Sharing** 詞條確認（不一定要改字，但要核實）：現在的敘
      述「以 board 為單位」與實作（一條 exclude 規則蓋住整個 `.gitnook/`）一致
      ——如果原本的措辭暗示過「可能分模組」，要修掉
- [ ] 開一條新 Decision（用真的 `nook decision new` 指令，對 nook 自己這個
      repo 跑，不是手寫檔案）：標題講清楚「重新打開 ADR-0012 的『以後真的需要才
      加設定檔』」，`body` 裡把「排除清單」（ADR-0012 拒絕的方向）跟
      「continue-scanning 旗標」（這次做的方向）的差異講清楚，`disposition:
      accepted`
- [ ] 用 `nook decision set <ADR-0012 的 ref> supersededBy <新條目的 ref>` 把
      ADR-0012 標成 superseded
- [ ] nook 自己這個 repo 的 `.issues/issues/` 搬到 `.gitnook/issues/`，
      `.decisions/decisions/` 搬到 `.gitnook/decisions/`（`git mv`，保留歷史）；
      `.gitattributes` 的兩條 `merge=union` 規則路徑跟著更新；`git status` 確認
      沒有任何未預期的其餘變更
- [ ] `npm run bench` 六列閘門全綠（既有慣例：這個指令會清掉整個 `dist/`，是這
      次全部票落地之後才跑一次的最終驗證，不在任何單張票的 Focused/Suite 裡）
- [ ] `CHANGELOG.md` 補一則條目：breaking change，`.issues/`/`.decisions/` →
      `.gitnook/`、`nook issue init`/`nook decision init` 移除、
      `nook workspace decision` 新增——讓從 npm 更新上來的使用者知道要手動
      `git mv` 自己的 board

## Test seam

None（這張票不改行為，只改文件與跑一次真實 CLI 操作在 nook 自己的 repo 上）。

## Write ownership

- `README.md`
- `AGENT.md`
- `CONTEXT.md`
- `CHANGELOG.md`
- `.gitnook/`（新建，透過 `git mv` 從 `.issues/`/`.decisions/` 搬過來，不是手寫
  檔案）
- `.gitattributes`（路徑更新）
- nook 自己 repo 的 `.issues/`、`.decisions/`（整個目錄被 `git mv` 清空）

**不得碰**：任何 `src/*`、任何測試檔——文件跟實作對不上要回報 blocked，不是偷
改程式碼配合文件。

## Shared resources

None——這張票不跟其他票共用任何暫存資源，但它**必須**是最後一張落地的票（見
Blocked by），因為它動的是 repo 自己的真實資料，不是暫存目錄。

## Blocked by

05（要等全部功能都落地才能正確描述文件，也才能安全地把 nook 自己的 board 搬過
去——搬完之後如果還有票在改 core 邏輯，中途任何一次執行都可能是用新佈局在跑，
必須確認新佈局已經是最終形狀）

## Status

todo

## Done when

- 文件內容與實際程式碼對過一遍，沒有落差（不是只信之前幾張票的報告）。
- `npm run bench` 六列閘門全綠。
- `npx vitest run` 全綠、`npx tsc --noEmit` 0 錯誤。
- `git log --follow` 對搬移後的 `.gitnook/issues/`／`.gitnook/decisions/` 底下
  任一檔案能追溯回搬移前的歷史（驗證用的是 `git mv`，不是刪除重建）。
- Standards and spec review blockers are resolved.
