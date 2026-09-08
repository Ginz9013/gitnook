import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard, RefNotFound, InvalidStatus, STATUSES } from '../../src/index.js';
import type { IdSource } from '../../src/index.js';

// ADR-0004：真實檔案系統 + 每個測試用例獨立 mkdtemp，不使用 in-memory fake。
let dir: string;
const issuesDir = () => join(dir, '.issues', 'issues');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-set-'));
  mkdirSync(issuesDir(), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

const ISSUE = '01JBX7A9Q30000000000000000';

/** union merge 會把兩邊的行任意交錯 —— 用任意順序寫檔即模擬其結果。 */
function writeLog(lines: readonly string[]): void {
  writeFileSync(join(issuesDir(), `${ISSUE}.ndjson`), lines.join('\n') + '\n', 'utf8');
}

describe('檔案內的行順序', () => {
  // spec.md 的 op 範例形狀；期望值取自 ADR-0001 的排序規則。
  const lines = [
    '{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}',
    '{"id":"01B","t":2,"a":"k3f9","op":"set","k":"status","v":"queued"}',
    '{"id":"01C","t":3,"a":"m8q2","op":"set","k":"status","v":"in_progress"}',
    '{"id":"01D","t":4,"a":"k3f9","op":"set","k":"archived","v":true}',
  ];

  it('任意順序寫入，fold 結果恆等', () => {
    for (let seed = 0; seed < 100; seed++) {
      writeLog(shuffler(seed)(lines));

      expect(openBoard({ dir }).get(ISSUE)).toEqual({
        id: ISSUE,
        title: 'Fix login redirect',
        status: 'in_progress',
        description: '',
        labels: [],
        archived: true,
        comments: [],
      });
    }
  });

  it('重複注入的行不改變結果', () => {
    writeLog(lines);
    const once = openBoard({ dir }).get(ISSUE);

    for (let n = 2; n <= 5; n++) {
      writeLog(shuffler(n)(Array.from({ length: n }, () => lines).flat()));

      expect(openBoard({ dir }).get(ISSUE)).toEqual(once);
    }
  });

  it('同 id 但內容不同的兩行，結果與檔案順序無關', () => {
    // spike T3：位元組不同的兩行都會被 union merge 保留，dedupe 因此必須順序無關。
    const conflicting = [
      ...lines,
      '{"id":"01B","t":9,"a":"m8q2","op":"set","k":"status","v":"done"}',
    ];

    for (let seed = 0; seed < 100; seed++) {
      writeLog(shuffler(seed)(conflicting));

      expect(openBoard({ dir }).get(ISSUE).status).toBe('in_progress');
    }
  });
});

/** 6 + 20 = 26 字元，全部屬於 Crockford base32。 */
const seeded = (): IdSource => {
  let n = 0;
  return { ulid: () => `01SEED${String(++n).padStart(20, '0')}` };
};

const readLog = (id: string): string =>
  readFileSync(join(issuesDir(), `${id}.ndjson`), 'utf8');

const opLines = (id: string): unknown[] =>
  readLog(id)
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as unknown);

