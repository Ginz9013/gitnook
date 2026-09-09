# A10 —— README 與閘門收尾

**批次**：A ｜ **阻擋**：A1–A9 全部 ｜ **本片段無自動化測試**（文件 + 既有閘門）

## 目標

批 A 的驗收條件逐條走一遍，並補上唯一還沒被任何票認領的文件。

## README.md

- 特性清單補上刪除，**並且立刻說明它不 unlink 檔案** —— 一個只寫「支援刪除」
  的 README 會讓人以為位元組沒了。
- `nook rm` 進指令表。
- studio 那一段：拿掉車道與閘門的描述（ADR-0010），補上新增／刪除／封存／主題。
- **「the CLI has zero runtime dependencies」那句不要動** —— ADR-0008 收斂過的措辭
  仍然正確：`dependencies` 依然是空的。

## 閘門逐條確認

```bash
npm run typecheck                 # 必須乾淨
npm test                          # 基準線是 416 個測試全過，只准增加
npm run build                     # 絕不可只跑 npx tsup
npm run bench                     # studio bundle 未進 CLI 鏈；react/createRoot/radix/tailwind 必須為零
```

## 批 A 驗收條件（spec 第 1–6 條）逐條人工走過

1. studio 上新增一張，不回終端機。
2. drawer 上封存、取消封存、刪除；刪除有確認框，按下後那張消失。
3. `nook rm <ref>` 同效；`list --all` 不列；`history` 撈得回；`show` 說得出「已被刪除」。
4. **舊版 nook（`node_modules/gitnook`）讀同一塊 board，被刪的那張仍然看得見** ——
   向前相容的失敗方向正確。
5. 主題可切三態，重新整理後記得；對比度測試綠。
6. `grep -rn "車道\|授權閘門\|LANE_OF\|STATUS_LANES\|authorize\|opensLane" src/studio/`
   **零結果**。

## 寫入所有權

```
README.md
```
