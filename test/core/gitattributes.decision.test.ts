import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBoardRoot, initBoard } from '../../src/core/gitattributes.js';
import { initDecisionRoot, findDecisionRoot } from '../../src/core/gitattributes.js';

// ADR-0004：真實檔案系統，每個測試用例獨立 mkdtemp。
// 這個檔案只測「泛化尋根/初始化」給 Decision 用的那一半 ——
// gitattributes.test.ts（Issue 既有那份）一行都不改，仍然要全綠。
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-decision-attrs-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const attrs = (): string => readFileSync(join(dir, '.gitattributes'), 'utf8');

describe('initDecisionRoot 在空目錄', () => {
  it('建立 .decisions/decisions/ 與含 merge=union 那一行的 .gitattributes', () => {
    initDecisionRoot(dir);

    expect(statSync(join(dir, '.decisions', 'decisions')).isDirectory()).toBe(true);
    expect(existsSync(join(dir, '.gitattributes'))).toBe(true);
    expect(attrs().split('\n')).toContain('.decisions/decisions/*.ndjson merge=union');
    expect(attrs().endsWith('\n')).toBe(true);
  });
});

describe('initDecisionRoot 遇上既有的 .gitattributes', () => {
  it('append 規則且不動既有內容', () => {
    writeFileSync(join(dir, '.gitattributes'), '*.png binary\n', 'utf8');

    initDecisionRoot(dir);

    expect(attrs()).toBe('*.png binary\n.decisions/decisions/*.ndjson merge=union\n');
  });
});

describe('重複 initDecisionRoot', () => {
  it('是冪等的：規則只寫一次', () => {
    initDecisionRoot(dir);
    const first = attrs();

    initDecisionRoot(dir);

    expect(attrs()).toBe(first);
    expect(attrs().split('\n').filter((l) => l.includes('merge=union'))).toHaveLength(1);
  });
});

describe('findDecisionRoot', () => {
  it('由子目錄向上找到含 .decisions/decisions 的根', () => {
    initDecisionRoot(dir);
    const sub = join(dir, 'src', 'deep');
    mkdirSync(sub, { recursive: true });

    const found = findDecisionRoot(sub);

    expect(found).toEqual({ found: true, root: dir });
  });

  it('找不到時回報 ceiling', () => {
    const found = findDecisionRoot(dir);

    expect(found.found).toBe(false);
  });
});

describe('initDecisionRoot 在既有 decision log 的子目錄', () => {
  it('拒絕並指出既有 log 的位置，不靜默切出第二塊', () => {
    initDecisionRoot(dir);
    const sub = join(dir, 'src', 'deep');
    mkdirSync(sub, { recursive: true });

    let error: Error | undefined;
    try {
      initDecisionRoot(sub);
    } catch (e) {
      error = e as Error;
    }

    expect(error?.name).toBe('NestedBoard');
    expect(existsSync(join(sub, '.decisions'))).toBe(false);
  });
});

describe('既有的 .gitattributes 對 .decisions 的 op-log 含衝突規則', () => {
  it('遇上 * -merge 時報錯停止，不靜默改變使用者的 merge 行為', () => {
    const before = '* -merge\n*.png binary\n';
    writeFileSync(join(dir, '.gitattributes'), before, 'utf8');

    let error: Error | undefined;
    try {
      initDecisionRoot(dir);
    } catch (e) {
      error = e as Error;
    }

    expect(error?.name).toBe('ConflictingGitAttributes');
    expect(attrs()).toBe(before);
    expect(existsSync(join(dir, '.decisions', 'decisions'))).toBe(false);
  });
});

describe('Issue 的 initBoard/findBoardRoot 不受 Decision 泛化影響', () => {
  it('initBoard 建出 .issues/issues，與 .decisions 完全獨立', () => {
    initBoard(dir);
    initDecisionRoot(dir);

    expect(existsSync(join(dir, '.issues', 'issues'))).toBe(true);
    expect(existsSync(join(dir, '.decisions', 'decisions'))).toBe(true);
    expect(attrs()).toContain('.issues/issues/*.ndjson merge=union');
    expect(attrs()).toContain('.decisions/decisions/*.ndjson merge=union');

    const boardRoot = findBoardRoot(dir);
    const decisionRoot = findDecisionRoot(dir);
    expect(boardRoot).toEqual({ found: true, root: dir });
    expect(decisionRoot).toEqual({ found: true, root: dir });
  });
});
