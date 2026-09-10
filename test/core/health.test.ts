import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initBoard } from '../../src/core/gitattributes.js';
import { diagnose, repair } from '../../src/core/health.js';
import { inspectSharing } from '../../src/core/sharing.js';
import { openBoard } from '../../src/core/board.js';

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

/** 在暫存 repo 裡跑一條 git 指令。只有這個暫存目錄會被寫到。 */
const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
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

/**
 * 零衝突保證在 private board 上是**不需要**，不是缺少 —— 被 ignore 的 op-log
 * 永遠不會 merge。所以這裡的沉默不是壓掉一個真問題，是那個問題在這個模式下
 * 不存在。而 doctor 會進 CI，所以正確行為是沉默，不是換一句溫和的提醒。
 */
describe('private board 上的零衝突保證', () => {
  it('健康的 private board 沒有任何 Diagnostic', () => {
    gitInit();
    initBoard(dir, { sharing: 'private' });
    // 前提成立才有這一條可言：private 的 init 完全不碰 .gitattributes，所以用
    // shared 的問法去問，缺失的那一條一定會報出來。
    expect(existsSync(join(dir, '.gitattributes'))).toBe(false);

    expect(diagnose(dir)).toEqual([]);
  });

  it('其餘檢查照舊 —— 黏合行與未知 op 照報，doctor --fix 照樣修得動', () => {
    gitInit();
    initBoard(dir, { sharing: 'private' });
    const create = '{"id":"a1","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}';
    const setOp = '{"id":"a2","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}';
    const label = '{"id":"a3","t":3,"a":"k3f9","op":"label.add","v":"bug"}';
    opLog('01SEED00000000000000000003', [
      create,
      `${setOp}${label}`,
      '{"id":"a4","t":4,"a":"k3f9","op":"teleport","v":"mars"}',
    ]);

    expect(diagnose(dir).map((d) => [d.kind, d.line])).toEqual([
      ['GluedLine', 2],
      ['UnknownOp', 3],
    ]);

    // --fix 那條路徑在 private board 上沒有變：黏合行還原得回來。
    expect(repair(dir).map((r) => r.line)).toEqual([2]);
    expect(diagnose(dir).map((d) => d.kind)).toEqual(['UnknownOp']);
  });

  /**
   * 壓制的條件是 private **且** op-log 沒有被 tracked。只靠 `inspectSharing`
   * 就閉嘴，會在這個狀態下漏掉一個真問題：規則在、檔案卻被 `git add -f` 進去了，
   * 所以它實際上是共享的，而且真的沒有那條零衝突保證。那一種矛盾狀態要**說話**
   * 是票 05 的事；這裡只釘住它不被壓掉。
   */
  it('規則在、op-log 卻被 git add -f 進去了：MissingMergeDriver 照常回報', () => {
    gitInit();
    initBoard(dir, { sharing: 'private' });
    opLog('01SEED00000000000000000004', ['{"id":"a1","t":1,"a":"k3f9","op":"create","title":"a"}']);
    // ignore 中的路徑不加 -f 會被 git 擋下 —— 進到這個狀態要一次刻意的動作。
    git('add', '-f', '.issues');
    git('commit', '-q', '-m', 'add -f an ignored board');

    // 兩個前提：nook 的那一行還在（fs 說 private），而 index 說它已經共享出去了。
    expect(inspectSharing(dir)).toBe('private');
    expect(execFileSync('git', ['ls-files', '.issues'], { cwd: dir, encoding: 'utf8' })).not.toBe('');

    // toContain 而不是整份比對：票 05 會在這個狀態上再加一條 SharingMismatch。
    expect(diagnose(dir).map((d) => d.kind)).toContain('MissingMergeDriver');
  });

  /**
   * 「不在 git 裡」不是 private。沒有 git 就沒有共享可言，也就沒有 private 可言
   * （private 整個建立在 `$GIT_DIR/info/exclude` 上），而這塊 board 遲早會被
   * `git init` 收進去 —— 那時候缺的那一行是真的缺。所以這裡照報兩條。
   */
  it('不在 git work tree 內的 board 不算 private：NotAGitRepo 與缺失的那一行都照報', () => {
    initBoard(dir); // 沒有 git init。
    writeFileSync(join(dir, '.gitattributes'), '*.png binary\n', 'utf8');

    expect(diagnose(dir).map((d) => d.kind)).toEqual(['NotAGitRepo', 'MissingMergeDriver']);
  });

  /**
   * `board.health()` 就是 `nook doctor` 報的東西（README 對 library 呼叫端的
   * 承諾），所以沉默也必須在這一條路徑上成立 —— doctor 進 CI 走的是這裡。
   */
  it('openBoard().health() 在健康的 private board 上同樣是空的', () => {
    gitInit();
    initBoard(dir, { sharing: 'private' });
    openBoard({ dir, actor: 'k3f9' }).create({ title: '只存在於這台機器' });

    expect(openBoard({ dir }).health()).toEqual([]);
  });
});
