import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
import type { CreateInput, IdSource, Issue } from '../../src/index.js';
import { IssueDeleted } from '../../src/core/types.js';

// ADR-0009：刪除是第五個 LWW 欄位，不是新的 op 型別，也不是 unlink 檔案。
// ADR-0004：真實檔案系統 + 每個測試用例獨立 mkdtemp，不使用 in-memory fake。
let dir: string;
const issuesDir = () => join(dir, '.gitnook', 'issues');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-deleted-'));
  mkdirSync(issuesDir(), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 測試用的完整 ULID：不足 26 碼補 0，字元皆屬 Crockford base32。 */
const fullId = (prefix: string): string => prefix.padEnd(26, '0');

/**
 * 第一次 ulid() 是 Issue 的識別碼，其後每次都是一個 Op 的識別碼 ——
 * 同 board.list.test.ts，固定住識別碼才能對順序下確定的斷言。
 */
function seeded(issueId: string): IdSource {
  let n = 0;
  return { ulid: () => (n++ === 0 ? issueId : issueId.slice(0, 8) + String(n).padStart(18, '0')) };
}

const createWith = (issueId: string, input: CreateInput): Issue =>
  openBoard({ dir, actor: 'test', ids: seeded(issueId) }).create(input);

const A = fullId('01JBXA');
const B = fullId('01JBXB');

describe('board.get 對一張已刪的 Issue', () => {
  it('正常回傳且 deleted 為 true —— 不拋，呼叫端要說得出「這張已被刪除」', () => {
    createWith(A, { title: 'Fix login redirect' });

    openBoard({ dir, actor: 'test' }).apply(A, { deleted: true });

    // ADR-0009：一個吞掉 Issue 的 getter 只能讓呼叫端說「找不到」。
    const found = openBoard({ dir }).get(A);
    expect(found.deleted).toBe(true);
    expect(found.title).toBe('Fix login redirect');
  });
});

describe('board.list 對一張已刪的 Issue', () => {
  it('list({ all: true }) 也看不到它 —— 這正是刪除與封存的分野', () => {
    createWith(A, { title: 'A' });
    createWith(B, { title: 'B' });

    openBoard({ dir, actor: 'test' }).apply(B, { deleted: true });

    const board = openBoard({ dir });
    // `--all` 是「連 archived 與 done 都給我看」，不是「連刪掉的都給我看」——
    // board 成員資格的唯一決定點在 list()（ADR-0009）。
    expect(board.list().map((i) => i.id)).toEqual([A]);
    expect(board.list({ all: true }).map((i) => i.id)).toEqual([A]);
  });
});

describe('board.apply 對一張已刪的 Issue', () => {
  it('拋 IssueDeleted —— 寫入安全的唯一決定點', () => {
    createWith(A, { title: 'Fix login redirect' });
    openBoard({ dir, actor: 'test' }).apply(A, { deleted: true });

    // CLI／server／studio 三邊都繼承這一個答案（ADR-0009，對照 ADR-0003 的教訓）。
    expect(() => openBoard({ dir, actor: 'test' }).apply(A, { comment: 'x' })).toThrow(IssueDeleted);
  });

  it('被拒絕的寫入不留下任何 op —— 守衛在任何 append 之前', () => {
    createWith(A, { title: 'Fix login redirect' });
    openBoard({ dir, actor: 'test' }).apply(A, { deleted: true });
    const before = readFileSync(join(issuesDir(), `${A}.ndjson`), 'utf8');

    expect(() => openBoard({ dir, actor: 'test' }).apply(A, { comment: 'x' })).toThrow(IssueDeleted);

    // 沿用「驗證先於任何寫入」的既有慣例：被拒絕的 Change 不得留下半個 Op。
    expect(readFileSync(join(issuesDir(), `${A}.ndjson`), 'utf8')).toBe(before);
  });
});

describe('復原', () => {
  it('apply({ deleted: false }) 不拋，而且它回到 list 裡', () => {
    createWith(A, { title: 'Fix login redirect' });
    openBoard({ dir, actor: 'test' }).apply(A, { deleted: true });

    // ADR-0009 選 LWW 而非吸收語意，換到的就是這個：復原是一次普通的寫入，
    // 跟改標題沒有兩樣，不必動用 git。
    const restored = openBoard({ dir, actor: 'test' }).apply(A, { deleted: false });

    expect(restored.deleted).toBe(false);
    expect(openBoard({ dir }).list().map((i) => i.id)).toEqual([A]);
  });
});

describe('board.opLog 對一張已刪的 Issue', () => {
  it('照常列出全部 op —— 誤刪的救生索', () => {
    createWith(A, { title: 'Fix login redirect', status: 'queued' });
    openBoard({ dir, actor: 'test' }).apply(A, { comment: 'safari 才會重現' });
    openBoard({ dir, actor: 'test' }).apply(A, { deleted: true });

    const ops = openBoard({ dir }).opLog(A);

    // ADR-0009：檔案永不 unlink，op-log 一行不減 —— 所以撈得回被刪掉的內容。
    expect(ops.map((o) => o.op)).toEqual(['create', 'set', 'comment', 'set']);
    expect(ops.at(-1)).toMatchObject({ op: 'set', k: 'deleted', v: true });
  });
});

describe('board.refs 對一張已刪的 Issue', () => {
  it('仍然列出它的 id —— 短 Ref 的長度不得因為有人刪東西而縮短', () => {
    createWith(A, { title: 'A' });
    createWith(B, { title: 'B' });

    openBoard({ dir, actor: 'test' }).apply(B, { deleted: true });

    // 短 Ref 的無歧義長度算在 refs() 上（ADR-0006）。若它縮短，使用者手上
    // 那些從 list 抄出來的字串會突然變有歧義，而且沒有任何辦法察覺。
    expect(openBoard({ dir }).refs()).toEqual([A, B]);
  });
});