describe('apply — status', () => {
  it('追加一個 set op 並回傳更新後的 Issue', () => {
    const board = openBoard({ dir, actor: 'test', ids: seeded() });
    const created = board.create({ title: 'Fix login redirect' });

    const updated = board.apply(created.id, { status: 'in_progress' });

    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe('in_progress');
    expect(updated.title).toBe('Fix login redirect');

    // 欄位形狀取自 spec.md 的 op 範例，非執行結果。
    expect(opLines(created.id)).toEqual([
      { id: '01SEED00000000000000000002', t: 1, a: 'test', op: 'create', title: 'Fix login redirect' },
      { id: '01SEED00000000000000000003', t: 2, a: 'test', op: 'set', k: 'status', v: 'in_progress' },
    ]);
  });

  it('append 後檔案仍以 \\n 結尾', () => {
    // ADR-0001 硬規則 1：缺少 trailing newline 會讓 union merge 黏合兩行。
    const board = openBoard({ dir, actor: 'test', ids: seeded() });
    const created = board.create({ title: 'Fix login redirect' });

    board.apply(created.id, { status: 'queued' });
    board.apply(created.id, { status: 'in_progress' });

    expect(readLog(created.id).endsWith('\n')).toBe(true);
    expect(opLines(created.id)).toHaveLength(3);
  });

  it('lamport 取該檔的 max(t)+1', () => {
    const board = openBoard({ dir, actor: 'test', ids: seeded() });
    const created = board.create({ title: 'Fix login redirect' });

    // 另一位 actor 在別的分支推進了 clock，union merge 後出現在同一個檔案裡。
    appendFileSync(
      join(issuesDir(), `${created.id}.ndjson`),
      '{"id":"01OTHER","t":7,"a":"m8q2","op":"set","k":"status","v":"review"}\n',
      'utf8',
    );

    board.apply(created.id, { status: 'done' });

    const last = opLines(created.id).at(-1);
    expect(last).toMatchObject({ t: 8, op: 'set', k: 'status', v: 'done' });
    expect(board.get(created.id).status).toBe('done');
  });

  it('不存在的 ref 拋出 RefNotFound', () => {
    const board = openBoard({ dir, actor: 'test', ids: seeded() });

    expect(() => board.apply('01NOPE0000000000000000000', { status: 'done' })).toThrow(RefNotFound);
  });
});

describe('status 的驗證與前綴解析', () => {
  // 八個固定值取自 docs/adr/0003，不可自訂。
  // 每次呼叫都是一張新的 Issue（真實 ULID），避免種子化序列在同一目錄下撞 op id。
  const setStatus = (value: string): string => {
    const board = openBoard({ dir, actor: 'test' });
    const created = board.create({ title: 'Fix login redirect' });
    return board.apply(created.id, { status: value }).status;
  };

  it('八個合法值各自被接受', () => {
    for (const s of STATUSES) expect(setStatus(s)).toBe(s);
  });

  it('無歧義前綴解析成完整 status', () => {
    expect(setStatus('in_p')).toBe('in_progress');
    expect(setStatus('q')).toBe('queued');
    expect(setStatus('rev')).toBe('review');
    expect(setStatus('can')).toBe('cancelled');
  });

  it('前綴解析後存回檔案的是完整值，不是前綴', () => {
    const board = openBoard({ dir, actor: 'test', ids: seeded() });
    const created = board.create({ title: 'Fix login redirect' });

    board.apply(created.id, { status: 'in_p' });

    expect(opLines(created.id).at(-1)).toMatchObject({ k: 'status', v: 'in_progress' });
  });

  it('八個值之外的值拋出 InvalidStatus', () => {
    expect(() => setStatus('doing')).toThrow(InvalidStatus);
    expect(() => setStatus('')).toThrow(InvalidStatus);
    expect(() => setStatus('IN_PROGRESS')).toThrow(InvalidStatus);
  });

  it('撞號的前綴拋出 InvalidStatus', () => {
    // b → backlog / blocked，兩者皆符合。
    expect(() => setStatus('b')).toThrow(InvalidStatus);
  });

  it('被拒絕的 status 不留下任何 op', () => {
    const board = openBoard({ dir, actor: 'test', ids: seeded() });
    const created = board.create({ title: 'Fix login redirect' });
    const before = readLog(created.id);

    expect(() => board.apply(created.id, { status: 'doing' })).toThrow(InvalidStatus);

    expect(readLog(created.id)).toBe(before);
  });
});

