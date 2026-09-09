# A9 —— GUI 刪除與封存：drawer 上兩顆按鈕、刪除要確認

**批次**：A ｜ **阻擋**：A8（`App.tsx` 寫入所有權）、A4、A5
**本片段無自動化測試**，除了 `changes.ts` 那兩個純函式。

## 目標

drawer 目前**只把 `archived` 畫成一個 Badge**（`IssueDetail.tsx:51`），
沒有任何地方切得動它；刪除則完全不存在。

**封存與刪除是兩件事，兩顆都要有**（D4）。`cancelled` 不做按鈕 —— 拖過去就好。

## 介面

```ts
// src/studio/drawer/changes.ts
export function archiveChange(next: boolean, current: boolean): DrawerChange | undefined;
export function deleteChange(): DrawerChange;    // { deleted: true }
```

`archiveChange` 沿用既有慣例：沒有變化就不送（op-log 是 append-only，
一個什麼都沒改的點擊不該在歷史上留下痕跡）。

## 先寫紅燈（只有這兩個純函式）

1. `archiveChange(true, false)` → `{ archived: true }`；`archiveChange(false, false)` → `undefined`。
2. `deleteChange()` → `{ deleted: true }`。
3. 兩者的回傳值都可指派給 `Change`（型別層 —— 多送一個鍵就是一次 400）。

## 綠燈

**封存**：drawer 上一顆切換（「封存」／「取消封存」），語意是可見性。
按下去那張從看板上消失（除非開著「顯示已封存」），但 `--all` 還看得到。

**刪除**：一顆 destructive 的按鈕，**開 AlertDialog 確認**。
- `@radix-ui/react-alert-dialog` **已經在 `devDependencies` 裡但沒有任何一行
  import 它** —— 這張票是它的第一個使用者。用 shadcn 的 `alert-dialog` 慣例
  加進 `components/ui/`。
- 確認框要說清楚**它跟封存不一樣**：刪除之後 `nook list --all` 也看不到，
  但 **`nook history <ref>` 撈得回來**（誤刪的救生索）。這句話要在框裡，
  不是在文件裡 —— 讀它的人正在猶豫要不要按。
- 確認後 `App` 送 `{ deleted: true }`，ACK 回來時 A5 的規則把它移出快照，
  drawer 隨之關閉（`selectedId` 指向的那張不在了）。

**視覺**：刪除按鈕用 `--destructive`，是這一版唯一該用到那個 token 的地方之一。

## 無障礙

- AlertDialog 的 focus trap、`aria-modal` 交給 Radix。
- **關閉後的焦點**：確認取消 → 回到刪除按鈕；確認刪除 → 那張卡片不在了，
  焦點退回看板的 landmark（`focus.ts` 已有這條退路，`Board.tsx` 的 `tabIndex={-1}`）。

## 寫入所有權

```
src/studio/drawer/IssueDetail.tsx
src/studio/drawer/changes.ts
src/studio/components/ui/alert-dialog.tsx    （新）
src/studio/App.tsx
test/studio/changes.test.ts                  （新，或併入既有 studio 測試）
```

## 驗證

```bash
npx vitest run test/studio && npm run typecheck && npm test && npm run build
npm run nook -- studio     # 人工：封存往返、刪除確認、取消確認、刪除後 drawer 關閉
node node_modules/gitnook/bin/nook.js list --all   # 舊版仍看得見被刪的那張（向前相容）
```
