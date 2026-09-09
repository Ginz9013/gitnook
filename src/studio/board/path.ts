/** 中間被拿掉的地方放這一個字元。U+2026 是**一個**字，所以長度算得準。 */
const ELLIPSIS = '…';

/**
 * 太長的 board 路徑要怎麼縮 —— **從中間拿掉整段，永遠不動尾端**。
 *
 * 從尾端截（`/Users/kouhei/Documents/repos/issue…`）會把「這是哪個 repo」切掉，
 * 而那是路徑出現在 header 上的唯一理由：同時開兩個 repo 的 studio 時，這一行
 * 是分得出來的東西。開頭那一段留著，因為它說的是「在誰的家目錄底下」——
 * 也是一種辨識，而且只花幾個字。
 *
 * **拿掉的是整段，不是幾個字元。** 從段落中間切會生出 `/Users/kou…er/.issues`
 * 這種東西，讀的人分不出 `kou…er` 是被縮過的還是那個目錄真的叫這個名字；
 * 整段拿掉之後，`…` 站的位置就是「這裡有幾層沒印出來」。
 *
 * **`max` 是目標而不是保證**：縮到只剩頭尾兩段仍然超過時，交出的就是那兩段。
 * 這是這個函式唯一一次「超過上限」，而它比另一個選項（砍尾端）好 —— 版面自己
 * 處理得了溢出，砍掉的資訊沒有人救得回來。中間沒有東西可以拿的路徑同理：
 * 原樣回傳。
 *
 * 這個函式是票 B2 裡唯一可判定的規則，所以它住在這裡而不是 `BoardHeader.tsx`
 * 裡 —— 那樣它才測得到（`test/studio/header.test.ts`），同 `board/announce.ts`。
 */
export function shortenPath(path: string, max: number): string {
  if (path.length <= max) return path;
  const segments = path.split('/');
  // 絕對路徑 split 出來的第一格是空字串 —— 那不是一段，是開頭那條斜線。
  const absolute = segments[0] === '';
  const parts = absolute ? segments.slice(1) : segments;
  const [first = ''] = parts;
  const head = (absolute ? '/' : '') + first;
  // 由長到短試：**第一個放得下的就是留得最多的那一個**。
  let shortest = path;
  for (let i = 1; i < parts.length; i++) {
    const candidate = `${head}/${ELLIPSIS}/${parts.slice(i).join('/')}`;
    if (candidate.length <= max) return candidate;
    shortest = candidate;
  }
  // 一個都放不下。最後那一次試的是「頭 + … + 最後一段」，也就是不砍尾端的
  // 前提下最短的寫法。迴圈沒跑過（只有一段的路徑）時它還是原本那條。
  return shortest;
}
