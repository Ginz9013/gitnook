import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * design token 的**對比度閘門** —— 解析 `src/studio/index.css` 的 `oklch()`
 * 值、轉 sRGB、算 WCAG 對比，light 與 dark 兩邊都斷言。
 *
 * 這是 spec.md 的測試策略裡唯一一種「看得見的東西」也測得動的：不需要瀏覽器，
 * 因此 `environment: 'node'` 不必動。**色彩數學刻意住在這個測試檔裡** —— 它在
 * `src/` 底下沒有第二個使用者，搬過去只會多一個沒人呼叫的模組。
 *
 * 「顏色好不好看」仍然是人工驗收；這裡守的是「讀不讀得到」。
 */

const CSS = readFileSync(
  fileURLToPath(new URL('../../src/studio/index.css', import.meta.url)),
  'utf8',
);

// ---------------------------------------------------------------------------
// 色彩數學
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

/** oklch → 線性 sRGB。矩陣出自 Oklab 的原始定義（Björn Ottosson）。 */
function oklchToLinear(L: number, C: number, H: number): Rgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const encode = (u: number): number =>
  u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
const decode = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

/**
 * 螢幕上真正會亮出來的那三個位元組。**先夾到 sRGB 色域再算亮度** —— 瀏覽器
 * 對超出色域的 oklch 也會做同一件事，不夾的話算出來的是一個沒有人看得到的顏色。
 */
function toRgb(L: number, C: number, H: number): Rgb {
  const [r, g, b] = oklchToLinear(L, C, H);
  const to8 = (u: number): number => Math.round(255 * Math.min(1, Math.max(0, encode(u))));
  return [to8(r), to8(g), to8(b)];
}

/** WCAG 2.x 的相對亮度。 */
function luminance([r, g, b]: Rgb): number {
  const [R, G, B] = [r, g, b].map((c) => decode(c / 255));
  return 0.2126 * R! + 0.7152 * G! + 0.0722 * B!;
}

/** WCAG 2.x 的對比度，1:1 到 21:1。 */
function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** 半透明的 token 疊在底色上之後真正的顏色 —— 不疊就量不出它的對比。 */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(fg[i]! * alpha + bg[i]! * (1 - alpha))) as unknown as Rgb;
}

// ---------------------------------------------------------------------------
// 量測工具本身的校準
// ---------------------------------------------------------------------------

/**
 * 期望值來自 CSS Color 4 對 sRGB 三原色的 oklch 座標 —— **與下面的實作各自
 * 獨立**。少了這一段，上面那些矩陣打錯一個數字時，閘門會以一組錯的顏色
 * 一路綠燈。
 */
describe('色彩轉換 —— 對已知的 sRGB 原色校準', () => {
  const hex = ([r, g, b]: Rgb): string =>
    '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

  it.each([
    ['白', [1, 0, 0], '#ffffff'],
    ['黑', [0, 0, 0], '#000000'],
    ['紅', [0.628, 0.2577, 29.234], '#ff0000'],
    ['綠', [0.8664, 0.2948, 142.495], '#00ff00'],
    ['藍', [0.452, 0.3132, 264.052], '#0000ff'],
  ] as const)('%s', (_name, [L, C, H], expected) => {
    expect(hex(toRgb(L, C, H))).toBe(expected);
  });

  it('黑對白是 21:1', () => {
    expect(contrast(toRgb(0, 0, 0), toRgb(1, 0, 0))).toBeCloseTo(21, 2);
  });
});

// ---------------------------------------------------------------------------
// 解析 index.css
// ---------------------------------------------------------------------------

interface Token {
  readonly L: number;
  readonly C: number;
  readonly H: number;
  /** 沒寫就是 1 —— 不透明。 */
  readonly alpha: number;
}

/** 抓出一個頂層區塊的內容。`:root` 與 `.dark` 都從第一欄開始，所以錨在行首。 */
function block(selector: string): string {
  const m = new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(CSS);
  if (m === null) throw new Error(`index.css 裡找不到 ${selector} 區塊`);
  return m[1]!;
}

