import { describe, it, expect } from 'vitest';
import { serialize, parseLine, splitGluedLine, nextLamport, orderOps } from '../../src/core/oplog.js';
import type { OpBase } from '../../src/core/oplog.js';

// oplog.ts 是給 Decision（以及未來任何實體）用的泛型引擎，不碰 Issue 既有的
// ops.ts/reduce.ts。排序/dedupe 規則必須與 core/reduce.ts 既有的 orderOps 一致
// （(t, a, id) 全序 → dedupe by id），用同一套屬性測試手法驗證 —— 見
// test/core/reduce.convergence.test.ts。

interface TestOp extends OpBase {
  readonly v: string;
}

/** 種子化 PRNG，讓「任意順序」在 CI 上可重現 —— 同 reduce.convergence.test.ts。 */
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

describe('orderOps：全序排序 (t, a, id) → dedupe by id', () => {
  const ops: readonly TestOp[] = [
    { id: '01A', t: 1, a: 'k3f9', v: 'first' },
    { id: '01B', t: 2, a: 'k3f9', v: 'second' },
    { id: '01C', t: 2, a: 'aaaa', v: 'third' },
  ];

  it('以 t 為主排序，t 相同時以 a 決勝', () => {
    for (let seed = 0; seed < 100; seed++) {
      const ordered = orderOps(shuffler(seed)(ops));
      expect(ordered.map((o) => o.id)).toEqual(['01A', '01C', '01B']);
    }
  });

  it('a 也相同時以 id 決勝', () => {
    const tied: readonly TestOp[] = [
      { id: '01Z', t: 5, a: 'k3f9', v: 'z' },
      { id: '01A', t: 5, a: 'k3f9', v: 'a' },
      { id: '01M', t: 5, a: 'k3f9', v: 'm' },
    ];
    for (let seed = 0; seed < 100; seed++) {
      expect(orderOps(shuffler(seed)(tied)).map((o) => o.id)).toEqual(['01A', '01M', '01Z']);
    }
  });

  it('dedupe by id：同 id 但內容不同的兩筆，全序中的第一個勝出，與檔案順序無關', () => {
    const conflicting: readonly TestOp[] = [
      { id: '01A', t: 1, a: 'k3f9', v: 'first' },
      { id: '01B', t: 2, a: 'k3f9', v: 'second' },
      { id: '01B', t: 9, a: 'zzzz', v: 'duplicate-with-different-content' },
    ];
    for (let seed = 0; seed < 200; seed++) {
      const ordered = orderOps(shuffler(seed)(conflicting));
      expect(ordered).toHaveLength(2);
      expect(ordered.find((o) => o.id === '01B')).toEqual({ id: '01B', t: 2, a: 'k3f9', v: 'second' });
    }
  });

  it('同一批 op 重複注入 N 次，結果與注入一次相同', () => {
    const once = orderOps(ops);
    for (let n = 2; n <= 5; n++) {
      const injected = Array.from({ length: n }, () => ops).flat();
      expect(orderOps(shuffler(n)(injected))).toEqual(once);
    }
  });
});

describe('nextLamport', () => {
  it('回傳 max(t) + 1，空陣列時回傳 1', () => {
    expect(nextLamport<TestOp>([])).toBe(1);
    expect(
      nextLamport<TestOp>([
        { id: '01A', t: 1, a: 'x', v: 'a' },
        { id: '01B', t: 5, a: 'x', v: 'b' },
        { id: '01C', t: 3, a: 'x', v: 'c' },
      ]),
    ).toBe(6);
  });
});

describe('serialize / parseLine', () => {
  it('serialize 以換行結尾，parseLine 逐字還原', () => {
    const op: TestOp = { id: '01A', t: 1, a: 'k3f9', v: 'hello' };
    const line = serialize(op);

    expect(line.endsWith('\n')).toBe(true);
    expect(parseLine<TestOp>(line.trimEnd())).toEqual(op);
  });

  it('無法解析的行回傳 null', () => {
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('"just a string"')).toBeNull();
    expect(parseLine('42')).toBeNull();
  });
});

describe('splitGluedLine', () => {
  it('把黏合行拆回原本的多個 op 文字', () => {
    const a = '{"id":"01A","t":1,"a":"k3f9","v":"first"}';
    const b = '{"id":"01B","t":2,"a":"k3f9","v":"second"}';

    expect(splitGluedLine(a + b)).toEqual([a, b]);
  });

  it('不是黏合行時回傳 null', () => {
    expect(splitGluedLine('{"id":"01A","t":1,"a":"k3f9","v":"first"}')).toBeNull();
    expect(splitGluedLine('not json at all')).toBeNull();
  });
});
