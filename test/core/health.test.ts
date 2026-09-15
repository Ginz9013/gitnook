import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initBoard, initDecisionRoot, DECISION_MERGE_RULE } from '../../src/core/gitattributes.js';
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

/** 要讀 git 的回答時用這個 —— `git()` 刻意只管「跑完沒出錯」。 */
const gitOut = (...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

describe('merge=union 那一行', () => {
  it('健康的 board 沒有任何 Diagnostic', () => {
    gitInit();
    initBoard(dir);

    expect(diagnose(dir)).toEqual([]);
  });

  it('那一行缺失時回報 MissingMergeDriver', () => {
    gitInit();
    initBoard(dir);
    // 唯一的單點失效：有人把那一行刪掉了（decision legacyRef 0001，`nook decision show 0001`）。
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

/**
 * fs 與 git 對「這塊 board 共享了嗎」給出不同答案的那兩種狀態。兩者都會靜默
 * 傷人：第一種正在累積衝突風險，第二種讓同事 clone 到一塊空 board。
 */
describe('fs 與 git 不一致的那兩種狀態', () => {
  /**
   * 狀態 1：排除規則在（fs 說 private），op-log 卻躺在 index 裡（git 說共享）。
   * 進到這裡要一次刻意的 `git add -f` —— ignore 中的路徑不加 -f 會被擋下。
   */
  const forcedIntoGit = (): void => {
    gitInit();
    initBoard(dir, { sharing: 'private' });
    opLog('01SEED00000000000000000005', ['{"id":"a1","t":1,"a":"k3f9","op":"create","title":"a"}']);
    git('add', '-f', '.issues');
    git('commit', '-q', '-m', 'add -f an ignored board');
  };

  // 這塊 board 實際上是共享的，而且真的沒有那條零衝突保證 —— 兩件事都要說。
  // 順序也釘住：唯一的單點失效仍然排第一，新 kind 不把它擠下去。
  it('排除規則在、op-log 卻被 tracked：SharingMismatch 與 MissingMergeDriver 一起說，保證那條仍在前', () => {
    forcedIntoGit();

    expect(inspectSharing(dir)).toBe('private');

    expect(diagnose(dir).map((d) => d.kind)).toEqual(['MissingMergeDriver', 'SharingMismatch']);
  });

  // 說出狀態不等於說得出下一步。這一種的下一步只有一條：`nook share` —— 既然
  // 這塊 board 已經共享出去了，就讓規則與事實一致，並把那條保證補上。
  it('狀態 1 的下一步是 nook share', () => {
    forcedIntoGit();

    const mismatch = diagnose(dir).find((d) => d.kind === 'SharingMismatch');

    expect(mismatch?.message).toContain('nook share');
  });

  /**
   * 狀態 2：nook 沒有寫任何排除規則（fs 說 shared），git 卻說 op-log 被 ignore
   * —— 例如 monorepo 的 committed `.gitignore` 有一條廣泛規則吃到了 `.issues/`。
   * board 看起來是共享的，同事 clone 下來卻是空的。
   */
  const ignoredByABroadRule = (): void => {
    gitInit();
    initBoard(dir); // 一塊普通的 shared board：info/exclude 一個字都沒動。
    writeFileSync(join(dir, '.gitignore'), '.issues/\n', 'utf8');
    git('add', '.gitignore');
    git('commit', '-q', '-m', 'a broad ignore rule');
  };

  // 行號與 pattern 是**這一層編不出來的東西**，只有 git 自己說得準，所以
  // `git check-ignore -v` 給的 `<file>:<line>:<pattern>` 原封不動帶著走。
  it('沒有 nook 的規則、git 卻說 op-log 被 ignore：帶上 git 自己指出的來源', () => {
    ignoredByABroadRule();

    // 前提：fs 這一側看不出任何異狀（那一行不在，所以答 shared）。
    expect(inspectSharing(dir)).toBe('shared');

    const found = diagnose(dir);

    expect(found.map((d) => d.kind)).toEqual(['SharingMismatch']);
    expect(found[0]!.message).toContain('.gitignore:1:.issues/');
  });

  /**
   * 同一個狀態的另一種形狀，而它正是「問目錄」漏掉的那一格：規則吃的是 op-log
   * **檔案**（`*.ndjson`）而不是那個目錄。實測（git 2.x）：這時問
   * `.issues/issues` 沒命中、問一個真的存在的 op-log 才命中 —— 而同事 clone
   * 下來一樣是空的，所以漏報就是漏報。
   */
  it('規則吃的是 op-log 檔而不是目錄時，也要報得出來', () => {
    gitInit();
    initBoard(dir);
    const board = openBoard({ dir });
    board.create({ title: '一張真的 Issue —— 規則要咬得到的是它' });
    writeFileSync(join(dir, '.gitignore'), '*.ndjson\n', 'utf8');
    git('add', '.gitignore');
    git('commit', '-q', '-m', 'ignore every ndjson');

    // 前提一：fs 這一側看不出異狀。前提二：git 真的在 ignore 那些 op-log
    // （`git status` 看不到它們），但**問目錄是問不出來的**。
    expect(inspectSharing(dir)).toBe('shared');
    // 針對 .issues/ 問：git 連「有個沒加入的檔案」都不會提，所以同事的 clone
    // 會是空的，而這裡什麼都不會提示。
    expect(gitOut('status', '--porcelain', '--', '.issues')).toBe('');

    const found = diagnose(dir);

    expect(found.map((d) => d.kind)).toEqual(['SharingMismatch']);
    expect(found[0]!.message).toContain('.gitignore:1:*.ndjson');
  });

  /**
   * 反向的那一半：ignore 規則蓋著整個目錄，但 op-log 已經被 `git add -f` 進去了
   * —— **tracked 勝過 ignore 規則**，board 真的在共享，所以狀態 2 不得開口。
   * 拿一個不存在的檔名去問 git 就會在這裡假警報（index 查不到它，規則就生效了）。
   */
  it('ignore 規則蓋著目錄但 op-log 已被追蹤時，不報狀態 2', () => {
    gitInit();
    initBoard(dir);
    const board = openBoard({ dir });
    board.create({ title: '已經共享出去的那一張' });
    writeFileSync(join(dir, '.gitignore'), '.issues/\n', 'utf8');
    git('add', '.gitignore');
    git('add', '-f', '.issues');
    git('commit', '-q', '-m', 'shared anyway');

    // 前提：規則在、但那些 op-log 確實在 index 裡。
    expect(gitOut('ls-files', '.issues/issues')).not.toBe('');

    // 這塊 board 的 merge=union 在（initBoard 寫的），op-log 也乾淨，所以
    // 一條都不該有 —— 尤其不能有 SharingMismatch。
    expect(diagnose(dir)).toEqual([]);
  });

  // 這一種有**兩條**下一步，而哪一條對只有使用者知道（他是不是真的想要一塊
  // private board）。兩條都講出來，不替他選。
  it('狀態 2 的兩條下一步都講：是刻意的就 init --private，不是就拿掉那條規則', () => {
    ignoredByABroadRule();

    const said = diagnose(dir)[0]!.message;

    expect(said).toContain('nook init --private');
    expect(said).toMatch(/remove/);
  });

  /**
   * 這一條的全部價值就是帶著 git 自己指出的 `<file>:<line>:<pattern>`。答案不是
   * 那個形狀時，我們**沒有**可報的東西 —— 而拿一個編不出來的來源去拉警報，比不
   * 講話更糟（doctor 會進 CI，一次假警報之後就沒有人會讀它）。
   *
   * 探針是 PATH 上一支假 git，不 mock 任何
   * 內部協作者。真的 git 在 `check-ignore -v` 命中時一定給
   * `<file>:<line>:<pattern>\t<pathname>`。
   */
  it('git 的答案不是 <file>:<line>:<pattern> 的形狀時閉嘴', () => {
    gitInit();
    initBoard(dir);
    const shim = join(dir, 'shim');
    mkdirSync(shim);
    // 對任何問題都 `echo true` + exit 0 —— 這裡要的就是「答案形狀不對」，
    // 因為這條測的正是「形狀不對就閉嘴」。其他測試的探針分指令回答，見
    // test/cli/run.test.ts 的 fakeGit。
    writeFileSync(join(shim, 'git'), '#!/bin/sh\necho true\n', { mode: 0o755 });

    const realPath = process.env.PATH;
    process.env.PATH = shim;
    try {
      expect(diagnose(dir)).toEqual([]);
    } finally {
      // delete 而不是賦值：PATH 本來就沒有時，`= undefined` 會留下字串 "undefined"。
      if (realPath === undefined) delete process.env.PATH;
      else process.env.PATH = realPath;
    }
  });
});

/**
 * 第三種不一致，而它是 private mode 裡唯一一種**三個面都沉默**的失敗：fs 說
 * private（nook 的那一行在），git 卻說沒 ignore。實測（git 2.50.1）那個狀態下
 * `nook list` 的 stderr 是 0 bytes、`nook doctor` 也是 0 bytes exit 0，而 board
 * 整塊在 `git status` 眼前 —— 下一次 `git add -A` 就把它推給全隊。
 */
describe('fs 說 private、git 卻說沒 ignore', () => {
  /**
   * 進到這個狀態的一種真實走法：committed 的 `.gitignore` 用一條否定規則把
   * `.issues/` 收回來了。`.gitignore` 的優先序高過 `$GIT_DIR/info/exclude`，
   * 所以 nook 那一行還在、卻完全沒有效果。
   */
  const privateButNotIgnored = (): void => {
    gitInit();
    initBoard(dir, { sharing: 'private' });
    openBoard({ dir, actor: 'k3f9' }).create({ title: '以為只存在於這台機器' });
    writeFileSync(join(dir, '.gitignore'), '!.issues/\n', 'utf8');
    git('add', '.gitignore');
    git('commit', '-q', '-m', 'un-ignore the nook board');
  };

  // 說出後果，因為狀態本身看不出嚴重性：這塊 board 進得了 git。
  it('回報 SharingMismatch，並說出下一次 git add -A 會把整塊 board 推出去', () => {
    privateButNotIgnored();

    // 前提一：fs 這一側看不出任何異狀（nook 的那一行在，所以答 private）。
    expect(inspectSharing(dir)).toBe('private');
    // 前提二：git 眼裡這塊 board 就是一堆 untracked 檔案 —— 規則沒有效果。
    expect(gitOut('status', '--porcelain')).toContain('.issues/');

    const found = diagnose(dir);

    expect(found.map((d) => d.kind)).toEqual(['SharingMismatch']);
    expect(found[0]!.message).toContain('git add -A');
  });

  /**
   * 說出狀態不等於說得出下一步，而**這一種的下一步不能是「重跑
   * `nook init --private`」**：這個狀態最常見的成因是一條優先序更高的否定規則，
   * 而那時 nook 那一行**已經在了** —— `init --private` 會回 unchanged、什麼都不動，
   * 使用者照做之後 doctor 再說一次同一句話，永遠。所以要指出是誰壓過它。
   */
  it('指出是哪一條規則壓過 nook 那一行，而不是叫人重跑一個沒用的指令', () => {
    privateButNotIgnored();

    const mismatch = diagnose(dir).find((d) => d.kind === 'SharingMismatch');

    // git 自己指出的那一行，原封不動 —— 檔名與行號是這一層編不出來的東西。
    expect(mismatch?.message).toContain('.gitignore:1:!.issues/');
    // 而且**不得**建議那個必然 unchanged 的指令。
    expect(mismatch?.message).not.toContain('nook init --private');
  });

  // `overridingRule` 回 null 的那一格（規則沒生效、git 也指不出是誰壓過它）
  // 沒有測試：造得出來的情境裡 git 都指得出來，而硬造一個不真實的情境去釘一條
  // 防禦性分支，釘住的會是那個假情境而不是行為。它的失敗方向是保守的 ——
  // 少說一句「是哪一條」，後果與問法照樣講。
});

/**
 * ticket 06：`diagnose()` 泛化成掃描一份已知實體 pattern 清單，Decision 是第二項
 * （票 01 的 `.decisions/decisions/*.ndjson merge=union`）。與 Issue 不同的地方
 * 是 Decision 沒有 private 模式（票 01 只支援 shared），所以它的閘門不是問
 * sharing，而是問 marker 目錄在不在 —— `.decisions/` 不存在時這個診斷在這個
 * repo 裡「不存在」，不是被壓掉的真問題（同 private-mode 的既有哲學）。
 *
 * 每個案例都先 initBoard 讓 Issue 側維持健康，才看得出回報的那一條確實是
 * Decision 專屬的，而不是 Issue 既有邏輯的副作用。
 */
describe('Decision 的零衝突保證', () => {
  it('.decisions/ 存在但缺少 merge=union 那一行時回報 MissingMergeDriver', () => {
    gitInit();
    initBoard(dir);
    initDecisionRoot(dir);
    // 只留 Issue 那一行，把 Decision 剛寫入的那一行拿掉——模擬那一行被誤刪。
    writeFileSync(join(dir, '.gitattributes'), '.issues/issues/*.ndjson merge=union\n', 'utf8');

    const found = diagnose(dir);

    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('MissingMergeDriver');
    expect(found[0]!.file).toBe('.gitattributes');
    expect(found[0]!.message).toContain(DECISION_MERGE_RULE);
    expect(found[0]!.message).toContain('nook decision init');
  });

  it('.decisions/ 的 .gitattributes 含衝突規則時，指出是哪一行把保證蓋掉', () => {
    gitInit();
    initBoard(dir);
    initDecisionRoot(dir);
    // 針對 Decision 的 pattern 疊一條 -merge，Issue 那一行不受影響（pattern
    // 不同）——這樣才能確認回報的正是 Decision 那一條，不是 Issue 的。
    writeFileSync(
      join(dir, '.gitattributes'),
      '.issues/issues/*.ndjson merge=union\n' +
        '.decisions/decisions/*.ndjson merge=union\n' +
        '.decisions/decisions/*.ndjson -merge\n',
      'utf8',
    );

    const found = diagnose(dir);

    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('MissingMergeDriver');
    expect(found[0]!.line).toBe(3);
    expect(found[0]!.message).toContain('.decisions/decisions/*.ndjson -merge');
  });

  it('.decisions/ 目錄不存在時完全沉默，不回報任何 Decision 相關 Diagnostic', () => {
    gitInit();
    initBoard(dir);
    expect(existsSync(join(dir, '.decisions'))).toBe(false);

    expect(diagnose(dir)).toEqual([]);
  });

  it('.decisions/ 存在且 merge=union 齊全時保持沉默，同 Issue 側既有行為', () => {
    gitInit();
    initBoard(dir);
    initDecisionRoot(dir);

    expect(diagnose(dir)).toEqual([]);
  });
});
