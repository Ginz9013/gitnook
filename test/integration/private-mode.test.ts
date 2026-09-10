import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { initBoard } from '../../src/core/gitattributes.js';
import { excludeBoard, inspectSharing } from '../../src/core/sharing.js';

// ADR-0004：**不得以 in-memory fake 取代 git**。private mode 的整個賣點是
// 「git 看不到這塊 board」—— 那只有真實的 git（status / ls-files /
// check-ignore）答得出來。linked worktree 的 info/exclude 位置更是只有真實
// 的 `git worktree add` 才長得出那個形狀。

const dirs: string[] = [];

afterEach(() => {
  // worktree 的 admin 檔在主 repo 的 $GIT_DIR 裡，兩邊一起刪就不留殘骸。
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface GitResult {
  readonly status: number;
  readonly output: string;
}

/** 不拋出的 git，讓測試能對 exit code 本身下斷言 —— check-ignore 的答案就是 exit code。 */
function tryGit(cwd: string, ...args: string[]): GitResult {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function git(cwd: string, ...args: string[]): string {
  const r = tryGit(cwd, ...args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗 (${r.status})：${r.output}`);
  return r.output;
}

/**
 * 一個空的真實 git repo，**還沒有 board**。
 * 共用資源紀律：獨立 mkdtemp，且只設 local 設定 —— 不讀也不改使用者的全域設定。
 */
function makeRepo(prefix = 'nook-private-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@nook.invalid');
  git(dir, 'config', 'user.name', 'Nook Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

/**
 * git 自己說 info/exclude 在哪 —— 這是 linked worktree 那一條的實測基準。
 *
 * realpath 是必要的而不是保險：macOS 的 $TMPDIR 在 /var（一條指向 /private/var
 * 的 symlink）底下，而 linked worktree 的 gitdir 檔記的是 realpath，主 work tree
 * 問到的卻是相對路徑。不收斂成同一種寫法，兩邊會看起來不是同一個檔案。
 */
function excludeFileOf(cwd: string): string {
  const path = git(cwd, 'rev-parse', '--git-path', 'info/exclude').trim();
  return realpathSync(isAbsolute(path) ? path : resolve(cwd, path));
}

const linesOf = (file: string): string[] => readFileSync(file, 'utf8').split('\n');

describe('init --private 的核心路徑', () => {
  it('建出 board、把 /.issues/ 寫進 info/exclude，而 git 看不到任何東西', () => {
    const repo = makeRepo();

    initBoard(repo, { sharing: 'private' });

    expect(existsSync(join(repo, '.issues', 'issues'))).toBe(true);
    // private 模式完全不碰 .gitattributes：被 ignore 的 op-log 永遠不會 merge，
    // 那條規則在這裡是「不需要」而不是「缺少」。
    expect(existsSync(join(repo, '.gitattributes'))).toBe(false);
    expect(linesOf(excludeFileOf(repo))).toContain('/.issues/');
    // zero committed bytes：這一票的 outcome 就是這兩行。
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'ls-files', '.issues')).toBe('');
    // git 自己確認那條規則真的生效。不存在的路徑也答得出來（純 pattern 比對），
    // 所以不必先造一個 op-log 檔。
    expect(tryGit(repo, 'check-ignore', '-q', '.issues/issues/01JBXA.ndjson').status).toBe(0);
  });
});

describe('exclude 的寫入是冪等的', () => {
  it('重跑不會把規則寫成第二行，且說得出這次什麼都沒做', () => {
    const repo = makeRepo();
    const file = excludeFileOf(repo);

    initBoard(repo, { sharing: 'private' });
    // 第二次是使用者真的會做的事（忘了自己跑過）。它必須是 no-op 而不是錯誤。
    initBoard(repo, { sharing: 'private' });

    expect(linesOf(file).filter((l) => l === '/.issues/')).toHaveLength(1);
    // 回傳值是 init 的輸出要講的那件事：這次什麼都沒動。
    expect(excludeBoard(repo)).toBe('unchanged');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('info/exclude 不存在時建出它；存在時只補一行，不黏在使用者的最後一行上', () => {
    const fresh = makeRepo();
    const file = excludeFileOf(fresh);
    // git 自己的樣板不是契約的一部分 —— 這一半量的是「檔案不在時也要成立」。
    rmSync(file);

    expect(excludeBoard(fresh)).toBe('created');
    expect(readFileSync(file, 'utf8')).toBe('/.issues/\n');

    const used = makeRepo();
    // 缺 trailing newline 的既有檔案：直接 append 會生出 `*.log/.issues/`，
    // 那條規則兩邊都不生效（ADR-0001 硬規則 1 的同一種 I/O 紀律）。
    writeFileSync(excludeFileOf(used), '*.log', 'utf8');

    expect(excludeBoard(used)).toBe('added');
    expect(linesOf(excludeFileOf(used))).toEqual(['*.log', '/.issues/', '']);
  });
});

describe('inspectSharing 推導 Sharing', () => {
  it('private board 回答 private，shared board 與不是 repo 的目錄回答 shared', () => {
    const priv = makeRepo();
    initBoard(priv, { sharing: 'private' });

    const shared = makeRepo();
    // 剛 init 還沒 commit 的 board 也算 shared —— 它的意圖是共享，只是還沒送出去。
    initBoard(shared);

    const loose = mkdtempSync(join(tmpdir(), 'nook-private-norepo-'));
    dirs.push(loose);
    initBoard(loose);

    expect(inspectSharing(priv)).toBe('private');
    expect(inspectSharing(shared)).toBe('shared');
    expect(inspectSharing(loose)).toBe('shared');
  });

  it('手寫成別的形狀的 ignore 規則不算 private —— 刻意的窄，且失敗方向保守', () => {
    const repo = makeRepo();
    initBoard(repo);
    // git 確實會 ignore 它（沒有前導 / 的 pattern 比對任何層級），但 nook 只認
    // 自己寫的那一整行：通用的 pattern 與優先序規則只有 git 自己說得準，而
    // 讀取熱路徑不能 spawn git。
    writeFileSync(excludeFileOf(repo), '.issues/\n', 'utf8');
    expect(tryGit(repo, 'check-ignore', '-q', '.issues/issues/01JBXA.ndjson').status).toBe(0);

    // 照舊回答 shared = 照舊警告、照舊回報。那是保守的失敗，不是靜默的失敗。
    expect(inspectSharing(repo)).toBe('shared');
  });

  it('不 spawn 任何子行程 —— 它是 list / show 每一次都要付的錢', () => {
    const repo = makeRepo();
    initBoard(repo, { sharing: 'private' });

    const shim = mkdtempSync(join(tmpdir(), 'nook-private-shim-'));
    dirs.push(shim);
    const marker = join(shim, 'git-calls.txt');
    writeFileSync(join(shim, 'git'), `#!/bin/sh\necho "$@" >> "${marker}"\n`, { mode: 0o755 });

    const realPath = process.env.PATH;
    process.env.PATH = shim;
    try {
      // 探針是 PATH 上的一支假 git —— 量的是「有沒有真的生出一個子行程」這個
      // 外部可觀察的事實，不 mock 任何內部協作者（ADR-0004）。
      expect(inspectSharing(repo)).toBe('private');
      expect(existsSync(marker)).toBe(false);

      // 陽性對照：同一支探針在真的 spawn git 時必須開火，否則上面那個 false 是空的。
      tryGit(repo, 'status', '--porcelain');
      expect(existsSync(marker)).toBe(true);
    } finally {
      process.env.PATH = realPath;
    }
  });
});

describe('private 完全不碰 .gitattributes', () => {
  it('原本不存在就不建出來；原本存在就一個 byte 都沒變，連 conflicting 都不報錯', () => {
    const bare = makeRepo();

    initBoard(bare, { sharing: 'private' });

    expect(existsSync(join(bare, '.gitattributes'))).toBe(false);

    const kept = makeRepo();
    const existing = '*.png binary\n.issues/issues/*.ndjson merge=ours\n';
    writeFileSync(join(kept, '.gitattributes'), existing, 'utf8');

    initBoard(kept, { sharing: 'private' });

    expect(readFileSync(join(kept, '.gitattributes'), 'utf8')).toBe(existing);
    expect(inspectSharing(kept)).toBe('private');

    // 陽性對照：同一份內容在 shared 路徑上確實是「被擋下的那一種」，所以上面
    // 那個「沒報錯」不是因為這份內容無害，而是因為那條規則在 private 下無意義。
    const shared = makeRepo();
    writeFileSync(join(shared, '.gitattributes'), existing, 'utf8');
    expect(() => initBoard(shared)).toThrow(/merge=ours/);
  });
});

describe('board 不在 work tree 頂端', () => {
  it('寫的是 /<相對路徑>/.issues/，而且 git 確認那條規則真的生效', () => {
    const repo = makeRepo();
    const nested = join(repo, 'services', 'api');
    mkdirSync(nested, { recursive: true });

    initBoard(nested, { sharing: 'private' });

    // pattern 一律相對於 work tree 頂端 —— info/exclude 是整個 repo 的一份檔案，
    // 寫成 /.issues/ 會排除掉頂端那塊（不存在的）board 而放過這一塊。
    expect(linesOf(excludeFileOf(repo))).toContain('/services/api/.issues/');
    expect(
      tryGit(repo, 'check-ignore', '-q', 'services/api/.issues/issues/01JBXA.ndjson').status,
    ).toBe(0);
    // 錨定的另一半：頂端的同名路徑不該被這條規則掃到。
    expect(tryGit(repo, 'check-ignore', '-q', '.issues/issues/01JBXA.ndjson').status).toBe(1);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(inspectSharing(nested)).toBe('private');
  });
});

describe('linked worktree', () => {
  it('規則進的是共用的 info/exclude —— .git 是一個檔案，還要再讀 commondir', () => {
    const main = makeRepo();
    // worktree add 需要一個 HEAD。空 commit 就夠，而且 board 不進 git，所以
    // 這個 commit 裡什麼都沒有。
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    const linked = join(mkdtempSync(join(tmpdir(), 'nook-private-wt-')), 'side');
    dirs.push(dirname(linked));
    git(main, 'worktree', 'add', '-q', '-b', 'side', linked);

    // 前提成立才有這一條測試可言：linked worktree 的 .git 是檔案，不是目錄。
    expect(statSync(join(linked, '.git')).isFile()).toBe(true);

    initBoard(linked, { sharing: 'private' });

    // 實測基準：git 自己說 info/exclude 在 common dir，兩邊問到同一個檔案。
    expect(excludeFileOf(linked)).toBe(excludeFileOf(main));
    expect(linesOf(excludeFileOf(linked))).toContain('/.issues/');
    expect(tryGit(linked, 'check-ignore', '-q', '.issues/issues/01JBXA.ndjson').status).toBe(0);
    expect(git(linked, 'status', '--porcelain')).toBe('');
    expect(inspectSharing(linked)).toBe('private');

    // 代價三：ignore 規則是共用的，untracked 的檔案不是 —— 每個 worktree 各有
    // 一塊空 board。這裡把那個事實釘住，README 要講的就是它。
    expect(existsSync(join(main, '.issues'))).toBe(false);
  });
});
