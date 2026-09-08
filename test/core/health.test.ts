import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initBoard } from '../../src/core/gitattributes.js';
import { diagnose } from '../../src/core/health.js';

// ADR-0004：真實檔案系統、真實 git、獨立的暫存目錄，不使用 fake。
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-health-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 只設 local 設定，不依賴也不修改使用者的全域 git 設定。 */
const gitInit = (): void => {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@nook.invalid'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Nook Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });
};

describe('merge=union 那一行', () => {
  it('健康的 board 沒有任何 Diagnostic', () => {
    gitInit();
    initBoard(dir);

    expect(diagnose(dir)).toEqual([]);
  });

  it('那一行缺失時回報 MissingMergeDriver', () => {
    gitInit();
    initBoard(dir);
    // 唯一的單點失效：有人把那一行刪掉了（docs/adr/0001）。
    writeFileSync(join(dir, '.gitattributes'), '*.png binary\n', 'utf8');

    const found = diagnose(dir);

    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('MissingMergeDriver');
    expect(found[0]!.file).toBe('.gitattributes');
  });
});

describe('不是 git repo', () => {
  it('回報 NotAGitRepo 而非崩潰', () => {
    initBoard(dir); // 沒有 git init：.gitattributes 在這裡不會生效。

    const found = diagnose(dir);

    expect(found.map((d) => d.kind)).toEqual(['NotAGitRepo']);
    expect(found[0]!.message).not.toBe('');
  });
});

const opLog = (id: string, lines: readonly string[]): void => {
  writeFileSync(join(dir, '.issues', 'issues', `${id}.ndjson`), lines.map((l) => `${l}\n`).join(''), 'utf8');
};

describe('無法解析的行', () => {
  it('回報 UnparsableLine 並指出檔案與行號，尾端換行不算一行', () => {
    gitInit();
    initBoard(dir);
    opLog('01SEED00000000000000000001', [
      '{"id":"a1","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}',
      'not json at all',
      '{"id":"a3","t":3,"a":"k3f9","op":"create","title":"另一張"}',
    ]);

    const found = diagnose(dir);

    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('UnparsableLine');
    expect(found[0]!.file).toBe('.issues/issues/01SEED00000000000000000001.ndjson');
    expect(found[0]!.line).toBe(2);
  });

  it('彙整多個檔案與板級診斷，依檔案與行號排序', () => {
    gitInit();
    initBoard(dir);
    writeFileSync(join(dir, '.gitattributes'), '*.png binary\n', 'utf8');
    opLog('01SEED00000000000000000002', ['{"id":"b1","t":1,"a":"k3f9","op":"create","title":"b"}', '['] );
    opLog('01SEED00000000000000000001', ['oops', '{"id":"a1","t":1,"a":"k3f9","op":"create","title":"a"}']);

    const found = diagnose(dir);

    expect(found.map((d) => [d.kind, d.file, d.line])).toEqual([
      ['MissingMergeDriver', '.gitattributes', undefined],
      ['UnparsableLine', '.issues/issues/01SEED00000000000000000001.ndjson', 1],
      ['UnparsableLine', '.issues/issues/01SEED00000000000000000002.ndjson', 2],
    ]);
  });
});

describe('.gitattributes 含衝突規則', () => {
  it('同樣回報 MissingMergeDriver，並指出是哪一行把保證蓋掉', () => {
    gitInit();
    initBoard(dir);
    writeFileSync(join(dir, '.gitattributes'), '.issues/issues/*.ndjson merge=union\n* -merge\n', 'utf8');

    const found = diagnose(dir);

    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('MissingMergeDriver');
    expect(found[0]!.line).toBe(2);
    expect(found[0]!.message).toContain('* -merge');
  });
});
