import { describe, it, expect } from 'vitest';
import {
  bodyChange,
  dispositionChange,
  supersededByChange,
  titleChange,
} from '../../src/studio/decisionDrawer/decisionChanges.js';
import type { DecisionChange, Disposition } from '../../src/studio/api.js';

// 純函式，environment: 'node'。不碰 DOM、不 import React —— 同
// `test/studio/changes.test.ts` 對 Issue 側 `changes.ts` 的既有手法。
// spec.md 的測試策略：只測純邏輯，React 組件不寫測試。

describe('titleChange', () => {
  it('有變化時送出新標題', () => {
    expect(titleChange('Adopt trunk-based development', 'Adopt trunk based dev')).toEqual({
      title: 'Adopt trunk-based development',
    });
  });

  it('trim 後為空視為誤觸，不送出任何東西', () => {
    expect(titleChange('   ', 'Adopt trunk-based development')).toBeUndefined();
  });

  it('沒有變化就不送', () => {
    expect(titleChange('Adopt trunk-based development', 'Adopt trunk-based development')).toBeUndefined();
  });
});

describe('bodyChange', () => {
  it('有變化時送出新內文，不 trim', () => {
    // 尾端空行與縮排是 markdown 內容的一部分 —— 同 descriptionChange 的既有態度。
    expect(bodyChange('line one\n\n  indented\n', 'line one')).toEqual({
      body: 'line one\n\n  indented\n',
    });
  });

  it('沒有變化就不送', () => {
    expect(bodyChange('same body', 'same body')).toBeUndefined();
  });
});

describe('dispositionChange', () => {
  it('有變化時送出新 disposition', () => {
    const next: Disposition = 'accepted';
    const current: Disposition = 'proposed';
    expect(dispositionChange(next, current)).toEqual({ disposition: 'accepted' });
  });

  it('沒有變化就不送 —— 四個值一視同仁，沒有特例', () => {
    for (const d of ['proposed', 'accepted', 'superseded', 'rejected'] as const) {
      expect(dispositionChange(d, d)).toBeUndefined();
    }
  });
});

describe('supersededByChange', () => {
  it('有變化時送出新值，不 trim（純文字輸入，不解析、不驗證）', () => {
    expect(supersededByChange('01JBXA  ', '')).toEqual({ supersededBy: '01JBXA  ' });
  });

  it('沒有變化就不送', () => {
    expect(supersededByChange('01JBXA', '01JBXA')).toBeUndefined();
  });
});

/**
 * 型別層。`POST /d/<ref>` 對不認得的欄位回 400 而不是忽略，所以「多送一個
 * 鍵」不是一個無害的多餘欄位，是一次失敗的寫入 —— 同 `changes.test.ts` 對
 * `Change` 的既有斷言。這一條由 `tsc` 判定，`expect` 只是讓它有個歸屬。
 */
describe('送得出去的形狀', () => {
  it('三個函式的回傳值都指派得給 DecisionChange', () => {
    const title: DecisionChange | undefined = titleChange('x', 'y');
    const body: DecisionChange | undefined = bodyChange('x', 'y');
    const disposition: DecisionChange | undefined = dispositionChange('accepted', 'proposed');
    const supersededBy: DecisionChange | undefined = supersededByChange('x', 'y');
    expect({ ...title, ...body, ...disposition, ...supersededBy }).toEqual({
      title: 'x',
      body: 'x',
      disposition: 'accepted',
      supersededBy: 'x',
    });
  });
});
