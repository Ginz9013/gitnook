import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBoardRoot, initBoard, initNook } from '../../src/core/gitattributes.js';
import { readNookConfig } from '../../src/core/nookConfig.js';

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
  it('建立 .gitnook/issues/ 與含 merge=union 那一行的 .gitattributes', () => {
    initBoard(dir);

    expect(statSync(join(dir, '.gitnook', 'issues')).isDirectory()).toBe(true);
    expect(existsSync(join(dir, '.gitattributes'))).toBe(true);
    // 這一行的字面內容取自 decision legacyRef 0001（`nook decision show 0001`）與 spec.md，非執行結果。
    expect(attrs().split('\n')).toContain('.gitnook/issues/*.ndjson merge=union');
    expect(attrs().endsWith('\n')).toBe(true);
  });
});

describe('initBoard 遇上既有的 .gitattributes', () => {
  it('append 規則且不動既有內容', () => {
    writeFileSync(join(dir, '.gitattributes'), '*.png binary\n*.md text\n', 'utf8');

    initBoard(dir);

    expect(attrs()).toBe('*.png binary\n*.md text\n.gitnook/issues/*.ndjson merge=union\n');
  });
});

describe('既有的 .gitattributes 缺少 trailing newline', () => {
  it('補上換行後才 append，不把規則黏在使用者的最後一行上', () => {
    writeFileSync(join(dir, '.gitattributes'), '*.png binary', 'utf8');

    initBoard(dir);

    expect(attrs()).toBe('*.png binary\n.gitnook/issues/*.ndjson merge=union\n');
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
    writeFileSync(join(dir, '.gitattributes'), '.gitnook/issues/*.ndjson\tmerge=union\n', 'utf8');

    initBoard(dir);

    expect(attrs()).toBe('.gitnook/issues/*.ndjson\tmerge=union\n');
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
    expect(existsSync(join(sub, '.gitnook'))).toBe(false);
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
    expect(existsSync(join(dir, '.gitnook', 'issues'))).toBe(false);
  });

  it('遇上對 *.ndjson 的其他 merge 設定時報錯停止', () => {
    writeFileSync(join(dir, '.gitattributes'), '*.ndjson merge=ours\n', 'utf8');

    const err = catchError(() => initBoard(dir));

    expect(err.name).toBe('ConflictingGitAttributes');
    expect(err.message).toContain('*.ndjson merge=ours');
  });

  it('本專案的規則被後面的 * -merge 蓋掉時也算衝突', () => {
    writeFileSync(join(dir, '.gitattributes'), '.gitnook/issues/*.ndjson merge=union\n* -merge\n', 'utf8');

    const err = catchError(() => initBoard(dir));

    expect(err.name).toBe('ConflictingGitAttributes');
    // 指出衝突的是後面那一行，而不是本專案自己的規則。
    expect(err.message).toContain('* -merge');
  });

  it('* -merge 在前、本專案規則在後時不算衝突（git 取最後一條）', () => {
    const before = '* -merge\n.gitnook/issues/*.ndjson merge=union\n';
    writeFileSync(join(dir, '.gitattributes'), before, 'utf8');

    initBoard(dir);

    expect(attrs()).toBe(before);
  });
});

/**
 * `nook init` 的唯一入口 —— 一次把 issues、decisions 兩個模組都準備好。
 * ADR-0004：真實檔案系統，`--private` 需要真實 git repo（`opLogsTracked`/
 * `excludeBoard` 會 spawn 真實的 git 子行程）。
 */
const gitInit = (): void => {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@nook.invalid'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Nook Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });
};

