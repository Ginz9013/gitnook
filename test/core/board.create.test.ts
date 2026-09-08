import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard, BoardNotInitialized } from '../../src/index.js';
import type { IdSource } from '../../src/index.js';

// ADR-0004：打真實檔案系統與暫存目錄，不使用 in-memory fake。
let dir: string;
const issuesDir = () => join(dir, '.issues', 'issues');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-'));
  mkdirSync(issuesDir(), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('create', () => {
  it('寫出一個恰好含一行 create op、且以換行結尾的 op-log', () => {
    const board = openBoard({ dir });

    board.create({ title: 'Fix login redirect' });

    const files = readdirSync(issuesDir());
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}\.ndjson$/);

    const raw = readFileSync(join(issuesDir(), files[0]!), 'utf8');
    // ADR-0001 硬規則 1：缺少 trailing newline 會讓 union merge 黏合兩行。
    expect(raw.endsWith('\n')).toBe(true);

    const lines = raw.split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      op: 'create',
      title: 'Fix login redirect',
      t: 1,
    });
  });
});

describe('get', () => {
  it('以完整 ULID 讀回摺疊後的 Issue', () => {
    const board = openBoard({ dir });
    const created = board.create({ title: 'Fix login redirect' });

    const found = board.get(created.id);

    expect(found.id).toBe(created.id);
    expect(found.title).toBe('Fix login redirect');
    expect(found.status).toBe('backlog');
    expect(found.archived).toBe(false);
    expect(found.labels).toEqual([]);
  });
});

describe('未初始化的目錄', () => {
  it('create 拋出 BoardNotInitialized', () => {
    const bare = mkdtempSync(join(tmpdir(), 'nook-bare-'));
    try {
      const board = openBoard({ dir: bare });
      expect(() => board.create({ title: 'x' })).toThrow(BoardNotInitialized);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('種子化 IdSource', () => {
  const seeded = (): IdSource => {
    let n = 0;
    // 6 + 20 = 26 字元，全部屬於 Crockford base32。
    return { ulid: () => `01SEED${String(++n).padStart(20, '0')}` };
  };

  const runOnce = () => {
    const d = mkdtempSync(join(tmpdir(), 'nook-seed-'));
    try {
      mkdirSync(join(d, '.issues', 'issues'), { recursive: true });
      openBoard({ dir: d, actor: 'test', ids: seeded() }).create({ title: 'Fix login redirect' });
      const file = readdirSync(join(d, '.issues', 'issues'))[0]!;
      return { file, raw: readFileSync(join(d, '.issues', 'issues', file), 'utf8') };
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  };

  it('注入 ids 與 actor 後輸出逐位元組可重現', () => {
    const a = runOnce();
    const b = runOnce();

    expect(a.file).toBe('01SEED00000000000000000001.ndjson');
    expect(a.file).toBe(b.file);
    expect(a.raw).toBe(b.raw);

    // 欄位形狀取自 spec.md 的 op 範例，非執行結果。
    expect(JSON.parse(a.raw.trimEnd())).toEqual({
      id: '01SEED00000000000000000002',
      t: 1,
      a: 'test',
      op: 'create',
      title: 'Fix login redirect',
    });
  });
});
