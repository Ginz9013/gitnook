# A6 —— design token 換成 nook 自己的顏色、light/dark 真的接上線、`prefs.ts`

**批次**：A ｜ **阻擋**：無 ｜ **獨佔 `src/studio/index.css`，其他票不得碰**

## 目標

`index.css` 目前是原封不動的 shadcn 預設值：18 個中性灰，**有一個 `.dark` 區塊
但沒有任何地方會加上那個 class**，也沒有切換器。

## 介面

### token（`index.css`）

- **沿用 shadcn 的 18 格架構**，換成 nook 自己的顏色。**不做 per-Status 的顏色**
  —— 重點在卡片，欄位顏色會搶戲（D7）。
- **四階深淺，卡片最浮**（D8）：頁面底（最沉）→ 欄位底（凹槽）→ 卡片（最亮，
  唯一有 shadow）→ drawer／popover（同卡片階，靠 shadow 分開）。
  **dark mode 階序不變** —— 不是「全部變暗」，卡片仍然是最亮的那一階。
- **主色** `--primary`：`oklch(0.55 0.10 200)`（light）／`oklch(0.72 0.11 200)`（dark）。
  它**不再背負任何語意**（ADR-0010），就是按鈕與連結的顏色。
- **回饋色三格**（D9）：`--destructive`（紅）、**新增 `--success` / `--success-foreground`**（綠）、
  `--ring`（高亮／焦點，**從中性灰換成看得出來的顏色**）。
  **不開 `--warning`** —— 現在沒有「不算錯但要注意」的狀態；開一格沒有使用者的
  token，下一個人就會拿它去畫別的東西。
- `@theme inline` 同步加上 `--color-success` / `--color-success-foreground`。
- **改掉那句過期註解**：檔頭寫著「欄位本身用 `--surface` 系列」，而 `--surface*`
  這組 token 從來不存在。

### `src/studio/prefs.ts`（新）

主題與欄位折疊是同一種東西：**只影響這台機器上這個人怎麼看，不進 op-log。**
一個模組、一道 storage 接縫、兩個使用者。

```ts
export type ThemePreference = 'light' | 'dark' | 'system';
export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function readTheme(s: PrefStorage): ThemePreference;
export function writeTheme(s: PrefStorage, p: ThemePreference): void;
export function resolveTheme(p: ThemePreference, systemDark: boolean): 'light' | 'dark';
export function readCollapsed(s: PrefStorage): ReadonlySet<Status>;
export function writeCollapsed(s: PrefStorage, c: ReadonlySet<Status>): void;
```

storage **注入**，所以測得動而不需要 jsdom —— 測試傳一個 `Map` 包一層就好。

## 先寫紅燈

**`test/studio/prefs.test.ts`**

1. 空 storage → `readTheme` 回 `'system'`。
2. 手改成 `"purple"` / `"[]"` / 非 JSON → **退回預設，不拋**。
   `localStorage` 裡的東西是使用者的瀏覽器說了算，一個手改過的值不該讓看板開不起來。
3. `resolveTheme('system', true) === 'dark'`；`resolveTheme('light', true) === 'light'`。
4. `writeCollapsed` → `readCollapsed` 往返相同。
5. `readCollapsed` 遇到不是 Status 的字串**逐項丟掉**，其餘保留。

**`test/studio/tokens.test.ts` —— 對比度閘門**

解析 `src/studio/index.css` 的 `oklch()` 值、轉 sRGB、算 WCAG 對比、斷言：

6. `foreground` / `background`、`card-foreground` / `card`、
   `muted-foreground` / `muted`、`primary-foreground` / `primary`、
   `destructive-foreground` / `destructive`、`success-foreground` / `success`
   —— **文字 ≥ 4.5:1**，`:root` 與 `.dark` **兩邊都要過**。
7. `--border` / `--ring` 對各自的底 —— **UI 元件 ≥ 3:1**，兩邊都要過。
8. `.dark` 定義的 token 名稱集合 **等於** `:root` 的（少一格就是那個顏色在
   dark mode 下沿用 light 的值 —— 而那是靜靜壞掉的一種）。

色彩數學寫在測試檔裡。**不要為它在 `src/` 開一個沒有第二個使用者的模組。**

## 綠燈

- `main.tsx`：讀偏好、監聽 `prefers-color-scheme`、在 `<html>` 上加／拿掉 `.dark`。
- `components/ThemeToggle.tsx`：亮／暗／跟隨系統三態。
- **本批先把它掛在畫面右上角的固定位置** —— 票 B1 會把它搬進 header。
  這是知情的兩步：批 A 要能切主題，而 header 是批 B 的事。

## 寫入所有權

```
src/studio/index.css                    ← 獨佔
src/studio/prefs.ts                     （新）
src/studio/components/ThemeToggle.tsx   （新）
src/studio/main.tsx
test/studio/prefs.test.ts               （新）
test/studio/tokens.test.ts              （新）
```

## 驗證

```bash
npx vitest run test/studio
npm run build      # 絕不可只跑 npx tsup —— 它會清掉 dist/studio/
npm run nook -- studio      # 人工：兩個主題各看一遍，重新整理後記得
```
