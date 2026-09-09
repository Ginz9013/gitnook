import { describe, it, expect } from 'vitest';
import { displayWidth } from '../../src/render/width.js';

describe('displayWidth', () => {
  it('ASCII 一字元一欄', () => {
    expect(displayWidth('Fix login redirect')).toBe(18);
    expect(displayWidth('')).toBe(0);
  });

  it('CJK 表意文字佔兩欄', () => {
    expect(displayWidth('開發')).toBe(4);
    expect(displayWidth('用 nook 管')).toBe(10);
  });

  it('全形標點佔兩欄 —— dogfood 撞到的就是這個', () => {
    // （）U+FF08/FF09 是 Fullwidth，「」U+300C/U+300D 是 Wide。
    expect(displayWidth('（dogfood）')).toBe(11);
    expect(displayWidth('「剛建立」')).toBe(10);
  });

  it('假名與諺文佔兩欄', () => {
    expect(displayWidth('ひらがな')).toBe(8);
    expect(displayWidth('カタカナ')).toBe(8);
    expect(displayWidth('한글')).toBe(4);
  });

  it('組合附加符號不佔欄寬', () => {
    // e + U+0301 combining acute：兩個 code point，一欄。
    expect(displayWidth('e\u0301')).toBe(1);
    expect(displayWidth('\u200B')).toBe(0);
  });

  it('代理對只算一次，emoji 佔兩欄', () => {
    expect('🔥'.length).toBe(2); // UTF-16 是兩個 code unit
    expect(displayWidth('🔥')).toBe(2);
  });

  it('Ambiguous 一律算一欄（wcwidth 的慣例）', () => {
    // 省略號與重音字母的 East Asian Width 是 Ambiguous。窄寬兩可時取窄，
    // 算窄只會讓欄位稍寬，算寬會讓非 CJK 語系的終端整排跑掉。
    expect(displayWidth('\u2026')).toBe(1);
    expect(displayWidth('\u00E9')).toBe(1);
  });
});
