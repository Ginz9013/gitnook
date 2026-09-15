import { describe, it, expect } from 'vitest';

import { isDecisionBoardSnapshot } from '../../src/studio/api.js';

// 純函式，environment: 'node'。同 `poll.test.ts` 裡 `isBoardSnapshot` 的既有
// 手法：形狀守衛只看頂層，擋的是「打錯 port，另一個 server 在那裡回了 JSON」。

describe('isDecisionBoardSnapshot — 合法的 JSON 不等於承諾的形狀', () => {
  it('缺 decisions/hash 兩格的物件不是', () => {
    expect(isDecisionBoardSnapshot({ nope: 1 })).toBe(false);
  });

  it('兩格都在且形狀對，就是', () => {
    expect(isDecisionBoardSnapshot({ decisions: [], hash: 'a3f' })).toBe(true);
  });
});

describe('isDecisionBoardSnapshot — 頂層的兩格都要對', () => {
  it('decisions 不是陣列時不是', () => {
    expect(isDecisionBoardSnapshot({ decisions: { 0: 'x' }, hash: 'a3f' })).toBe(false);
  });

  it('hash 不是字串時不是', () => {
    expect(isDecisionBoardSnapshot({ decisions: [], hash: 42 })).toBe(false);
  });

  it('少了 hash 時不是', () => {
    expect(isDecisionBoardSnapshot({ decisions: [] })).toBe(false);
  });
});

describe('isDecisionBoardSnapshot — 不是物件的 body 同樣解得開', () => {
  it('null 不是', () => {
    expect(isDecisionBoardSnapshot(null)).toBe(false);
  });

  it('字串與陣列都不是', () => {
    expect(isDecisionBoardSnapshot('"ok"')).toBe(false);
    expect(isDecisionBoardSnapshot([])).toBe(false);
  });
});

describe('isDecisionBoardSnapshot — 只檢頂層是刻意的', () => {
  it('decisions 陣列裡的元素形狀不對也算過', () => {
    expect(isDecisionBoardSnapshot({ decisions: [{ nope: 1 }], hash: 'a3f' })).toBe(true);
  });
});
