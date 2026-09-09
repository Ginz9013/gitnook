# 09 唯讀的 `history`

nook ref：`01M233VN3BY5ZVRYVYY4CSF96G`

## Outcome

v1 spec 的 Risks 明確記為「已知缺口，v2 補」，從沒動過。

原話：「description 是 LWW，並行編輯會撞掉整份文件。敗方版本完整留在
op-log；v1 未提供 `history --restore` 撈回介面（已知缺口，v2 補）。」

**目前唯一一條當初就明說要補、而且真的有資料遺失後果的缺口。** 兩個人（或
一個人與一個 agent）同時改同一份 description，輸的那份還完整躺在 `.ndjson`
裡，但沒有任何指令拿得回來。studio 改版之後更常見：drawer 的內編輯讓改
description 變得很容易。

## 決定（已定案）

**先做唯讀的 `history`，不做 `restore`。** 看得到就拿得回來（手動 copy 回
`nook set`），而 restore 的語意可以等真的痛了再定 —— 那是一個 append 新 op
把舊值寫回去的動作，不是「回到過去」，值得單獨想清楚。

## 這張票是真的垂直切片

`Board` 目前**沒有**任何拿得到原始 Op 的介面：`create` / `get` / `refs` /
`list` / `apply` / `health` 全都回摺疊後的結果。所以這張票會動到 core。

## Acceptance criteria

- [ ] `Board` 新增一個取得某張 Issue 原始 Op-log 的方法。**設計它的公開形狀
      時要看 `src/index.ts` 的 docstring** —— 那份清單是刻意列出來的，
      「每一個匯出都是永久的相容負債」。想清楚要不要匯出、匯出什麼
- [ ] `nook history <ref> [<field>]`：列出該欄位的所有 `set` op，帶 actor 與
      lamport `t`。不帶欄位時的行為由你決定並說明理由
- [ ] **排序沿用 core 的全序**（`(t, actor, id)`）。**不得在渲染層或 CLI 再
      寫一份比較器** —— 那正是 commit 463343d 那個 bug 的成因，`table.ts`
      與 `html.ts` 的註解都記著這條
- [ ] 輸出走既有的 compact table 風格（ADR-0005）。`--json` 要不要支援由你
      決定，但若支援就沿用 `renderJson` 的形狀
- [ ] **不做 restore。** 不要順手加，那是另一個決定
- [ ] `history` 是唯讀的：不寫入任何 op

## 要注意的取捨

- ADR-0002：沒有快取也沒有索引。`history` 讀單一檔案，成本與 `show` 同級，
  不需要新的資料結構
- ADR-0005 的 token 預算：`history` 不在 40 票情境內，但若它的輸出很長，
  仍要跑一次確認 bench 沒動
- 這個 repo 的 `Io` 接縫是 ADR-0004 唯一認可的兩處之一，CLI 測試沿用它

## Test seam

`Board` 的新方法：mkdtemp 的真實 board（ADR-0004）。
CLI：`run(argv, io)` + 注入的 `Io`。

## Write ownership

- `src/core/types.ts` `src/core/board.ts`
- `src/index.ts`
- `src/cli/run.ts`
- `src/render/table.ts`
- 上述各檔的測試

**不得碰**：`src/studio/**` `src/server/**` `src/render/html.ts`
`src/render/json.ts`（除非你決定支援 `--json` 且真的需要）、`AGENT.md`
`README.md`（新指令的文件是後續，不在這張票）、`package.json`。

## Blocked by

票 01、05（皆已完成，兩者都動過 `src/cli/run.ts`）。

## Status

queued
