import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard, InvalidStatus, BoardNotInitialized, AmbiguousRef, RefNotFound } from '../../src/index.js';
import type { CreateInput, IdSource, Issue } from '../../src/index.js';

// ADR-0004：真實檔案系統 + 每個測試用例獨立 mkdtemp，不使用 in-memory fake。
let dir: string;
const issuesDir = () => join(dir, '.gitnook', 'issues');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-list-'));
  mkdirSync(issuesDir(), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 測試用的完整 ULID：不足 26 碼補 0，字元皆屬 Crockford base32。 */
const fullId = (prefix: string): string => prefix.padEnd(26, '0');

/**
 * 第一次 ulid() 是 Issue 的識別碼，其後每次都是一個 Op 的識別碼。
 * 固定住識別碼才能對 list 的順序與前綴解析下確定的斷言。
 */
function seeded(issueId: string): IdSource {
  let n = 0;
  return { ulid: () => (n++ === 0 ? issueId : issueId.slice(0, 8) + String(n).padStart(18, '0')) };
}

const createWith = (issueId: string, input: CreateInput): Issue =>
  openBoard({ dir, actor: 'test', ids: seeded(issueId) }).create(input);

const A = fullId('01JBXA');
const B = fullId('01JBXB');
const C = fullId('01JBXC');
const D = fullId('01JBXD');
/** 兩張前綴相同到第 10 碼的 Issue —— 預設的 6 碼短 ID 分不開它們。 */
const COL_1 = fullId('01JBXQ7A9ZA');
const COL_2 = fullId('01JBXQ7A9ZB');

describe('list', () => {
  it('回傳 board 內全部 Issue，依 ULID 遞增排序', () => {
    createWith(C, { title: 'C' });
    createWith(A, { title: 'A' });
    createWith(B, { title: 'B' });

    const issues = openBoard({ dir }).list();

    expect(issues.map((i) => i.id)).toEqual([A, B, C]);
    expect(issues.map((i) => i.title)).toEqual(['A', 'B', 'C']);
  });
});

/** A=backlog、B=done、C=cancelled、D=archived —— 預設可見範圍的四種情形各一。 */
function seedVisibilityFixture(): void {
  createWith(A, { title: 'A' });
  createWith(B, { title: 'B', status: 'done' });
  createWith(C, { title: 'C', status: 'cancelled' });
  createWith(D, { title: 'D' });
  // archived 是可見性，與 done/cancelled 的工作結果正交 —— ADR-0003。
  openBoard({ dir, actor: 'test' }).apply(D, { archived: true });
}

describe('list 的預設可見範圍', () => {
  it('預設隱藏 archived 為 true 者，以及 status 為 done / cancelled 者', () => {
    seedVisibilityFixture();

    const issues = openBoard({ dir }).list();

    expect(issues.map((i) => i.id)).toEqual([A]);
  });

  it('list({ all: true }) 回傳全部', () => {
    seedVisibilityFixture();

    const issues = openBoard({ dir }).list({ all: true });

    expect(issues.map((i) => i.id)).toEqual([A, B, C, D]);
  });
});

describe('list 的過濾條件', () => {
  it('list({ status }) 只回傳該狀態', () => {
    createWith(A, { title: 'A', status: 'queued' });
    createWith(B, { title: 'B', status: 'in_progress' });
    createWith(C, { title: 'C', status: 'queued' });

    const issues = openBoard({ dir }).list({ status: 'queued' });

    expect(issues.map((i) => i.id)).toEqual([A, C]);
  });

  it('list({ status }) 接受無歧義前綴，撞號或無對應時拋 InvalidStatus', () => {
    createWith(A, { title: 'A', status: 'queued' });
    createWith(B, { title: 'B', status: 'in_progress' });

    const board = openBoard({ dir });

    expect(board.list({ status: 'in_p' }).map((i) => i.id)).toEqual([B]);
    // 'b' 同時是 backlog 與 blocked 的前綴 —— 絕不猜測。
    expect(() => board.list({ status: 'b' })).toThrow(InvalidStatus);
    expect(() => board.list({ status: 'zzz' })).toThrow(InvalidStatus);
  });

  it('明確指定 status 時 done / cancelled 不再被預設隱藏，archived 仍隱藏', () => {
    createWith(A, { title: 'A', status: 'done' });
    createWith(B, { title: 'B' });
    createWith(C, { title: 'C', status: 'done' });
    openBoard({ dir, actor: 'test' }).apply(C, { archived: true });

    // 點名了 done 還回傳空清單是沒有意義的答案；archived 則是另一個維度，
    // 只有 all: true 能打開 —— ADR-0003 的正交性。
    expect(openBoard({ dir }).list({ status: 'done' }).map((i) => i.id)).toEqual([A]);
  });

  it('list({ labels }) 只回傳同時掛有全部指定 label 者', () => {
    createWith(A, { title: 'A', labels: ['bug', 'p1'] });
    createWith(B, { title: 'B', labels: ['bug'] });
    createWith(C, { title: 'C', labels: ['p1'] });

    const board = openBoard({ dir });

    expect(board.list({ labels: ['bug'] }).map((i) => i.id)).toEqual([A, B]);
    // 多個 label 是收斂條件（AND），不是聯集 —— 過濾應該越加越窄。
    expect(board.list({ labels: ['bug', 'p1'] }).map((i) => i.id)).toEqual([A]);
  });
});

describe('list 的邊界情況', () => {
  it('未初始化的目錄拋 BoardNotInitialized，而非檔案系統的 ENOENT', () => {
    const bare = mkdtempSync(join(tmpdir(), 'nook-bare-'));
    try {
      expect(() => openBoard({ dir: bare }).list()).toThrow(BoardNotInitialized);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('忽略目錄中非 .ndjson 的檔案', () => {
    createWith(A, { title: 'A' });
    // 資料活在 repo 裡，旁邊出現 .DS_Store 或 README 是常態，不該讓 list 崩潰。
    writeFileSync(join(issuesDir(), '.DS_Store'), 'x', 'utf8');
    writeFileSync(join(issuesDir(), 'README.md'), '# 不是 op-log\n', 'utf8');

    expect(openBoard({ dir }).list().map((i) => i.id)).toEqual([A]);
  });

  // Guard：寫完即綠。以變異測試確認它不是空的 —— 見執行報告。
  it('空的 board 回傳 []，不拋錯', () => {
    expect(openBoard({ dir }).list()).toEqual([]);
  });
});

describe('ref 前綴解析', () => {
  it('get() 以無歧義前綴解析到完整 ULID', () => {
    createWith(A, { title: 'A' });
    createWith(B, { title: 'B' });

    const found = openBoard({ dir }).get('01JBXA');

    expect(found.id).toBe(A);
    expect(found.title).toBe('A');
  });

  it('前綴撞到多筆時拋 AmbiguousRef，並帶上候選', () => {
    createWith(COL_1, { title: '1' });
    createWith(COL_2, { title: '2' });

    let thrown: unknown;
    try {
      openBoard({ dir }).get('01JBXQ');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AmbiguousRef);
    expect((thrown as AmbiguousRef).candidates).toHaveLength(2);
  });

  it('AmbiguousRef 列出的候選短 ID 長到足以彼此區分（票 08 的碰撞）', () => {
    createWith(COL_1, { title: '1' });
    createWith(COL_2, { title: '2' });

    let thrown: unknown;
    try {
      openBoard({ dir }).get('01JBXQ');
    } catch (e) {
      thrown = e;
    }
    const err = thrown as AmbiguousRef;

    // 兩者第一個相異的字元在索引 10，故最短的無歧義長度是 11。
    // 盲取 6 碼會印出兩個一模一樣的候選，等於沒有回答任何問題。
    expect(err.candidates).toEqual([COL_1.slice(0, 11), COL_2.slice(0, 11)]);
    expect(new Set(err.candidates).size).toBe(2);
    expect(err.message).toContain(COL_2.slice(0, 11));
  });

  // Guard：寫完即綠。以變異測試確認它不是空的 —— 見執行報告。
  it('ref 只接受 Crockford base32，路徑穿越不得讀到 board 以外的檔案', () => {
    // CLI（票 10）與 studio server 的 /i/<ref>（票 09）都會把使用者輸入
    // 直接餵進 get()。完整識別碼的快路徑原本用 existsSync(pathOf(ref))，
    // 而 join() 會把 ../ 正規化到 .gitnook/issues/ 之外。
    const outside = join(dir, 'outside.ndjson');
    writeFileSync(outside, '{"id":"X","t":1,"a":"z","op":"create","title":"OUTSIDE"}\n', 'utf8');

    const board = openBoard({ dir });
    expect(() => board.get('../../outside')).toThrow(RefNotFound);
    expect(() => board.get('..')).toThrow(RefNotFound);
    expect(() => board.get('a/b')).toThrow(RefNotFound);
    expect(() => board.get('01JBX-A')).toThrow(RefNotFound);
  });

  it('ref 的大小寫不敏感 —— Crockford base32 的解碼語意', () => {
    // Crockford base32 明定解碼時大小寫不敏感（它排除 I/L/O/U 正是為了
    // 避免人工轉錄的混淆）。人習慣打小寫（git short hash 全小寫），
    // 拒絕小寫等於違反該編碼的既定語意，且換不到任何好處。
    createWith(A, { title: 'A' });
    createWith(B, { title: 'B' });

    const board = openBoard({ dir });

    expect(board.get('01jbxa').id).toBe(A);
    expect(board.get(A.toLowerCase()).id).toBe(A);
    expect(board.get('01JbXa').id).toBe(A);
  });

  it('前綴無對應時拋 RefNotFound', () => {
    createWith(A, { title: 'A' });

    expect(() => openBoard({ dir }).get('01ZZZZ')).toThrow(RefNotFound);
  });

  it('apply() 同樣接受無歧義前綴 —— Ref 的定義涵蓋每一個 ref 參數', () => {
    createWith(A, { title: 'A' });
    createWith(B, { title: 'B' });

    const updated = openBoard({ dir, actor: 'test' }).apply('01JBXA', { status: 'queued' });

    expect(updated.id).toBe(A);
    expect(openBoard({ dir }).get(A).status).toBe('queued');
  });
});

describe('list 的規模', () => {
  // Guard：寫完即綠。以變異測試確認它不是空的 —— 見執行報告。
  it('500 張 Issue 的 list() 在 100ms 內完成', () => {
    const board = openBoard({ dir, actor: 'test' });
    for (let i = 0; i < 500; i++) board.create({ title: `Issue ${i}`, labels: ['bug'] });

    const started = performance.now();
    const issues = board.list();
    const elapsed = performance.now() - started;

    expect(issues).toHaveLength(500);
    // ADR-0002：沒有索引也沒有快取，這裡量的就是全量掃描本身。
    // spec 的實測基準是 14ms，100ms 是刻意留的餘裕以免成為脆弱測試。
    expect(elapsed).toBeLessThan(100);
  });
});
