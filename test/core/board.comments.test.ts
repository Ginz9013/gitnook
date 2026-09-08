import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';

// ADR-0004：真實檔案系統 + 每個測試用例獨立 mkdtemp，不使用 in-memory fake。
let dir: string;
const issuesDir = () => join(dir, '.issues', 'issues');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-comments-'));
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

describe('apply — comment', () => {
  it('追加一個 comment op，留言出現在 Issue.comments', () => {
    // op 形狀取自 spec.md：{"op":"comment","body":"safari 才會重現"}
    const board = openBoard({ dir, actor: 'm8q2' });
    const created = board.create({ title: 'Fix login redirect' });

    const updated = board.apply(created.id, { comment: 'safari 才會重現' });

    const op = opLines(created.id).at(-1)!;
    expect(op).toMatchObject({ a: 'm8q2', op: 'comment', body: 'safari 才會重現' });

    // Comment 的形狀由 types.ts 固定：id / actor / t / body。
    expect(updated.comments).toEqual([
      { id: op['id'], actor: 'm8q2', t: op['t'], body: 'safari 才會重現' },
    ]);
    expect(board.get(created.id).comments).toEqual(updated.comments);
    expect(readLog(created.id).endsWith('\n')).toBe(true);
  });
});

describe('comment body', () => {
  it('含換行的 markdown 原樣存回 —— 資料層不解析其內容', () => {
    const markdown = '## 為什麼卡住\n\n1. 等 upstream 修 #412\n2. 沒有 staging 憑證\n\n```sh\ncurl -I https://example.test/\n```\n';
    const board = openBoard({ dir, actor: 'm8q2' });
    const created = board.create({ title: 'Fix login redirect' });

    const updated = board.apply(created.id, { comment: markdown });

    expect(updated.comments[0]!.body).toBe(markdown);
    expect(board.get(created.id).comments[0]!.body).toBe(markdown);
    // 換行被 JSON 逃逸，op-log 仍是一行一個 Op。
    expect(opLines(created.id)).toHaveLength(2);
    expect(readLog(created.id).endsWith('\n')).toBe(true);
  });

  it('空字串與只有空白的 body 仍是一則留言 —— comment 只增不減', () => {
    const board = openBoard({ dir, actor: 'm8q2' });
    const created = board.create({ title: 'Fix login redirect' });

    expect(board.apply(created.id, { comment: '' }).comments).toHaveLength(1);
    expect(board.apply(created.id, { comment: '   ' }).comments).toHaveLength(2);
  });
});

describe('blocked 必須同時留下 Comment —— CONTEXT.md', () => {
  it('一次 Change 內同時設 blocked 與留言，兩個 op 都寫入', () => {
    const board = openBoard({ dir, actor: 'm8q2' });
    const created = board.create({ title: 'Fix login redirect' });

    const updated = board.apply(created.id, {
      status: 'blocked',
      comment: '等 upstream 修 #412',
    });

    expect(updated.status).toBe('blocked');
    expect(updated.comments.map((c) => c.body)).toEqual(['等 upstream 修 #412']);
    expect(opLines(created.id).map((o) => o['op'])).toEqual(['create', 'set', 'comment']);
    // lamport 在單次 apply 內連續遞增。
    expect(opLines(created.id).map((o) => o['t'])).toEqual([1, 2, 3]);
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

const ISSUE = '01JBX7A9Q30000000000000000';

/** union merge 會把兩邊的行任意交錯 —— 用任意順序寫檔即模擬其結果。 */
function writeLog(lines: readonly string[]): void {
  writeFileSync(join(issuesDir(), `${ISSUE}.ndjson`), lines.join('\n') + '\n', 'utf8');
}

describe('comment 時間軸依 (t, a) 排序', () => {
  // 兩個分支各自留言：t 相同時以 actor 決勝，與 ADR-0001 的全序一致。
  const lines = [
    '{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}',
    '{"id":"01B","t":2,"a":"k3f9","op":"comment","body":"safari 才會重現"}',
    '{"id":"01C","t":3,"a":"zzzz","op":"comment","body":"Z 的並行留言"}',
    '{"id":"01D","t":3,"a":"aaaa","op":"comment","body":"A 的並行留言"}',
    '{"id":"01E","t":9,"a":"k3f9","op":"comment","body":"合併後補充"}',
  ];

  it('不論行順序，時間軸恆為同一串', () => {
    for (let seed = 0; seed < 100; seed++) {
      writeLog(shuffler(seed)(lines));

      expect(openBoard({ dir }).get(ISSUE).comments).toEqual([
        { id: '01B', actor: 'k3f9', t: 2, body: 'safari 才會重現' },
        { id: '01D', actor: 'aaaa', t: 3, body: 'A 的並行留言' },
        { id: '01C', actor: 'zzzz', t: 3, body: 'Z 的並行留言' },
        { id: '01E', actor: 'k3f9', t: 9, body: '合併後補充' },
      ]);
    }
  });

  it('重複注入的行不產生重複留言 —— dedupe by op.id', () => {
    writeLog(lines);
    const once = openBoard({ dir }).get(ISSUE).comments;

    for (let n = 2; n <= 5; n++) {
      writeLog(shuffler(n)(Array.from({ length: n }, () => lines).flat()));

      expect(openBoard({ dir }).get(ISSUE).comments).toEqual(once);
    }
  });

  it('未知 op 型別與壞掉的 body 被忽略，不影響其餘留言', () => {
    // ADR-0001 硬規則 2：向前相容在這裡是資料安全問題。
    writeLog([
      ...lines,
      '{"id":"01F","t":4,"a":"k3f9","op":"reaction","emoji":"+1"}',
      '{"id":"01G","t":5,"a":"k3f9","op":"comment","body":42}',
      '{"id":"01H","t":6,"a":"k3f9","op":"comment"}',
    ]);

    expect(openBoard({ dir }).get(ISSUE).comments.map((c) => c.id)).toEqual([
      '01B',
      '01D',
      '01C',
      '01E',
    ]);
  });
});
