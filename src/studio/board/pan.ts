/**
 * 抓著看板空白處往旁邊拉的那條算術 —— 票 B4 裡可判定的那一小塊。
 *
 * 平移本身是指標互動，**沒有自動化測試**（票面明說；`vitest.config.ts` 是
 * `environment: 'node'`，而 spec.md 的測試策略禁止 jsdom／@testing-library／
 * playwright —— mock 出來的指標事件寫得出「測過但實際壞掉」的假綠燈）。這個
 * 檔案裝的是那張票裡推得出答案的部分：**手移到哪，容器該停在哪**。住在這裡
 * 而不是 `Board.tsx` 正是為了測得到，同 `board/collapse.ts`。
 */

/** 一次平移按下去的那一瞬間：指標在哪、捲動容器當時停在哪。 */
export interface PanOrigin {
  /** pointerdown 的 `clientX`。 */
  readonly x: number;
  /** 按下去的當下捲動容器的 `scrollLeft`。 */
  readonly scrollLeft: number;
}

/**
 * 平移到哪 —— **內容跟著手走**，所以手往右移，`scrollLeft` 往下減。
 *
 * 這個減號是整張票裡唯一寫反了也照樣跑得動的地方：反過來看板會往手的反方向
 * 逃，而截圖上兩者都只是「看板動了」。
 *
 * 不夾在 `[0, maxScroll]` 之間：`el.scrollLeft = v` 自己會夾，再夾一次等於把
 * `scrollWidth` 與 `clientWidth` 拉進這個純函式，換來的行為完全相同。
 */
export function panTo(origin: PanOrigin, x: number): number {
  return origin.scrollLeft - (x - origin.x);
}

/**
 * 一次平移要走多遠才算數。**4px，與 `Board.tsx` 給 `PointerSensor` 的
 * `activationConstraint` **就是這一個常數**（`Board.tsx` import 它），因為問的是
 * 同一件事：這隻手是想按下去，
 * 還是想拉著走。卡片上分得開、空白處分不開的話，使用者會發現同樣穩的一下按得
 * 動卡片、按不動欄頂的 `+`。
 */
export const PAN_SLOP = 4;

/**
 * 這一下已經走得夠遠，是一次平移而不是一次點擊了嗎。
 *
 * **門檻存在的理由不是體感，是那顆按鈕。** 捲動容器裡有欄頂的 `+` 與折疊鈕，
 * 而平移一旦開始就會 `setPointerCapture`，接下來那個 `click` 會被改派到容器上
 * ——按鈕於是永遠按不動。等走過門檻再抓住指標，按下去的那一下就還在原處。
 *
 * 只看 x：平移是橫向的（捲動容器只有橫向溢出），縱向移動多少都不該讓一次點擊
 * 變成平移。嚴格大於則是抄 `@dnd-kit` 的 `hasExceededDistance`。
 */
export function panStarted(origin: PanOrigin, x: number): boolean {
  return Math.abs(x - origin.x) > PAN_SLOP;
}
