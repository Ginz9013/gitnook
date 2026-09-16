import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
import { reduce } from '../../src/core/reduce.js';
import type { Op } from '../../src/core/ops.js';

// ADR-0004：真實檔案系統 + 每個測試用例獨立 mkdtemp，不使用 in-memory fake。
let dir: string;
const issuesDir = () => join(dir, '.gitnook', 'issues');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-labels-'));
  mkdirSync(issuesDir(), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const readLog = (id: string): string =>
  readFileSync(join(issuesDir(), `${id}.ndjson`), 'utf8');

const opLines = (id: string): Record<string, unknown>[] =>
  readLog(id)
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('apply — labels.add', () => {
  it('產生一個帶 v 的 label.add op，label 出現在 Issue 上', () => {
    // op 形狀取自 spec.md「op 型別」的範例行，非執行結果。
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });

    const updated = board.apply(created.id, { labels: { add: ['bug'] } });

    expect(updated.labels).toEqual(['bug']);
    expect(board.get(created.id).labels).toEqual(['bug']);
    expect(opLines(created.id).at(-1)).toMatchObject({ a: 'test', op: 'label.add', v: 'bug' });
    // ADR-0001 硬規則 1：append 之後檔案仍以 \n 結尾。
    expect(readLog(created.id).endsWith('\n')).toBe(true);
  });
});

describe('重複的 label.add', () => {
  it('同一個 label 加兩次只出現一項 —— 兩個 add tag 都留在 op-log', () => {
    // 兩個分支各自 add 'bug' 也是這個形狀：不同 op id、相同 v。
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });

    board.apply(created.id, { labels: { add: ['bug'] } });
    const updated = board.apply(created.id, { labels: { add: ['bug'] } });

    expect(updated.labels).toEqual(['bug']);
    // OR-Set 的 tag 只增不減：兩個 add op 都必須保留，否則後續的 rm 無從指名。
    const adds = opLines(created.id).filter((o) => o['op'] === 'label.add');
    expect(adds).toHaveLength(2);
    expect(new Set(adds.map((o) => o['id']))).toHaveProperty('size', 2);
  });

  it('一次 Change 內加多個 label，各產生一個 op 且順序穩定', () => {
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });

    const updated = board.apply(created.id, { labels: { add: ['p1', 'bug', 'p1'] } });

    // Nook 沒有優先級欄位，優先級用 Label 表達 —— CONTEXT.md。
    expect(updated.labels).toEqual(['p1', 'bug']);
  });
});

describe('apply — labels.remove', () => {
  it('循序 add → rm 後 label 不存在；rm op 帶 v 與它觀察到的 add op id', () => {
    // spec.md：{"op":"label.rm","v":"bug","seen":["01JBX7C5R1"]}
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });
    board.apply(created.id, { labels: { add: ['bug'] } });

    const addId = opLines(created.id).find((o) => o['op'] === 'label.add')!['id'];
    const updated = board.apply(created.id, { labels: { remove: ['bug'] } });

    expect(updated.labels).toEqual([]);
    expect(board.get(created.id).labels).toEqual([]);
    expect(opLines(created.id).at(-1)).toMatchObject({
      op: 'label.rm',
      v: 'bug',
      seen: [addId],
    });
    expect(readLog(created.id).endsWith('\n')).toBe(true);
  });

  it('rm 只點名同值的 add，其他 label 不受影響', () => {
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });
    board.apply(created.id, { labels: { add: ['bug', 'p1'] } });

    const updated = board.apply(created.id, { labels: { remove: ['bug'] } });

    expect(updated.labels).toEqual(['p1']);
    expect(opLines(created.id).at(-1)).toMatchObject({ op: 'label.rm', v: 'bug' });
    expect((opLines(created.id).at(-1)!['seen'] as string[])).toHaveLength(1);
  });

  it('移除一個從未加過的 label 不拋錯，seen 為空', () => {
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });

    const updated = board.apply(created.id, { labels: { remove: ['bug'] } });

    expect(updated.labels).toEqual([]);
    expect(opLines(created.id).at(-1)).toMatchObject({ op: 'label.rm', v: 'bug', seen: [] });
  });

  it('同一個 Change 內同時 add 與 remove 同一個 label —— 依 add-wins，label 存活', () => {
    // spec 未規範這個組合。seen 只記錄「寫入當下已觀察到的 tag」，新 tag 不在其中，
    // 因此結果與並行情境一致：add 勝出。此測試釘住這個選擇，供 review 推翻。
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });

    const updated = board.apply(created.id, { labels: { add: ['bug'], remove: ['bug'] } });

    expect(updated.labels).toEqual(['bug']);
    expect(opLines(created.id).at(-1)).toMatchObject({ op: 'label.rm', v: 'bug', seen: [] });
  });

  it('rm 後可再 add 回來 —— 新的 add tag 不在既有 rm 的 seen 內', () => {
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });
    board.apply(created.id, { labels: { add: ['bug'] } });
    board.apply(created.id, { labels: { remove: ['bug'] } });

    expect(board.apply(created.id, { labels: { add: ['bug'] } }).labels).toEqual(['bug']);
  });
});

