# B8 —— `Board` 說得出自己的根目錄

**批次**：B（追加）｜ **阻擋**：B1（`HandlerOptions.dir` 是它引入的）｜ **來源**：B1 的偏差回報

## 問題

`GET /api/board-info` 要回報這塊 board 在磁碟上的位置，但 `handleRequest` 只
拿得到一個 `Board`，而**`Board` 沒有任何方法說得出自己的根目錄**。B1 因此在
`HandlerOptions` 上開了一個 `dir?: string`，預設 `process.cwd()`。

於是同一個目錄有了**兩個真相來源**：`openBoard({ dir })` 與 `handleRequest(_, _, { dir })`。
生產路徑上它們碰巧一致（`cmdStudio` 兩邊都給 `io.cwd`），但那是巧合而不是保證 ——
一個在別處開 board 又沒傳 `dir` 的呼叫端，會拿到一個**錯的、看起來很像對的**路徑。

而 `board.ts` 裡那個值本來就已經算好並 memoise 在 `rootDir()` 裡了。

## 介面

```ts
// src/core/types.ts —— Board 介面
export interface Board {
  // …既有
  /** 這塊 board 的根目錄（含 `.issues/` 的那一層）的絕對路徑。 */
  root(): string;
}
```

`board.ts` 的實作就是 `rootDir()`，前面照既有慣例加一次 `requireInitialized()` ——
board 目錄在 Board 建立之後被移走時，該說的仍然是「不是一個 Nook board」。

`handler.ts` 改用 `board.root()`，**並把 `HandlerOptions.dir` 整個拿掉**。
`boardInfo` 的 `branch` 與 `actor` 也改成對 `board.root()` 算，四個欄位因此
必然描述同一個目錄。

## 先寫紅燈

1. `openBoard({ dir: <暫存目錄> }).root()` 回傳那個暫存目錄的絕對路徑。
2. 從**子目錄**開的 board：`root()` 回的是含 `.issues/` 的那一層，不是子目錄
   （尋根是向上找 —— 這是 `root()` 與呼叫端傳進去的 `dir` 唯一會不同的地方，
   也是這張票存在的理由）。
3. board 目錄在 `openBoard()` 之後被移走 → `root()` 拋 `BoardNotInitialized`，
   不是回一個過期的路徑。
4. `GET /api/board-info` 的 `root` 在**從子目錄開 board** 時仍然正確 ——
   這一條在 `HandlerOptions.dir` 之下是錯的，是這張票的驗收核心。
5. `HandlerOptions` 不再有 `dir`（型別層；拿掉之後既有測試若有人傳它會編不過）。

## 寫入所有權

```
src/core/types.ts
src/core/board.ts
src/server/handler.ts
test/core/board.root.test.ts        （既有檔，尋根的測試就在這裡）
test/server/handler.test.ts
```

## 注意

`src/index.ts` 的公開面**不必改** —— `Board` 是既有的轉出型別，多一個方法自然
跟著出去。但那個檔案的檔頭寫著「每一個 export 都是永久的相容性債務」：
`root()` 從此是公開承諾，票面上記一筆。

## 驗證

```bash
npx vitest run test/core test/server
npm run typecheck && npm test && npm run build
```
