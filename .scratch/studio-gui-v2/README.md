# studio GUI v2 —— board

規劃產物。`spec.md` 是唯一的需求來源；worker 看不到規劃時的對話，
**票面與 spec 沒寫的東西就是沒有定案，不要自己補**。

## 順序與阻擋

```
批 A —— 地基
  A1  ADR-0009 / ADR-0010 / CONTEXT.md / AGENT.md 散文     （無阻擋，第一張）
  A2  core：deleted 進 LWW 機器                            ← A1
  A5  reconcile：CREATED / deleted 的 ACK                  （無阻擋）
  A6  design token + light/dark + prefs.ts                 （無阻擋，獨佔 index.css）
  A3  CLI：nook rm / set deleted / show                    ← A2, A1
  A4  server：deleted 通過寫入面 / POST /api/issues        ← A2
  A7  拆車道：lanes.ts 消失                                ← A1
  A8  GUI 新增                                             ← A4, A5, A7
  A9  GUI 刪除與封存                                       ← A8, A4, A5
  A10 README 與閘門收尾                                    ← 全部

批 B —— 版面
  B1  server：board-info / history 兩個唯讀端點            ← A4
  B2  header：logo / 路徑 / 分支 / actor / 四個動作        ← B1, A6, A8
  B3  欄位折疊                                             ← B2, A6
  B4  橫向平移與拖曳自動捲動                                ← B3
  B5  gitattributes 警示 / 空看板 / 載入中                  ← B2
  B6  依 Label 篩選                                        ← B2, B5
  B7  drawer 的變更歷史                                     ← B1, A9
```

## 可以同時跑的批次

**批 A 第一輪：A1**（其餘都在等它，或等 A2）
**批 A 第二輪：A2 · A5 · A6** —— 三張的檔案完全不重疊（core／reconcile／css+prefs）
**批 A 第三輪：A3 · A4 · A7** —— CLI／server／studio 看板，三塊互不相干
**批 A 第四輪：A8** → **第五輪：A9** → **第六輪：A10**

**批 B 幾乎是 serial 的，這一點要說清楚而不是假裝平行**：B2–B6 全部落在
`Board.tsx` 與 `BoardHeader.tsx` 這兩個檔上 —— 那是同一個畫面。
唯一真的能並行的是 **B7**（drawer，與 header／看板不相干），它可以跟 B3–B6
任何一張同時跑。B1 是批 B 的第一張，必須單獨跑完。

## 基準線（2026-09-10 實測）

- `npm run typecheck`：乾淨
- `npm test`：26 個檔案 / 416 個測試，全過
- **既有缺陷，不是這批的工作**：`@radix-ui/react-alert-dialog` 宣告在
  `devDependencies` 但沒有任何一行 import 它（A9 會變成它的第一個使用者）

## 三條會靜默壞掉的規則（AGENT.md）

1. studio bundle **不得**被 CLI 進入點 import —— `npm run bench` 是閘門。
2. 建置一律 `npm run build`，**絕不可只跑 `npx tsup`** —— 它會清掉 `dist/studio/`。
3. dogfood 一律 `node node_modules/gitnook/bin/nook.js`（或 `npm run nook --`），
   **不用 `npx nook`**。

## 完整 Ref（發布於 nook board，2026-09-10）

> 存下來的、跨時間傳遞的一律是 26 碼完整 ULID（AGENT.md 的 Ref 規則）——
> `list` 印的短 Ref 是對「當下這塊 board」算的，過一小時可能就有歧義。

| 票 | 完整 Ref |
|---|---|
| A1-adr-and-context.md | `01M23HNDW8AD59HG3XGCT81M1E` |
| A2-core-deleted.md | `01M23HNDXFE3DM53YD6MFHPAWH` |
| A5-reconcile-create-and-delete.md | `01M23HNDYKMQ91XWTWM129CQJ8` |
| A6-design-tokens-and-theme.md | `01M23HNDZQCMYKWARFR19EDVD1` |
| A3-cli-rm.md | `01M23HNE0VZ0PJ6N07KQ6VAQ4G` |
| A4-server-write-surface.md | `01M23HNE20T6FZJ2APTDN0PKRS` |
| A7-remove-lanes.md | `01M23HNE33P57ZM2YT49S2D9NG` |
| A8-gui-create.md | `01M23HNE47A6CRR7DVRS04G8BV` |
| A9-gui-delete-archive.md | `01M23HNE5CN3WNYXDB955A79FH` |
| A10-readme-and-gates.md | `01M23HNE6GJGBMAMBRAVCSYMPK` |
| B1-server-board-info-and-history.md | `01M23HNE7M24B5NKYGAXG64QS3` |
| B2-header.md | `01M23HNE8QZ3SRABTVKZJS198F` |
| B3-column-collapse.md | `01M23HNE9W9VW16DAGT7PCNNGE` |
| B4-pan-and-autoscroll.md | `01M23HNEB0A84TMJ6WJ0Y1EHC9` |
| B5-health-and-empty-states.md | `01M23HNEC562JTWVKFQ4T9JCFB` |
| B6-label-filter.md | `01M23HNED9Y3EJSRKM68K0AKNG` |
| B7-history-panel.md | `01M23HNEED379GP41367PZ23H2` |