/** 一個區塊裡宣告的所有自訂屬性，包含不是顏色的那些。 */
function declarations(selector: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const m of block(selector).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/;

function parseColor(value: string): Token | null {
  const m = OKLCH.exec(value);
  if (m === null) return null;
  const raw = m[4] === undefined ? 1 : Number(m[4]);
  return {
    L: Number(m[1]),
    C: Number(m[2]),
    H: Number(m[3]),
    alpha: m[5] === '%' ? raw / 100 : raw,
  };
}

/** 一個區塊裡**是顏色**的那些 token。 */
function colors(selector: string): ReadonlyMap<string, Token> {
  const out = new Map<string, Token>();
  for (const [name, value] of declarations(selector)) {
    const c = parseColor(value);
    if (c !== null) out.set(name, c);
  }
  return out;
}

const ROOT = colors(':root');
const DARK = colors('.dark');

/**
 * 一個 token 在某個主題下**實際生效**的值。
 *
 * `.dark` 只覆寫它自己列出來的那些，其餘照 CSS 的層疊沿用 `:root` —— 這裡
 * 忠實照做，因為「dark mode 沿用了 light 的值」正是最後那條測試要抓的東西，
 * 而不是這裡該偷偷補起來的。
 */
function tokenOf(theme: 'light' | 'dark', name: string): Token | null {
  if (theme === 'dark') return DARK.get(name) ?? ROOT.get(name) ?? null;
  return ROOT.get(name) ?? null;
}

/** token 疊在底色上之後的 sRGB —— 半透明的 token 靠 `bg` 補完。 */
function rgbOf(theme: 'light' | 'dark', name: string, bg?: Rgb): Rgb | null {
  const t = tokenOf(theme, name);
  if (t === null) return null;
  const solid = toRgb(t.L, t.C, t.H);
  return t.alpha === 1 || bg === undefined ? solid : over(solid, bg, t.alpha);
}

/** 小數點後兩位 —— 報告裡讀得出來，也不會因為浮點尾巴而假紅燈。 */
const ratio = (a: Rgb, b: Rgb): number => Math.round(contrast(a, b) * 100) / 100;

const THEMES = ['light', 'dark'] as const;

// ---------------------------------------------------------------------------
// 閘門
// ---------------------------------------------------------------------------

/** 文字對它自己的底：WCAG AA 的一般文字門檻。 */
const TEXT_PAIRS = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
] as const;

describe('文字對比 —— WCAG AA 4.5:1，兩個主題都要過', () => {
  it.each(THEMES.flatMap((theme) => TEXT_PAIRS.map(([fg, bg]) => [theme, fg, bg] as const)))(
    '%s：--%s 在 --%s 上',
    (theme, fg, bg) => {
      const bgRgb = rgbOf(theme, bg);
      const fgRgb = rgbOf(theme, fg, bgRgb ?? undefined);

      expect({ [`--${fg}`]: fgRgb !== null, [`--${bg}`]: bgRgb !== null }).toEqual({
        [`--${fg}`]: true,
        [`--${bg}`]: true,
      });
      expect(ratio(fgRgb!, bgRgb!)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

/**
 * `--border` 與 `--ring` 是 UI 元件的邊界，門檻是 WCAG 1.4.11 的 3:1。
 *
 * 「各自的底」= 它們畫得上去的每一階表面（D8 的四階）。最亮的那一階是最難
 * 過的一關，所以整組一起算比挑一個底來算誠實。
 */
const SURFACES = ['background', 'card', 'popover', 'muted'] as const;

describe('UI 元件對比 —— WCAG 3:1，兩個主題都要過', () => {
  it.each(
    THEMES.flatMap((theme) =>
      (['border', 'ring'] as const).flatMap((ui) =>
        SURFACES.map((surface) => [theme, ui, surface] as const),
      ),
    ),
  )('%s：--%s 在 --%s 上', (theme, ui, surface) => {
    const bg = rgbOf(theme, surface);
    const fg = rgbOf(theme, ui, bg ?? undefined);

    expect({ [`--${ui}`]: fg !== null, [`--${surface}`]: bg !== null }).toEqual({
      [`--${ui}`]: true,
      [`--${surface}`]: true,
    });
    expect(ratio(fg!, bg!)).toBeGreaterThanOrEqual(3);
  });
});

/**
 * **`.dark` 少一格，就是那個顏色在 dark mode 下沿用了 light 的值** —— 而那是
 * 靜靜壞掉的一種：它自己那對前景／底色照樣過得了上面的對比閘門（一對顏色的
 * 比值與它擺在哪個主題無關），畫面上卻是一塊亮色貼在深色版面裡。
 *
 * 所以名稱集合要相等，而不是逐一去量。
 */
describe('token 覆蓋的完整性', () => {
  it('.dark 定義的顏色 token 集合等於 :root 的', () => {
    expect([...DARK.keys()].sort()).toEqual([...ROOT.keys()].sort());
  });

  /**
   * 上面那條只看得到「顏色」。非顏色的自訂屬性若悄悄多一個，它會從集合裡消失
   * 而不驚動任何人 —— 所以這裡把那份名單釘住：目前就只有 `--radius`。
   */
  it(':root 裡唯一不是顏色的 token 是 --radius', () => {
    const notColors = [...declarations(':root').keys()].filter((n) => !ROOT.has(n));

    expect(notColors).toEqual(['radius']);
  });
});
