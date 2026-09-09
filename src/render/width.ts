/**
 * 終端機顯示欄寬。等寬輸出的補齊必須按這個值算，不能按字元數 ——
 * 全形字一個字元佔兩欄，用 `String.length` 補齊會讓整排欄位跑掉。
 *
 * 零相依是產品主張（README），所以這裡自己寫而不引入 `string-width`。
 * 範圍表取自 Unicode EastAsianWidth 的 W 與 F 兩類，涵蓋 CJK、假名、
 * 諺文、全形標點與常見 emoji —— 不是一份完整的 Unicode 實作，而是
 * 一份足以讓 compact table 對齊的實作（ADR-0005）。
 */

/** East Asian Width 為 W（Wide）或 F（Fullwidth）的碼位。由小到大排序。 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo 初聲
  [0x2e80, 0x303e], // CJK 部首補充、康熙部首、CJK 符號與標點（含「」）
  [0x3041, 0x33ff], // 平假名、片假名、注音、諺文相容字母、CJK 相容
  [0x3400, 0x4dbf], // CJK 統一表意文字 擴充 A
  [0x4e00, 0x9fff], // CJK 統一表意文字
  [0xa000, 0xa4cf], // 彝文
  [0xa960, 0xa97f], // Hangul Jamo 擴充 A
  [0xac00, 0xd7a3], // 諺文音節
  [0xf900, 0xfaff], // CJK 相容表意文字
  [0xfe10, 0xfe19], // 直排標點
  [0xfe30, 0xfe6f], // CJK 相容形式、小寫變體、全形標點變體
  [0xff00, 0xff60], // 全形 ASCII 變體（含全形括號）
  [0xffe0, 0xffe6], // 全形貨幣符號
  [0x1f300, 0x1f64f], // 雜項符號與圖形、表情
  [0x1f900, 0x1f9ff], // 補充符號與圖形
  [0x20000, 0x2fffd], // CJK 擴充 B 之後
  [0x30000, 0x3fffd],
];

/** 不佔欄寬的碼位：組合附加符號、變體選擇符、零寬與格式字元。 */
const ZERO: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], // 組合附加符號
  [0x0483, 0x0489],
  [0x1ab0, 0x1aff], // 組合附加符號 擴充
  [0x1dc0, 0x1dff], // 組合附加符號 補充
  [0x200b, 0x200f], // 零寬空格、零寬連字、方向標記
  [0x2060, 0x2064], // 單詞連接符等
  [0x20d0, 0x20ff], // 符號用組合附加符號
  [0xfe00, 0xfe0f], // 變體選擇符
  [0xfe20, 0xfe2f], // 組合半形符號
  [0xfeff, 0xfeff], // BOM
];

/** 範圍表由小到大排序，因此可在越過目標時提前結束。 */
function inRanges(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

/**
 * 單一碼位的欄寬。
 *
 * Ambiguous（如 `…`、重音字母）一律算一欄，這是 wcwidth 的慣例：
 * 兩可時算窄只會讓欄位稍寬，算寬則會讓非 CJK 語系的終端整排跑掉。
 */
function codePointWidth(cp: number): number {
  // C0/C1 控制字元。不該出現在表格裡，但出現時不該讓補齊算出負數。
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (inRanges(cp, ZERO)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

/**
 * 一段文字的顯示欄寬。
 *
 * 以碼位而非 UTF-16 code unit 迭代 —— 代理對（emoji、CJK 擴充 B）是
 * 兩個 code unit，按 `String.length` 會算成兩倍。
 */
export function displayWidth(text: string): number {
  let total = 0;
  for (const ch of text) total += codePointWidth(ch.codePointAt(0)!);
  return total;
}