/** 種子化 PRNG，讓「任意交錯順序」在 CI 上可重現。 */
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

/** 一個獨立的 board 根目錄，用來代表一個分支的 working tree。 */
function branchDir(name: string): string {
  const root = join(dir, name);
  mkdirSync(join(root, '.gitnook', 'issues'), { recursive: true });
  return root;
}

const logPath = (root: string, id: string): string =>
  join(root, '.gitnook', 'issues', `${id}.ndjson`);

const linesOf = (root: string, id: string): string[] =>
  readFileSync(logPath(root, id), 'utf8').split('\n').filter((l) => l !== '');

/**
 * union merge 保留雙方所有行、並任意交錯 —— 以「兩個 op 集合交錯寫進單一檔案」模擬。
 * 位元組完全相同的行由 git 去重，故此處取聯集。真實 git 的合併是票 05。
 */
function unionMerge(
  id: string,
  a: readonly string[],
  b: readonly string[],
  tag: string,
  seed: number,
): string {
  const merged = shuffler(seed)([...new Set([...a, ...b])]);
  const root = branchDir(`merged-${tag}`);
  writeFileSync(logPath(root, id), merged.join('\n') + '\n', 'utf8');
  return root;
}

/**
 * 兩種 actor 排序都必須測到。全序是 (t, a, id)：removing 分支的 actor 若排在
 * adding 分支之後，rm 在全序中就落在並行的 add₂ **之後** —— 一個「以值移除」的
 * 天真實作只在這個方向上才會現形（已用變異測試確認：只測 k3f9/m8q2 一個方向時，
 * 以值移除的實作照樣全綠）。
 */
const ACTOR_ORDERS: readonly (readonly [string, string])[] = [
  ['k3f9', 'm8q2'], // rm 的 actor 排在 add 之前
  ['zzzz', 'aaaa'], // rm 的 actor 排在 add 之後
];

describe('add-wins：並行的 rm 與 add', () => {
  /** A 與 B 從共同祖先分岔：同一份 op-log，尚未有任何一方的新 op。 */
  function fork(tag: string, actorA: string, actorB: string): { id: string; rootA: string; rootB: string } {
    const rootA = branchDir(`A-${tag}`);
    const boardA = openBoard({ dir: rootA, actor: actorA });
    const { id } = boardA.create({ title: 'Fix login redirect', labels: ['bug'] });

    const rootB = branchDir(`B-${tag}`);
    writeFileSync(logPath(rootB, id), readFileSync(logPath(rootA, id), 'utf8'), 'utf8');
    return { id, rootA, rootB };
  }

  const opsOf = (root: string, id: string): Record<string, unknown>[] =>
    linesOf(root, id).map((l) => JSON.parse(l) as Record<string, unknown>);

  for (const [remover, adder] of ACTOR_ORDERS) {
    const tag = `${remover}-${adder}`;

    it(`A(${remover}) 移除 bug（seen 含 add₁），B(${adder}) 並行新增 bug（add₂）—— 合併後 bug 存在`, () => {
      const { id, rootA, rootB } = fork(tag, remover, adder);
      const add1 = opsOf(rootA, id).find((o) => o['op'] === 'label.add')!['id'] as string;

      openBoard({ dir: rootA, actor: remover }).apply(id, { labels: { remove: ['bug'] } });
      openBoard({ dir: rootB, actor: adder }).apply(id, { labels: { add: ['bug'] } });

      const rm = opsOf(rootA, id).find((o) => o['op'] === 'label.rm')!;
      expect(rm['seen']).toEqual([add1]);

      const add2 = opsOf(rootB, id).filter((o) => o['op'] === 'label.add').at(-1)!['id'] as string;
      // add₂ 是 B 獨立產生的新 tag，A 的 rm 不可能觀察到它。
      expect(add2).not.toBe(add1);
      expect(rm['seen']).not.toContain(add2);

      // 不論兩邊的行如何交錯，bug 都必須存活 —— 這就是 add-wins。
      for (let seed = 0; seed < 50; seed++) {
        const merged = unionMerge(id, linesOf(rootA, id), linesOf(rootB, id), `${tag}-${seed}`, seed);
        expect(openBoard({ dir: merged }).get(id).labels).toEqual(['bug']);
      }
    });

    it(`雙方都點名同一個 add tag 時（${tag}），label 才真的消失`, () => {
      const { id, rootA, rootB } = fork(`both-${tag}`, remover, adder);

      openBoard({ dir: rootA, actor: remover }).apply(id, { labels: { remove: ['bug'] } });
      openBoard({ dir: rootB, actor: adder }).apply(id, { labels: { remove: ['bug'] } });

      for (let seed = 0; seed < 50; seed++) {
        const merged = unionMerge(id, linesOf(rootA, id), linesOf(rootB, id), `both-${tag}-${seed}`, seed);
        expect(openBoard({ dir: merged }).get(id).labels).toEqual([]);
      }
    });
  }
});

