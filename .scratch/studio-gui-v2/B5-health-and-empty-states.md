# B5 —— `.gitattributes` 警示、空看板、載入中

**批次**：B ｜ **阻擋**：B2（header）
**本片段無自動化測試**

## 目標

三個現在什麼都不說的時刻。

## 1. `.gitattributes` 少了 `merge=union`

`.issues/issues/*.ndjson merge=union` 是**整個系統的唯一單點失效**（ADR-0001）：
被誤刪時資料會靜默開始衝突。CLI 的 `list`／`show` 會警告、`doctor` 會擋，
**studio 目前一聲不吭。**

用 B1 的 `/api/board-info` 裡的 `diagnostics`，在 header 底下畫一條顯眼的
警示條（`--destructive`）：說出缺了什麼、以及**下一步是 `nook init`**
（它會把那一行補回來）。**只在有問題時出現** —— 一個永遠在那裡的健康指示器
沒有人會讀。

其餘 `Diagnostic`（`GluedLine`、`UnparsableLine`、`UnknownOp`）同樣列出來，
並指向 `nook doctor --fix`。

## 2. 零張 Issue

現在是八個空欄，什麼都不說。改成：八欄照樣在（它們是版面），
但在看板中央疊一段話 —— 這塊 board 還沒有 Issue，**按 header 的新增，
或在終端機跑 `nook new`**。兩條路都講，因為使用者可能是從 CLI 過來的。

## 3. 載入中

現在是一行「載入中…」（`App.tsx:189`）。改成看板骨架：八欄的框先畫出來，
卡片位置放 skeleton。理由是版面不要跳 —— 資料到達時整個畫面重排，
在 localhost 上是一次閃爍。

## 4. 讀不到 board

`App.tsx:181` 現在是「讀不到 board：{error}」。**server 自己說的話優先**
（同 `StatusBanner` 既有的模型，那段註解說得很清楚）—— 確認 `handler.ts` 的
`serverError` 那句可行動的訊息（「不是一個 Nook board：/path…」）真的顯示出來，
並補上「在 repo 根目錄跑 `nook init`」。

## 寫入所有權

```
src/studio/board/BoardHeader.tsx
src/studio/board/Board.tsx
src/studio/App.tsx
src/studio/api.ts
```
