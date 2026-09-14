import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initBoard } from '../../src/core/gitattributes.js';

// ADR-0004：打真實檔案系統與獨立的暫存目錄，不使用 in-memory fake。
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-attrs-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const attrs = (): string => readFileSync(join(dir, '.gitattributes'), 'utf8');

describe('initBoard 在空目錄', () => {
  it('建立 .issues/issues/ 與含 merge=union 那一行的 .gitattributes', () => {
    initBoard(dir);

    expect(statSync(join(dir, '.issues', 'issues')).isDirectory()).toBe(true);
    expect(existsSync(join(dir, '.gitattributes'))).toBe(true);
    // 這一行的字面內容取自 docs/adr/0001 與 spec.md，非執行結果。
    expect(attrs().split('\n')).toContain('.issues/issues/*.ndjson merge=union');
    expect(attrs().endsWith('\n')).toBe(true);
  });
});

describe('initBoard 遇上既有的 .gitattributes', () => {
  it('append 規則且不動既有內容', () => {
    writeFileSync(join(dir, '.gitattributes'), '*.png binary\n*.md text\n', 'utf8');

    initBoard(dir);

    expect(attrs()).toBe('*.png binary\n*.md text\n.issues/issues/*.ndjson merge=union\n');
  });
});

describe('既有的 .gitattributes 缺少 trailing newline', () => {
  it('補上換行後才 append，不把規則黏在使用者的最後一行上', () => {
    writeFileSync(join(dir, '.gitattributes'), '*.png binary', 'utf8');

    initBoard(dir);

    expect(attrs()).toBe('*.png binary\n.issues/issues/*.ndjson merge=union\n');
  });
});

describe('重複 initBoard', () => {
  it('是冪等的：規則只寫一次', () => {
    initBoard(dir);
    const first = attrs();

    initBoard(dir);

    expect(attrs()).toBe(first);
    expect(attrs().split('\n').filter((l) => l.includes('merge=union'))).toHaveLength(1);
  });
});

describe('既有規則已經保證 union 但寫法不同', () => {
  it('用 tab 分隔的同一條規則不重複寫入', () => {
    writeFileSync(join(dir, '.gitattributes'), '.issues/issues/*.ndjson\tmerge=union\n', 'utf8');

    initBoard(dir);

    expect(attrs()).toBe('.issues/issues/*.ndjson\tmerge=union\n');
  });

  it('涵蓋範圍更廣的 *.ndjson merge=union 不重複寫入', () => {
    writeFileSync(join(dir, '.gitattributes'), '*.ndjson merge=union\n', 'utf8');

    initBoard(dir);

    expect(attrs()).toBe('*.ndjson merge=union\n');
  });
});

const catchError = (fn: () => void): Error => {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('預期 initBoard 會拋錯，但它正常返回了');
};

describe('initBoard 在既有 board 的子目錄', () => {
  it('拒絕並指出既有 board 的位置，不靜默切出第二塊', () => {
    initBoard(dir);
    const sub = join(dir, 'src', 'deep');
    mkdirSync(sub, { recursive: true });

    const err = catchError(() => initBoard(sub));

    // 兩塊 board 會各自累積 Issue，而且沒有任何東西會提示 ——
    // 這是資料完整性問題，所以拒絕而不是照做。
    expect(err.name).toBe('NestedBoard');
    expect(err.message).toContain(`root ${dir}`);
    expect(existsSync(join(sub, '.issues'))).toBe(false);
  });
});

describe('既有的 .gitattributes 含衝突規則', () => {
  it('遇上 * -merge 時報錯停止，不靜默改變使用者的 merge 行為', () => {
    const before = '* -merge\n*.png binary\n';
    writeFileSync(join(dir, '.gitattributes'), before, 'utf8');

    const err = catchError(() => initBoard(dir));

    expect(err.name).toBe('ConflictingGitAttributes');
    expect(err.message).toContain('* -merge');
    expect(attrs()).toBe(before);
    expect(existsSync(join(dir, '.issues', 'issues'))).toBe(false);
  });

  it('遇上對 *.ndjson 的其他 merge 設定時報錯停止', () => {
    writeFileSync(join(dir, '.gitattributes'), '*.ndjson merge=ours\n', 'utf8');

    const err = catchError(() => initBoard(dir));

    expect(err.name).toBe('ConflictingGitAttributes');
    expect(err.message).toContain('*.ndjson merge=ours');
  });

  it('本專案的規則被後面的 * -merge 蓋掉時也算衝突', () => {
    writeFileSync(join(dir, '.gitattributes'), '.issues/issues/*.ndjson merge=union\n* -merge\n', 'utf8');

    const err = catchError(() => initBoard(dir));

    expect(err.name).toBe('ConflictingGitAttributes');
    // 指出衝突的是後面那一行，而不是本專案自己的規則。
    expect(err.message).toContain('* -merge');
  });

  it('* -merge 在前、本專案規則在後時不算衝突（git 取最後一條）', () => {
    const before = '* -merge\n.issues/issues/*.ndjson merge=union\n';
    writeFileSync(join(dir, '.gitattributes'), before, 'utf8');

    initBoard(dir);

    expect(attrs()).toBe(before);
  });
});
