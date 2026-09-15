import { describe, it, expect } from 'vitest';

import { filterByDisposition } from '../../src/studio/decisions/filter.js';

// 純函式，environment: 'node'。不 import React、不碰 DOM
// （spec.md 的測試策略：React 組件不寫測試，不得新增 jsdom／@testing-library／playwright）。

const decision = (id: string, disposition: string): { readonly id: string; readonly disposition: string } => ({
  id,
  disposition,
});

describe('filterByDisposition —— 沒有指定 disposition 就是不篩選', () => {
  it('undefined 時原樣回傳全部', () => {
    const all = [decision('a', 'proposed'), decision('b', 'accepted')];

    expect(filterByDisposition(all, undefined)).toEqual(all);
  });

  it('零筆 Decision 回空陣列，不炸開', () => {
    expect(filterByDisposition([], 'proposed')).toEqual([]);
  });
});

describe('filterByDisposition —— 指定一個值時只留下那個 disposition', () => {
  it('只留下 disposition 相符的那些', () => {
    const all = [
      decision('a', 'proposed'),
      decision('b', 'accepted'),
      decision('c', 'proposed'),
    ];

    expect(filterByDisposition(all, 'proposed').map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('沒有任何一筆相符時回空陣列', () => {
    const all = [decision('a', 'proposed')];

    expect(filterByDisposition(all, 'rejected')).toEqual([]);
  });
});
