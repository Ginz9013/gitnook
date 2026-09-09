import { describe, it, expect } from 'vitest';

import { allLabels, matchesLabels } from '../../src/studio/board/filter.js';

// 純函式，environment: 'node'。不 import React、不碰 DOM
// （spec.md 的測試策略：React 組件不寫測試，不得新增 jsdom／@testing-library／playwright）。
//
// 票 B6 的面板與 header 的接線**沒有自動化測試**，票面明說。這個檔案裝的是那張票
// 裡可判定的兩條規則：板上有哪些 Label、以及一張 Issue 中不中選。它們住在
// `board/filter.ts` 正是為了測得到，同 `board/path.ts`、`board/collapse.ts`、
// `board/health.ts` 與 `drawer/history.ts`。

const issue = (...labels: string[]): { readonly labels: readonly string[] } => ({ labels });

/**
 * 面板列出來的那份清單 —— 去重，而且**依出現順序**。
 *
 * 不排序是刻意的（票面）：Label 沒有順序，而排序會讓面板每次資料變動就重排。
 */
describe('allLabels —— 板上出現過的 Label', () => {
  /**
   * 這幾個 Label 的**出現順序與字典序刻意不同** —— 照字典序是
   * `['bug', 'p1', 'ux']`。相同的兩份會讓這條測試對「偷偷排序」完全無感，
   * 而不排序正是票面點名的那個決定。
   */
  it('依出現順序去重，不排序', () => {
    expect(allLabels([issue('ux', 'p1'), issue('p1', 'bug'), issue('ux')])).toEqual([
      'ux',
      'p1',
      'bug',
    ]);
  });

  /**
   * 零張 Issue 的 board。面板要畫得出「還沒有任何 Label」而不是炸開 ——
   * 攤平時最順手的 `reduce` 少了初始值正好在這裡丟 TypeError。
   */
  it('零張 Issue 回空陣列', () => {
    expect(allLabels([])).toEqual([]);
  });
});

/**
 * 一張 Issue 中不中選。與 core `Filter.labels` 同一套收斂語意
 * （`board.ts:141`：`labels.every((l) => i.labels.includes(l))`）—— 過濾越加越窄。
 */
describe('matchesLabels —— 沒有選任何 Label 就是不篩選', () => {
  it('選擇是空的時候每一張都中', () => {
    expect(matchesLabels(issue('bug'), [])).toBe(true);
  });

  it('連 Label 都沒有的那一張也中', () => {
    expect(matchesLabels(issue(), [])).toBe(true);
  });
});

/**
 * 多選之間是 **AND**，不是 OR。票面與 spec 都寫死了這一條：過濾應該越加越窄，
 * 而 OR 會讓「再選一個 Label」把畫面上的 Issue 變多 —— 那與使用者按下第二個
 * 勾勾的意圖相反。
 */
describe('matchesLabels —— 多選之間是 AND', () => {
  it('選一個時有那個 Label 的中', () => {
    expect(matchesLabels(issue('bug', 'p1'), ['bug'])).toBe(true);
  });

  it('選一個時沒有那個 Label 的不中', () => {
    expect(matchesLabels(issue('ux'), ['bug'])).toBe(false);
  });

  it('選兩個時兩個都有才中', () => {
    expect(matchesLabels(issue('bug', 'p1', 'ux'), ['bug', 'p1'])).toBe(true);
  });

  it('選兩個時只中一個不算中 —— 這裡是 AND 不是 OR', () => {
    expect(matchesLabels(issue('bug', 'ux'), ['bug', 'p1'])).toBe(false);
  });
});

/**
 * **Label 大小寫敏感。** Label 是自由文字 —— 大小寫不敏感的是 Ref，那是刻意的
 * （ADR-0006），而這裡不是。`Bug` 與 `bug` 是使用者打出來的兩個不同的字，
 * 前端不該替他決定它們是同一個。
 */
describe('大小寫敏感 —— Label 是自由文字，不是 Ref', () => {
  it('大小寫不同的 Label 不中', () => {
    expect(matchesLabels(issue('Bug'), ['bug'])).toBe(false);
  });

  it('大小寫不同的 Label 是清單上的兩格', () => {
    expect(allLabels([issue('Bug'), issue('bug')])).toEqual(['Bug', 'bug']);
  });
});