describe('create 的初始 labels', () => {
  it('input.labels 隨 create 一併寫成 label.add op', () => {
    const board = openBoard({ dir, actor: 'test' });

    const created = board.create({ title: 'Fix login redirect', labels: ['bug', 'p1'] });

    expect(created.labels).toEqual(['bug', 'p1']);
    expect(board.get(created.id).labels).toEqual(['bug', 'p1']);

    const lines = opLines(created.id);
    expect(lines.map((o) => o['op'])).toEqual(['create', 'label.add', 'label.add']);
    // lamport 在單次 create 內連續遞增。
    expect(lines.map((o) => o['t'])).toEqual([1, 2, 3]);
    expect(readLog(created.id).endsWith('\n')).toBe(true);
  });

  it('未給 labels 時不產生多餘的 op', () => {
    const board = openBoard({ dir, actor: 'test' });

    const created = board.create({ title: 'Fix login redirect' });

    expect(created.labels).toEqual([]);
    expect(opLines(created.id)).toHaveLength(1);
  });
});

describe('labels 的 fold —— reduce() 屬性測試', () => {
  // reduce() 是內部接縫（spec.md）。期望值取自 OR-Set 的 add-wins 規則，非執行結果。
  const ops: readonly Op[] = [
    { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Fix login redirect' },
    { id: '01B', t: 2, a: 'k3f9', op: 'label.add', v: 'bug' },
    { id: '01C', t: 3, a: 'k3f9', op: 'label.add', v: 'p1' },
    // 只點名 01B，因此 01F 產生的 bug tag 存活。
    { id: '01D', t: 4, a: 'k3f9', op: 'label.rm', v: 'bug', seen: ['01B'] },
    { id: '01E', t: 5, a: 'm8q2', op: 'label.rm', v: 'p1', seen: ['01C'] },
    { id: '01F', t: 4, a: 'm8q2', op: 'label.add', v: 'bug' },
  ];

  it('交換律：任意順序摺疊出同一組 labels', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(reduce('01JBX7A9Q3', shuffler(seed)(ops)).labels).toEqual(['bug']);
    }
  });

  it('冪等性：同一批 op 重複注入 N 次，結果與注入一次相同', () => {
    const once = reduce('01JBX7A9Q3', ops);

    for (let n = 2; n <= 6; n++) {
      const injected = Array.from({ length: n }, () => ops).flat();
      expect(reduce('01JBX7A9Q3', shuffler(n)(injected))).toEqual(once);
    }
  });

  it('rm 點名的 tag 全數存在時，label 消失', () => {
    const all: readonly Op[] = [
      ...ops,
      { id: '01G', t: 6, a: 'k3f9', op: 'label.rm', v: 'bug', seen: ['01B', '01F'] },
    ];

    for (let seed = 0; seed < 100; seed++) {
      expect(reduce('01JBX7A9Q3', shuffler(seed)(all)).labels).toEqual([]);
    }
  });

  it('壞掉或未知的 op 被忽略而非崩潰 —— ADR-0001 硬規則 2', () => {
    const corrupt = [
      ...ops,
      // seen 不是陣列：不得移除任何 tag，也不得拋錯。字串會被誤當成可迭代物，
      // 數字與 null 則會直接讓 for...of 拋 TypeError —— 三種都必須被擋下。
      { id: '01H', t: 7, a: 'k3f9', op: 'label.rm', v: 'bug', seen: 'bug' },
      { id: '01I', t: 8, a: 'k3f9', op: 'label.rm', v: 'bug', seen: 42 },
      { id: '01J', t: 9, a: 'k3f9', op: 'label.rm', v: 'bug', seen: null },
      { id: '01K', t: 10, a: 'k3f9', op: 'label.rm', v: 'bug' },
      { id: '01L', t: 11, a: 'k3f9', op: 'label.add', v: 42 },
      { id: '01M', t: 12, a: 'k3f9', op: 'reaction', emoji: '+1' },
    ] as unknown as readonly Op[];

    for (let seed = 0; seed < 100; seed++) {
      expect(reduce('01JBX7A9Q3', shuffler(seed)(corrupt)).labels).toEqual(['bug']);
    }
  });
});
