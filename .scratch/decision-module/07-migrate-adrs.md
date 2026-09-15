# 07 遷移 12 篇既有 ADR 進 Decision Log + 全 repo 引用掃尾

nook ref：`01M2HBAFN5YGWY1RV9WJEEADZC`

## Outcome

`docs/adr/0001`–`0012` 全部變成 `.decisions/decisions/<ULID>.ndjson`，
`docs/adr/*.md` 刪除。散在 `src/**`／`CONTEXT.md`／`README*.md`／
`AGENT.md` 裡「見 docs/adr/000X」這類引用，全部改成指向對應的
`legacyRef`（例如「見 decision `legacyRef 0009`，`nook decision show
0009`」這種寫法，具體措辭由你決定，但**周圍的推理文字不重寫**——只換
掉失效的路徑 token）。

這是這一批的最後一張票，**unbounded**：它是機械式改動但橫跨幾乎整個
`src/**`，寫入所有權沒辦法先列清單，同 `references/artifacts.md` 的
「Write ownership checks」——這種票單獨跑，不進平行批次。

## 讀過 12 篇 ADR 後的既有事實（省你重新調查一次）

- 沒有任何一篇的標題或內文寫著「已被取代」（`superseded`）；0009 是對
  0001 硬規則 4 的**限定/接上**、0003 在上一批決策後被**改寫**、0001
  在上一批決策後被**改寫**（拿掉「將提供 markdown 輸出」那句承諾）——
  三者都是**原地修訂**，不是「新 ADR 取代舊 ADR」的關係。**預設 12 篇
  全部 `disposition = accepted`，`supersededBy` 全部留空**，除非你重讀
  時發現遺漏的例外
- `.scratch/decisions-batch/07-adr0006-stale.md` 曾把 0006 標記為
  「內容過時」，但那張票的決定是**改寫 0006 本身**（票 07 的 write
  ownership 是 `docs/adr/0006-*.md`），不是廢棄它——確認 0006 現在的
  內容已經是改寫後的版本（`git log -p docs/adr/0006-*.md` 可查），照
  現有內容遷移即可

## Acceptance criteria

- [ ] 對每篇 `docs/adr/000N-*.md`：`title` = 檔案的 H1（去掉
      `# `）、`body` = 其餘 markdown 全文、`disposition` 依上一節判斷、
      `legacyRef` = 四位數字（如 `"0009"`）——用票 01–04 做出來的 CLI
      執行（`nook decision new` + `nook decision set ... legacyRef
      000N`），不要繞過 CLI 直接手寫 ndjson
- [ ] `nook decision init` 在這個 repo 根目錄執行過一次：`.decisions/`
      與 `.gitattributes` 的新增行確實落地
- [ ] 12 篇都遷移完成後，`nook decision list` 印出 12 列，`legacyRef`
      可以在 `show` 裡看到
- [ ] `docs/adr/*.md` 全部刪除，`docs/adr/` 目錄本身可以留空或一併移除
      （你決定，若留空要有 `.gitkeep` 或說明為什麼留著）
- [ ] `grep -rn "docs/adr/00" src/ CONTEXT.md README.md README.zh-TW.md
      AGENT.md` 歸零——這是驗收的機械檢查，不是憑印象
- [ ] 逐一確認每處被改寫的引用**沒有連帶改動周圍的推理文字**——這張票
      的風險是「順手把註解也重寫了」，那是越界
- [ ] `test/integration/packed-smoke.test.ts` 的 README/AGENT.md fixture
      比對：這張票會動到這兩份文件，若跟票 05 的改動疊加後 fixture
      對不上，更新 fixture 而不是繞過測試
- [ ] `npm run bench` 四個硬指標全綠——這是整批工作的最後一次整合驗證，
      由你在這張票統一跑

## Test seam

無新增程式邏輯（純資料遷移＋文件掃尾）。既有測試必須維持全綠；
`packed-smoke.test.ts` 的 fixture 更新視為這張票的一部分。

## Write ownership

**Unbounded**——預期會碰到：

- `.decisions/decisions/*.ndjson`（新，12 個檔案，透過 CLI 產生）
- `.gitattributes`（新增一行）
- `docs/adr/*.md`（刪除）
- `src/**` 裡任何寫著「docs/adr/000X」的註解
- `CONTEXT.md`／`README.md`／`README.zh-TW.md`／`AGENT.md` 裡對
  `docs/adr/` 的連結或引用
- `test/integration/packed-smoke.test.ts`（fixture，若需要）

## Shared resources

None——但這張票必須在其餘六張全部落地後才開始，避免遷移途中文件被
其他票同時改動。

## Blocked by

票 01、02、03、04、05、06（全部落地：CLI 完整、`nook doctor` 完整、
`nook issue`/`nook decision` 兩個命名空間都穩定，才能安全地做「機械式
橫掃全 repo」這件事）。

## Status

queued

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