describe('initNook 在空目錄（shared，預設）', () => {
  it('同時建立 .gitnook/issues/ 與 .gitnook/decisions/，各自一條 merge=union 規則', () => {
    const result = initNook(dir);

    expect(statSync(join(dir, '.gitnook', 'issues')).isDirectory()).toBe(true);
    expect(statSync(join(dir, '.gitnook', 'decisions')).isDirectory()).toBe(true);
    // 各自一條，不合併成一條 glob——spec.md 的 Outcome 明講的不變量。
    expect(attrs().split('\n')).toContain('.gitnook/issues/*.ndjson merge=union');
    expect(attrs().split('\n')).toContain('.gitnook/decisions/*.ndjson merge=union');

    expect(result).toEqual({
      issues: 'created',
      decisions: 'created',
      gitattributes: 'created',
      workspace: 'unchanged',
      sharing: 'shared',
    });
  });
});

describe('initNook 重跑（已存在的 board）是冪等的', () => {
  it('兩次呼叫回報 Unchanged，規則不重複', () => {
    initNook(dir);

    const second = initNook(dir);

    expect(second).toEqual({
      issues: 'unchanged',
      decisions: 'unchanged',
      gitattributes: 'unchanged',
      workspace: 'unchanged',
      sharing: 'shared',
    });
    expect(attrs().split('\n').filter((l) => l.includes('merge=union'))).toHaveLength(2);
  });

  it('只有 issues 的舊 board 重新 initNook 後，補齊缺的 decisions 那一半', () => {
    initBoard(dir);
    expect(existsSync(join(dir, '.gitnook', 'decisions'))).toBe(false);

    const result = initNook(dir);

    expect(result.issues).toBe('unchanged');
    expect(result.decisions).toBe('created');
    expect(statSync(join(dir, '.gitnook', 'decisions')).isDirectory()).toBe(true);
    expect(attrs().split('\n')).toContain('.gitnook/decisions/*.ndjson merge=union');
  });
});

describe('initNook --private', () => {
  it('一條 exclude 規則涵蓋整個 .gitnook/，.gitattributes 完全不被寫入或讀取', () => {
    gitInit();
    const conflicting = '.gitnook/issues/*.ndjson merge=ours\n';
    writeFileSync(join(dir, '.gitattributes'), conflicting, 'utf8');

    const result = initNook(dir, { sharing: 'private' });

    expect(statSync(join(dir, '.gitnook', 'issues')).isDirectory()).toBe(true);
    expect(statSync(join(dir, '.gitnook', 'decisions')).isDirectory()).toBe(true);
    // 完全不碰：既有內容（即使是衝突規則）一個 byte 都沒被動過，也沒有因此報錯。
    expect(readFileSync(join(dir, '.gitattributes'), 'utf8')).toBe(conflicting);
    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n')).toContain('/.gitnook/');

    expect(result).toEqual({
      issues: 'created',
      decisions: 'created',
      gitattributes: 'unchanged',
      workspace: 'unchanged',
      sharing: 'private',
    });
  });

  it('op-log 已被 git 追蹤（issues 或 decisions 任一）時丟 AlreadySharedBoard', () => {
    gitInit();
    initNook(dir);
    writeFileSync(join(dir, '.gitnook', 'decisions', '01JBXA0000000000000000.ndjson'), '', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'share decisions'], { cwd: dir, stdio: 'ignore' });

    let error: Error | undefined;
    try {
      initNook(dir, { sharing: 'private' });
    } catch (e) {
      error = e as Error;
    }

    expect(error?.name).toBe('AlreadySharedBoard');
  });

  it('不在 git work tree 內時丟 NoGitDir，且不留下任何目錄', () => {
    let error: Error | undefined;
    try {
      initNook(dir, { sharing: 'private' });
    } catch (e) {
      error = e as Error;
    }

    expect(error?.name).toBe('NoGitDir');
    expect(existsSync(join(dir, '.gitnook'))).toBe(false);
  });
});

