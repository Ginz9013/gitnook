import { describe, it, expect } from 'vitest';
import {
  readActiveView,
  readCollapsed,
  readTheme,
  resolveTheme,
  writeActiveView,
  writeCollapsed,
  writeTheme,
} from '../../src/studio/prefs.js';
import type { PrefStorage } from '../../src/studio/prefs.js';

// 純模組，environment: 'node'。storage 是注入的，所以不需要 jsdom
// （spec.md 的測試策略：不得新增 jsdom / @testing-library / playwright）。

/** `localStorage` 的替身 —— 介面只有兩個方法，所以一個 Map 包一層就夠。 */
const storage = (entries: Record<string, string> = {}): PrefStorage => {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
};

describe('readTheme', () => {
  it('空的 storage 回 system —— 第一次開 studio 的人跟著作業系統走', () => {
    expect(readTheme(storage())).toBe('system');
  });

  it('寫進去的偏好讀得回來', () => {
    const s = storage();
    writeTheme(s, 'dark');

    expect(readTheme(s)).toBe('dark');
  });

  /**
   * `localStorage` 裡的東西是使用者的瀏覽器說了算 —— 開 devtools 手改一格、
   * 或是舊版留下的格式，都不該讓整個看板開不起來。壞值一律退回預設。
   */
  it.each([
    ['不是三個值之一', 'purple'],
    ['空的 JSON 陣列', '[]'],
    ['根本不是 JSON', '{oops'],
    ['空字串', ''],
  ])('手改成 %s 時退回 system 而不拋', (_label, raw) => {
    const s = storage({ 'nook.studio.theme': raw });

    expect(() => readTheme(s)).not.toThrow();
    expect(readTheme(s)).toBe('system');
  });
});

/**
 * 偏好有三個值，實際套上 `<html>` 的 class 只有兩個。`'system'` 是**唯一**
 * 會去看 `prefers-color-scheme` 的那一個 —— 明講的偏好蓋過作業系統。
 */
describe('resolveTheme', () => {
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
  ] as const)('resolveTheme(%s, systemDark=%s) → %s', (pref, systemDark, expected) => {
    expect(resolveTheme(pref, systemDark)).toBe(expected);
  });
});

/**
 * 欄位折疊與主題是同一種東西：只影響這台機器上這個人怎麼看，不進 op-log。
 * 期望值是八個 Status 裡的名字（ADR-0003 固定的那八個），不是跑出來的。
 */
describe('readCollapsed / writeCollapsed', () => {
  it('寫進去的欄位集合原樣讀得回來', () => {
    const s = storage();
    writeCollapsed(s, new Set(['done', 'cancelled']));

    expect([...readCollapsed(s)].sort()).toEqual(['cancelled', 'done']);
  });

  it('空集合也是一個有效的偏好 —— 全部展開', () => {
    const s = storage();
    writeCollapsed(s, new Set(['done']));
    writeCollapsed(s, new Set());

    expect([...readCollapsed(s)]).toEqual([]);
  });
});

/**
 * 頂層視圖偏好（Issues／Decisions）。同 `readTheme` 的既有模式：任何讀不懂
 * 的值都退回預設 `'issues'`，絕不拋 —— 這一格決定的是重新整理後掛哪一個
 * composition root，讀壞了不該讓整個 studio 開不起來。
 */
describe('readActiveView', () => {
  it('空的 storage 回 issues —— 第一次開 studio 停在 Issues 視圖', () => {
    expect(readActiveView(storage())).toBe('issues');
  });

  it('寫進去的偏好讀得回來', () => {
    const s = storage();
    writeActiveView(s, 'decisions');

    expect(readActiveView(s)).toBe('decisions');
  });

  it.each([
    ['不是兩個值之一', 'kanban'],
    ['空的 JSON 陣列', '[]'],
    ['根本不是 JSON', '{oops'],
    ['空字串', ''],
  ])('手改成 %s 時退回 issues 而不拋', (_label, raw) => {
    const s = storage({ 'nook.studio.activeView': raw });

    expect(() => readActiveView(s)).not.toThrow();
    expect(readActiveView(s)).toBe('issues');
  });
});

describe('readCollapsed —— 壞掉的儲存值', () => {
  /**
   * **逐項丟掉**而不是整份作廢：一個被改壞、或是舊版留下的欄位名字，
   * 不該讓其餘七欄的折疊偏好一起消失。
   */
  it('不是 Status 的字串逐項丟掉，其餘保留', () => {
    const s = storage({
      'nook.studio.collapsed': JSON.stringify(['done', 'lane', 'todo', 42, null, 'archived']),
    });

    expect([...readCollapsed(s)].sort()).toEqual(['done', 'todo']);
  });

  it.each([
    ['空的 storage', null],
    ['根本不是 JSON', '{oops'],
    ['是 JSON 但不是陣列', '"done"'],
    ['是物件不是陣列', '{"done":true}'],
  ])('%s → 空集合而不拋', (_label, raw) => {
    const s = raw === null ? storage() : storage({ 'nook.studio.collapsed': raw });

    expect(() => readCollapsed(s)).not.toThrow();
    expect([...readCollapsed(s)]).toEqual([]);
  });
});
