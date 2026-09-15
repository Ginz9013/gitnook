import { describe, it, expect } from 'vitest';
import { reduceDecision, decisionFieldWrites } from '../../src/core/decisionReduce.js';
import type { DecisionOp } from '../../src/core/decisionOps.js';

// reduceDecision 是內部接縫，收斂性最適合屬性測試 —— 同
// test/core/reduce.convergence.test.ts 的手法。期望值取自 spec.md 的規則
// （全部 LWW，沒有 OR-Set／comments），而非執行結果。

const DECISION = '01JBX7A9Q30000000000000000';

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

describe('reduceDecision：create + set 的 fold', () => {
  const ops: readonly DecisionOp[] = [
    { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Use ULIDs' },
    { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'body', v: 'first draft' },
    { id: '01C', t: 3, a: 'k3f9', op: 'set', k: 'disposition', v: 'accepted' },
    { id: '01D', t: 4, a: 'k3f9', op: 'set', k: 'body', v: 'revised draft' },
  ];

  it('最大 t 的 set 決定欄位值', () => {
    const decision = reduceDecision(DECISION, ops);

    expect(decision.title).toBe('Use ULIDs');
    expect(decision.body).toBe('revised draft');
    expect(decision.disposition).toBe('accepted');
  });

  it('沒有被寫過的欄位落到預設值：body 是空字串，disposition 是 proposed', () => {
    const created: readonly DecisionOp[] = [
      { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Use ULIDs' },
    ];
    const decision = reduceDecision(DECISION, created);

    expect(decision.body).toBe('');
    expect(decision.disposition).toBe('proposed');
    expect(decision.supersededBy).toBeUndefined();
    expect(decision.legacyRef).toBeUndefined();
  });

  it('交換律：任意順序摺疊出同一個 Decision', () => {
    const expected = {
      id: DECISION,
      title: 'Use ULIDs',
      body: 'revised draft',
      disposition: 'accepted',
    };

    for (let seed = 0; seed < 200; seed++) {
      expect(reduceDecision(DECISION, shuffler(seed)(ops))).toEqual(expected);
    }
  });
});

describe('supersededBy / legacyRef：一旦寫過就出現在摺疊結果', () => {
  it('supersededBy 只驗證形狀，不驗證存在（spec.md Non-goals）', () => {
    const ops: readonly DecisionOp[] = [
      { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Old decision' },
      { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'supersededBy', v: '01ZZZZDOESNOTEXIST0000000' },
    ];

    expect(reduceDecision(DECISION, ops).supersededBy).toBe('01ZZZZDOESNOTEXIST0000000');
  });

  it('legacyRef 是遷移用的歷史欄位', () => {
    const ops: readonly DecisionOp[] = [
      { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Migrated ADR' },
      { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'legacyRef', v: 'docs/adr/0001' },
    ];

    expect(reduceDecision(DECISION, ops).legacyRef).toBe('docs/adr/0001');
  });
});

describe('相同 t 的決勝與 dedupe by id', () => {
  it('t 相同時以 a 決勝，全序中較後者勝出', () => {
    const ops: readonly DecisionOp[] = [
      { id: '01A', t: 1, a: 'aaaa', op: 'create', title: 'X' },
      { id: '01B', t: 2, a: 'aaaa', op: 'set', k: 'disposition', v: 'proposed' },
      { id: '01C', t: 2, a: 'zzzz', op: 'set', k: 'disposition', v: 'rejected' },
    ];

    for (let seed = 0; seed < 50; seed++) {
      expect(reduceDecision(DECISION, shuffler(seed)(ops)).disposition).toBe('rejected');
    }
  });

  it('同一批 op 重複注入 N 次，結果與注入一次相同', () => {
    const ops: readonly DecisionOp[] = [
      { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'X' },
      { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'disposition', v: 'accepted' },
    ];
    const once = reduceDecision(DECISION, ops);

    for (let n = 2; n <= 5; n++) {
      const injected = Array.from({ length: n }, () => ops).flat();
      expect(reduceDecision(DECISION, shuffler(n)(injected))).toEqual(once);
    }
  });
});

describe('decisionFieldWrites', () => {
  const ops: readonly DecisionOp[] = [
    { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'First title' },
    { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'title', v: 'Second title' },
    { id: '01C', t: 3, a: 'm8q2', op: 'set', k: 'body', v: 'body text' },
  ];

  it('create 折成 title 的第一次寫入', () => {
    const writes = decisionFieldWrites(ops, 'title');
    expect(writes).toEqual([
      { id: '01A', t: 1, a: 'k3f9', op: 'set', k: 'title', v: 'First title' },
      { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'title', v: 'Second title' },
    ]);
  });

  it('沒有指定欄位時回傳全部寫入', () => {
    expect(decisionFieldWrites(ops)).toHaveLength(3);
  });

  it('指定一個從沒被寫過的欄位時回傳空清單', () => {
    expect(decisionFieldWrites(ops, 'legacyRef')).toEqual([]);
  });
});