describe('initNook --workspace', () => {
  it('寫入 .gitnook/config.json 的 workspace: true', () => {
    const result = initNook(dir, { workspace: true });

    expect(result.workspace).toBe('enabled');
    expect(readNookConfig(dir)).toEqual({ workspace: true });
  });

  it('對已經是 true 的目錄重跑是 Unchanged', () => {
    initNook(dir, { workspace: true });

    const second = initNook(dir, { workspace: true });

    expect(second.workspace).toBe('unchanged');
    expect(readNookConfig(dir)).toEqual({ workspace: true });
  });

  it('不帶 --workspace 的重跑不會把已經是 true 的值改回 false', () => {
    initNook(dir, { workspace: true });

    const second = initNook(dir);

    expect(second.workspace).toBe('unchanged');
    expect(readNookConfig(dir)).toEqual({ workspace: true });
  });
});

describe('initNook 在既有 board 的子目錄執行', () => {
  it('丟 NestedBoard，只檢查一次卻涵蓋 issues 與 decisions 兩個模組', () => {
    initNook(dir);
    const sub = join(dir, 'src', 'deep');
    mkdirSync(sub, { recursive: true });

    let error: Error | undefined;
    try {
      initNook(sub);
    } catch (e) {
      error = e as Error;
    }

    expect(error?.name).toBe('NestedBoard');
    expect(error?.message).toContain(`root ${dir}`);
    expect(existsSync(join(sub, '.gitnook'))).toBe(false);
  });
});

/**
 * 票 03：找不到 `.gitnook/` 時，`findBoardRoot`/`findDecisionRoot` 順便沿路
 * 偵測舊版佈局 marker，回傳形狀讓 `BoardNotInitialized`/
 * `DecisionLogNotInitialized` 組出可直接複製貼上的 `git mv` 指令。
 */
describe('findBoardRoot 偵測舊版佈局', () => {
  it('只有舊版 .issues/issues/：legacy.issues 為 true，legacy.decisions 為 false', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    mkdirSync(join(dir, '.issues', 'issues'), { recursive: true });

    const found = findBoardRoot(dir);

    expect(found).toEqual({ found: false, ceiling: dir, legacy: { dir, issues: true, decisions: false } });
  });

  it('舊版 .issues/issues/ 與 .decisions/decisions/ 同時存在：兩個旗標都是 true', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    mkdirSync(join(dir, '.issues', 'issues'), { recursive: true });
    mkdirSync(join(dir, '.decisions', 'decisions'), { recursive: true });

    const found = findBoardRoot(dir);

    expect(found).toEqual({ found: false, ceiling: dir, legacy: { dir, issues: true, decisions: true } });
  });

  it('完全沒有舊版 marker：legacy 是 undefined，不憑空造一份', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });

    const found = findBoardRoot(dir);

    expect(found).toEqual({ found: false, ceiling: dir });
  });
});

describe('initNook shared 模式下既有 .gitattributes 有衝突規則', () => {
  it('丟 ConflictingGitAttributes，檢查排在建目錄之前，兩個模組都沒建出來', () => {
    const before = '.gitnook/issues/*.ndjson merge=ours\n';
    writeFileSync(join(dir, '.gitattributes'), before, 'utf8');

    let error: Error | undefined;
    try {
      initNook(dir);
    } catch (e) {
      error = e as Error;
    }

    expect(error?.name).toBe('ConflictingGitAttributes');
    expect(existsSync(join(dir, '.gitnook', 'issues'))).toBe(false);
    expect(existsSync(join(dir, '.gitnook', 'decisions'))).toBe(false);
    expect(attrs()).toBe(before);
  });

  it('decisions 側的衝突規則同樣在建目錄之前擋下，即使 issues 側沒有衝突', () => {
    const before = '.gitnook/decisions/*.ndjson merge=ours\n';
    writeFileSync(join(dir, '.gitattributes'), before, 'utf8');

    let error: Error | undefined;
    try {
      initNook(dir);
    } catch (e) {
      error = e as Error;
    }

    expect(error?.name).toBe('ConflictingGitAttributes');
    expect(existsSync(join(dir, '.gitnook', 'issues'))).toBe(false);
    expect(existsSync(join(dir, '.gitnook', 'decisions'))).toBe(false);
  });
});
