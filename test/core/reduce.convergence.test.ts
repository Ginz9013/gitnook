import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/core/reduce.js';
import type { Op } from '../../src/core/ops.js';

// reduce() 是內部接縫（spec.md「內部接縫」）：收斂性最適合屬性測試。
// 期望值取自 ADR-0001 的規則 —— dedupe by id、以 (t, a, id) 全序排序、fold ——
// 而非執行結果。

const ISSUE = '01JBX7A9Q3';

/** 種子化 PRNG，讓「任意順序」在 CI 上可重現。 */
function shuffler(seed: number): <T>(xs: readonly T[]) => T[] {
  let s = seed;
  const next = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  return <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
}

describe('set op 的 fold', () => {
  const ops: readonly Op[] = [
    { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Fix login redirect' },
    { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'status', v: 'queued' },
    { id: '01C', t: 3, a: 'k3f9', op: 'set', k: 'status', v: 'in_progress' },
    { id: '01D', t: 4, a: 'k3f9', op: 'set', k: 'title', v: 'Fix login redirect on Safari' },
  ];

  it('最大 t 的 set 決定欄位值', () => {
    const issue = reduce(ISSUE, ops);

    expect(issue.status).toBe('in_progress');
    expect(issue.title).toBe('Fix login redirect on Safari');
  });

  it('交換律：任意順序摺疊出同一張 Issue', () => {
    const expected = {
      id: ISSUE,
      title: 'Fix login redirect on Safari',
      status: 'in_progress',
      description: '',
      labels: [],
      archived: false,
      deleted: false,
      comments: [],
    };

    for (let seed = 0; seed < 200; seed++) {
      expect(reduce(ISSUE, shuffler(seed)(ops))).toEqual(expected);
    }
  });
});

describe('相同 t 的決勝', () => {
  it('以 a 決勝 —— 全序中較後者勝出', () => {
    const ops: readonly Op[] = [
      { id: '01A', t: 1, a: 'aaaa', op: 'create', title: 'Fix login redirect' },
      { id: '01B', t: 2, a: 'aaaa', op: 'set', k: 'status', v: 'review' },
      { id: '01C', t: 2, a: 'zzzz', op: 'set', k: 'status', v: 'done' },
    ];

    for (let seed = 0; seed < 50; seed++) {
      expect(reduce(ISSUE, shuffler(seed)(ops)).status).toBe('done');
    }
  });

  it('a 也相同時以 id 決勝', () => {
    const ops: readonly Op[] = [
      { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Fix login redirect' },
      { id: '01M', t: 2, a: 'k3f9', op: 'set', k: 'status', v: 'review' },
      { id: '01Z', t: 2, a: 'k3f9', op: 'set', k: 'status', v: 'done' },
    ];

    for (let seed = 0; seed < 50; seed++) {
      expect(reduce(ISSUE, shuffler(seed)(ops)).status).toBe('done');
    }
  });
});

describe('冪等性：dedupe by id', () => {
  const ops: readonly Op[] = [
    { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Fix login redirect' },
    { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'status', v: 'queued' },
    { id: '01C', t: 3, a: 'm8q2', op: 'set', k: 'description', v: 'safari 才會重現' },
  ];

  it('同一批 op 重複注入 N 次，結果與注入一次相同', () => {
    const once = reduce(ISSUE, ops);

    for (let n = 2; n <= 6; n++) {
      const injected = Array.from({ length: n }, () => ops).flat();
      expect(reduce(ISSUE, shuffler(n)(injected))).toEqual(once);
    }
  });

  it('同 id 但內容不同的 op —— 全序中的第一個勝出，與檔案順序無關', () => {
    // spike T3：git 只會去重「位元組完全相同」的行，同 id 不同 t 的兩行都會留下。
    // 因此 dedupe 本身必須是順序無關的，否則收斂性在此破功。
    const conflicting: readonly Op[] = [
      ...ops,
      { id: '01B', t: 5, a: 'm8q2', op: 'set', k: 'status', v: 'done' },
    ];

    for (let seed = 0; seed < 200; seed++) {
      expect(reduce(ISSUE, shuffler(seed)(conflicting)).status).toBe('queued');
    }
  });
});

// ADR-0009：deleted 是第五個 LWW 欄位，因此收斂性是既有機器給的，一行都不用另外寫。
// 這裡把 archived 那組性質對 deleted 再跑一次 —— 它是**寫入安全**的依據，
// 兩個分支摺出不同答案代表一邊看得到、另一邊看不到同一張 Issue。
describe('deleted 的收斂', () => {
  const ops: readonly Op[] = [
    { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Fix login redirect' },
    { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'deleted', v: true },
    { id: '01C', t: 3, a: 'm8q2', op: 'set', k: 'deleted', v: false },
  ];

  it('相反的兩筆寫入，任意順序、任意重複，摺疊結果相同', () => {
    // 期望值取自 LWW 規則（最大 t 勝出），不是執行結果：t=3 的復原勝過 t=2 的刪除。
    const expected = {
      id: ISSUE,
      title: 'Fix login redirect',
      status: 'backlog',
      description: '',
      labels: [],
      archived: false,
      deleted: false,
      comments: [],
    };

    for (let seed = 0; seed < 200; seed++) {
      expect(reduce(ISSUE, shuffler(seed)(ops))).toEqual(expected);
      const injected = Array.from({ length: 3 }, () => ops).flat();
      expect(reduce(ISSUE, shuffler(seed)(injected))).toEqual(expected);
    }
  });

  it('刪除在後時同樣由最大 t 決定 —— 刪除不是吸收語意，也不被吸收', () => {
    const deleteLast: readonly Op[] = [
      { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Fix login redirect' },
      { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'deleted', v: false },
      { id: '01C', t: 3, a: 'm8q2', op: 'set', k: 'deleted', v: true },
    ];

    for (let seed = 0; seed < 200; seed++) {
      expect(reduce(ISSUE, shuffler(seed)(deleteLast)).deleted).toBe(true);
    }
  });
});