describe('apply — title / description / archived', () => {
  const board = () => openBoard({ dir, actor: 'test' });

  it('title 產生 set op 並覆寫 create 的標題', () => {
    const b = board();
    const created = b.create({ title: 'Fix login redirect' });

    const updated = b.apply(created.id, { title: 'Fix login redirect on Safari' });

    expect(updated.title).toBe('Fix login redirect on Safari');
    expect(opLines(created.id).at(-1)).toMatchObject({ op: 'set', k: 'title', v: 'Fix login redirect on Safari' });
  });

  it('description 產生 set op', () => {
    const b = board();
    const created = b.create({ title: 'Fix login redirect' });

    const updated = b.apply(created.id, { description: 'safari 才會重現' });

    expect(updated.description).toBe('safari 才會重現');
    expect(opLines(created.id).at(-1)).toMatchObject({ op: 'set', k: 'description', v: 'safari 才會重現' });
  });

  it('description 原樣存回含換行的 markdown —— 資料層不解析其內容', () => {
    const markdown = '## 重現步驟\n\n1. 登入\n2. 按下 **返回**\n\n```js\nlocation.href = "/";\n```\n';
    const b = board();
    const created = b.create({ title: 'Fix login redirect' });

    const updated = b.apply(created.id, { description: markdown });

    expect(updated.description).toBe(markdown);
    // 換行被 JSON 逃逸，op-log 仍是一行一個 Op。
    expect(b.get(created.id).description).toBe(markdown);
    expect(opLines(created.id)).toHaveLength(2);
    expect(readLog(created.id).endsWith('\n')).toBe(true);
  });

  it('archived 是 boolean 欄位，與 status 正交', () => {
    const b = board();
    const created = b.create({ title: 'Fix login redirect' });
    b.apply(created.id, { status: 'done' });

    const archivedIssue = b.apply(created.id, { archived: true });

    // ADR-0003：歸檔是可見性，done/cancelled 是工作結果，兩者不可互相覆寫。
    expect(archivedIssue.archived).toBe(true);
    expect(archivedIssue.status).toBe('done');
    expect(opLines(created.id).at(-1)).toMatchObject({ op: 'set', k: 'archived', v: true });

    expect(b.apply(created.id, { archived: false }).archived).toBe(false);
  });

  it('一次 Change 內的多個欄位各產生一個 set op', () => {
    const b = board();
    const created = b.create({ title: 'Fix login redirect' });

    const updated = b.apply(created.id, {
      title: 'Fix login redirect on Safari',
      description: 'safari 才會重現',
      status: 'in_progress',
      archived: true,
    });

    expect(updated).toMatchObject({
      title: 'Fix login redirect on Safari',
      description: 'safari 才會重現',
      status: 'in_progress',
      archived: true,
    });

    const lines = opLines(created.id);
    expect(lines).toHaveLength(5);
    // lamport 在單次 apply 內連續遞增，且不重複。
    expect(lines.map((l) => (l as { t: number }).t)).toEqual([1, 2, 3, 4, 5]);
    expect(readLog(created.id).endsWith('\n')).toBe(true);
  });

  it('後寫的 set 勝出 —— LWW', () => {
    const b = board();
    const created = b.create({ title: 'Fix login redirect' });

    b.apply(created.id, { description: '第一版' });
    b.apply(created.id, { description: '第二版' });

    expect(b.get(created.id).description).toBe('第二版');
  });
});

describe('create 的初始欄位', () => {
  it('description 與 status 隨 create 一併寫入', () => {
    const b = openBoard({ dir, actor: 'test' });

    const created = b.create({
      title: 'Fix login redirect',
      description: 'safari 才會重現',
      status: 'queued',
    });

    expect(created).toMatchObject({
      title: 'Fix login redirect',
      description: 'safari 才會重現',
      status: 'queued',
    });
    expect(b.get(created.id)).toEqual(created);
    expect(readLog(created.id).endsWith('\n')).toBe(true);
  });

  it('create 的 status 同樣接受無歧義前綴', () => {
    const b = openBoard({ dir, actor: 'test' });

    expect(b.create({ title: 'Fix login redirect', status: 'in_p' }).status).toBe('in_progress');
  });

  it('create 的 status 非法時不留下任何檔案', () => {
    const b = openBoard({ dir, actor: 'test' });

    expect(() => b.create({ title: 'Fix login redirect', status: 'doing' })).toThrow(InvalidStatus);

    expect(readdirSync(issuesDir())).toEqual([]);
  });

  it('只給 title 時仍只寫一行 —— 不產生多餘的 set op', () => {
    const b = openBoard({ dir, actor: 'test' });

    const created = b.create({ title: 'Fix login redirect' });

    expect(opLines(created.id)).toHaveLength(1);
    expect(created.status).toBe('backlog');
    expect(created.description).toBe('');
  });
});
