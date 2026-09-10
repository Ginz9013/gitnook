import { describe, it, expect, afterEach, vi } from 'vitest';
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
import { run } from '../../src/cli/run.js';
import type { Io } from '../../src/cli/run.js';
import { openBoard } from '../../src/core/board.js';
import { diagnose } from '../../src/core/health.js';
import {
  AlreadySharedBoard,
  NoGitDir,
  excludeBoard,
  inspectSharing,
  opLogsTracked,
} from '../../src/core/sharing.js';

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
 * 一塊**已經共享出去的** board：op-log 真的躺在 git 的 index 裡。
 *
 * 刻意走 openBoard().create() 而不是手寫一個 ndjson —— 要 tracked 的是 nook
 * 自己會寫出來的那個形狀的檔案，而 op-log 的格式不是這一批發明得出來的。
 * `initBoard` 之後的空 `.issues/issues/` 是 git 看不見的（git 不追蹤空目錄），
 * 所以一定要先有一張 Issue 才 commit 得到東西。
 */
function makeSharedBoard(): string {
  const repo = makeRepo('nook-private-shared-');
  initBoard(repo);
  openBoard({ dir: repo, actor: 'aaaa' }).create({ title: 'Fix login redirect' });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'share the board');
  return repo;
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

/**
 * 捕獲輸出的 `Io`。CLI 的行為測在這個檔案裡而不是 `test/cli/run.test.ts`，因為
 * 這兩條拒絕要的前提是一塊**真的被 commit 過的** board，而造那個前提的
 * `makeSharedBoard()` 住在這裡。`Io` 本身仍然是注入的 adapter（ADR-0004 的兩個
 * 真實接縫之一）—— 被 spawn 的只有 git，不是 nook 自己。
 */
interface Capture extends Io {
  out: string;
  err: string;
}

function capture(cwd: string): Capture {
  return {
    out: '',
    err: '',
    cwd,
    env: {},
    isTty: false,
    write(text: string) {
      this.out += text;
    },
    writeError(text: string) {
      this.err += text;
    },
    readStdin() {
      throw new Error('測試未提供 stdin');
    },
  };
}

/** 丟出來的那個東西本身 —— 型別與訊息都要下斷言，`toThrow` 只給得起一半。 */
function caught(fn: () => void): unknown {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  throw new Error('預期會丟出例外，但它正常回傳了');
}

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

describe('那一行的字面意義 —— 左右兩側不對稱', () => {
  /**
   * 這一條守的是整個不變式的**失敗方向**。`trim()` 比對會把 git 不承認的規則
   * 當成 nook 的那一行：`inspectSharing` 回答 private（list / show 因此停止
   * 警告）、`excludeBoard` 回答 unchanged（因此永遠不補上一條生效的規則）——
   * 使用者得到一塊「nook 說 private、git 說沒 ignore」的 board，而沒有任何
   * 東西會提示。基準一律是真實的 git check-ignore，不是我們對 gitignore 的記憶。
   */
  it('前導空白的規則 git 不承認，所以 nook 也不得承認', () => {
    for (const written of [' /.issues/', '\t/.issues/']) {
      const repo = makeRepo();
      initBoard(repo);
      writeFileSync(excludeFileOf(repo), `${written}\n`, 'utf8');

      // 先確認前提：git 真的不 ignore 它（前導空白是 pattern 的一部分）。
      expect(tryGit(repo, 'check-ignore', '-q', '.issues/issues/x.ndjson').status).toBe(1);
      expect(inspectSharing(repo)).toBe('shared');
      // 而且補得上去 —— 答 shared 之後還回 unchanged 等於永遠不修。
      expect(excludeBoard(repo)).toBe('added');
      expect(tryGit(repo, 'check-ignore', '-q', '.issues/issues/x.ndjson').status).toBe(0);
    }
  });

  it('尾端空白與 CR 是 git 自己就忽略的，所以那仍然是 nook 的那一行', () => {
    for (const written of ['/.issues/   ', '/.issues/\r']) {
      const repo = makeRepo();
      initBoard(repo);
      writeFileSync(excludeFileOf(repo), `${written}\n`, 'utf8');

      // 前提同上，但這次 git 說它生效 —— 所以答 private 才與 git 一致。
      expect(tryGit(repo, 'check-ignore', '-q', '.issues/issues/x.ndjson').status).toBe(0);
      expect(inspectSharing(repo)).toBe('private');
      expect(excludeBoard(repo)).toBe('unchanged');
    }
  });
});

describe('拒絕時不留痕跡', () => {
  /**
   * 排除失敗（這裡是不在 git work tree 內）時若已經 mkdir 過，使用者會得到
   * 一個 **git 看得見的** .issues/ —— 與他要的正好相反，而他以為指令失敗了。
   * 那條拒絕的使用者訊息屬於票 02；這一條守的是順序。
   */
  it('不在 git work tree 內時丟錯，且不留下 .issues/', () => {
    const loose = mkdtempSync(join(tmpdir(), 'nook-private-norepo-'));
    dirs.push(loose);

    expect(() => initBoard(loose, { sharing: 'private' })).toThrow();
    expect(existsSync(join(loose, '.issues'))).toBe(false);
  });

  /**
   * 已共享的 board 上那條拒絕守的是同一件事，只是「痕跡」換了形狀：board 目錄
   * 本來就在，所以會被留下的是 **info/exclude 多出來的那一行** —— 一條對
   * tracked 的路徑毫無效果、卻讓 `inspectSharing` 從此回答 private 的規則。
   * 那會讓 list / show 停止警告一塊其實共享中的 board，正是要避開的靜默失敗。
   */
  it('op-log 已被追蹤時丟錯，且 info/exclude 一個 byte 都沒多', () => {
    const repo = makeSharedBoard();
    const file = excludeFileOf(repo);
    const before = readFileSync(file, 'utf8');

    expect(() => initBoard(repo, { sharing: 'private' })).toThrow(AlreadySharedBoard);

    expect(readFileSync(file, 'utf8')).toBe(before);
    // 那塊 board 還是共享的 —— 拒絕沒有順手把它變成「nook 說 private」的狀態。
    expect(inspectSharing(repo)).toBe('shared');
    // 工作目錄也沒被動過：沒有新檔案、沒有新目錄。
    expect(git(repo, 'status', '--porcelain')).toBe('');
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

describe('opLogsTracked —— git 的 index 才是共享狀態的權威', () => {
  /**
   * 這是模組介面上的函式，不是 init 私有的 helper：票 04 的 doctor 要靠同一個
   * 問法決定該不該壓掉 MissingMergeDriver。基準一律是真實的 `git ls-files`，
   * 因為 index 的內容只有 git 自己答得出來。
   */
  it('op-log 進了 index 就回 true；還沒 commit 的 board 與不是 repo 的目錄回 false', () => {
    const shared = makeSharedBoard();
    // 前提成立才有這一條可言：git 真的在追蹤那些檔案。
    expect(git(shared, 'ls-files', '.issues')).not.toBe('');

    const fresh = makeRepo();
    initBoard(fresh);
    // 剛 init 還沒 commit 的 board：意圖是共享，但 index 裡還沒有東西。
    openBoard({ dir: fresh, actor: 'bbbb' }).create({ title: 'not committed yet' });

    const loose = mkdtempSync(join(tmpdir(), 'nook-private-norepo-'));
    dirs.push(loose);
    initBoard(loose);

    expect(opLogsTracked(shared)).toBe(true);
    expect(opLogsTracked(fresh)).toBe(false);
    // 不在 git work tree 內時沒有 index 可問 —— 答 false（沒有東西被追蹤）而
    // 不是拋出例外：這個函式回答的是一個是非題，拒絕是呼叫端的事。
    expect(opLogsTracked(loose)).toBe(false);
  });
});

describe('op-log 已經被 git 追蹤時，init --private 拒絕', () => {
  /**
   * 這塊 board 已經共享出去了，而 **tracked 勝過 ignore 規則** —— 照寫 exclude
   * 規則會是一個完全沒有效果的動作，使用者卻會以為成功了。那是靜默失敗，所以
   * 這裡拒絕，並把使用者**自己**要跑的那一行講出來：降級是破壞性的，nook 不替
   * 他執行任何會寫入的 git 指令（spec.md 的 non-goal `nook unshare`）。
   */
  it('丟 AlreadySharedBoard，訊息講出使用者自己要跑的 git rm -r --cached', () => {
    const repo = makeSharedBoard();
    // 前提：git 真的在追蹤 op-log，而且因此不認那條 ignore 規則會有任何效果。
    expect(git(repo, 'ls-files', '.issues')).not.toBe('');

    const error = caught(() => initBoard(repo, { sharing: 'private' }));

    expect(error).toBeInstanceOf(AlreadySharedBoard);
    // 指令帶完整路徑：board 不在 repo 根目錄時，一條相對指令會在錯的目錄下
    // 執行，而 git 只會說 pathspec 沒命中 —— 貼得上去才算講出解法。
    expect((error as Error).message).toContain(`git rm -r --cached "${repo}/.issues"`);
    // 「你自己跑」這件事必須寫在訊息裡，否則使用者會等 nook 動手。
    expect((error as Error).message).toContain('自己');
  });
});

describe('答不出來時不得答「沒共享」', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * 只有「git 真的跑完、而它自己以非 0 結束」才算「沒有被追蹤」。git 不在 PATH 上
   * 這類失敗表示我們**不知道**這塊 board 是否已共享，而「不知道」被當成「沒共享」
   * 會讓 init 在一塊真的已共享的 board 上寫下一條無效規則 —— 正是這條拒絕存在的
   * 理由。所以那種失敗往外丟，不吞。
   */
  it('git 根本跑不起來時往外丟，而不是回 false', () => {
    const repo = makeSharedBoard();
    const nowhere = mkdtempSync(join(tmpdir(), 'nook-private-nopath-'));
    dirs.push(nowhere);
    // PATH 上沒有 git：execFileSync 以 ENOENT 失敗，那不是 git 的答案。
    vi.stubEnv('PATH', nowhere);

    expect(() => opLogsTracked(repo)).toThrow();
  });
});

describe('共享狀態問的是 op-log，不是整個 .issues/', () => {
  /**
   * `opLogsTracked` 有兩個消費者，而寬一格對它們不是同一個答案：對 init 的拒絕，
   * 多拒是保守的；但 doctor 拿它當否決權（答 true 就是「不要壓掉
   * MissingMergeDriver」），寬一格就變成**假陽性** —— 一塊 private board 底下有個
   * 被 commit 過的 .gitkeep，op-log 本身仍然沒被追蹤，board 其實是 private，
   * doctor 卻會吐出診斷並 exit 1，直接打破「健康的 private board 上 doctor 沉默」。
   *
   * 前提由真實的 git 確認，不靠我們對 pathspec 的記憶。
   */
  it('只有 .gitkeep 進了 index 時不算共享，doctor 因此仍然沉默', () => {
    const repo = makeRepo();
    initBoard(repo, { sharing: 'private' });
    writeFileSync(join(repo, '.issues', '.gitkeep'), '', 'utf8');
    // -f 是必要的：整個 .issues/ 已經被排除了。
    git(repo, 'add', '-f', '.issues/.gitkeep');
    git(repo, 'commit', '-qm', 'keep the dir');

    // 前提一：git 確實追蹤著 .issues/ 底下的某個東西（寬的問法會答 true）。
    expect(git(repo, 'ls-files', '.issues')).not.toBe('');
    // 前提二：op-log 本身仍然沒有被追蹤，而且仍然被 ignore。
    expect(git(repo, 'ls-files', '.issues/issues')).toBe('');

    expect(opLogsTracked(repo)).toBe(false);
    expect(inspectSharing(repo)).toBe('private');
    expect(diagnose(repo)).toEqual([]);
  });
});

describe('拒絕時一個目錄都不建', () => {
  /**
   * 「什麼都沒寫」的另一半：git 看不見空目錄，所以只比對 info/exclude 與
   * `git status` 的話，把 mkdir 搬到拒絕之前不會讓任何測試變紅。這個情境
   * （index 裡有 .issues，工作目錄那一份被 rm -rf 掉了）讓那一半也有斷言。
   */
  it('op-log 在 index 裡、工作目錄卻沒有那個目錄時，拒絕不會順手把它建回來', () => {
    const repo = makeSharedBoard();
    rmSync(join(repo, '.issues'), { recursive: true, force: true });
    const before = readFileSync(excludeFileOf(repo), 'utf8');

    expect(caught(() => initBoard(repo, { sharing: 'private' }))).toBeInstanceOf(
      AlreadySharedBoard,
    );

    expect(existsSync(join(repo, '.issues'))).toBe(false);
    expect(readFileSync(excludeFileOf(repo), 'utf8')).toBe(before);
  });
});

describe('不在 git work tree 內時，init --private 拒絕', () => {
  /**
   * 沒有 git 就沒有共享可言，也就沒有 private 可言 —— 這個模式整個建立在
   * `$GIT_DIR/info/exclude` 上。所以訊息不給 `git init` 那種迂迴，直接叫他跑
   * `nook init`：他要的「一塊 board」在這裡本來就不需要 `--private`。
   */
  it('丟 NoGitDir，訊息叫人直接 nook init', () => {
    const loose = mkdtempSync(join(tmpdir(), 'nook-private-norepo-'));
    dirs.push(loose);

    const error = caught(() => initBoard(loose, { sharing: 'private' }));

    expect(error).toBeInstanceOf(NoGitDir);
    expect((error as Error).message).toContain('nook init');
    // 說得出是哪個目錄 —— 尋根是向上走的，使用者未必站在他以為的那一層。
    expect((error as Error).message).toContain(loose);
  });
});

describe('兩條拒絕在 CLI 上都是 exit 1', () => {
  /**
   * exit 1 與 exit 2 的差別不是好看：**1 是「改你的指令」，2 是「回報一個 nook
   * bug」**。這兩條都是使用者自己修得好的，所以它們屬於 USER_ERRORS —— 而 exit 2
   * 的那條路還會在訊息前面掛上型別名，那是寫給維護者、不是寫給使用者的。
   */
  it('op-log 已被追蹤：exit 1，stderr 就是那句講得出解法的話', async () => {
    const repo = makeSharedBoard();
    const io = capture(repo);

    expect(await run(['init', '--private'], io)).toBe(1);

    expect(io.err).toContain('git rm -r --cached');
    // 沒有型別名前綴 —— 那是 exit 2（內部錯誤）那條路才加的。
    expect(io.err.startsWith('AlreadySharedBoard:')).toBe(false);
    // init 說話的那三行一個字都沒印：它根本沒有建立任何東西。
    expect(io.out).toBe('');
  });

  it('不在 git work tree 內：exit 1，stderr 叫人直接 nook init', async () => {
    const loose = mkdtempSync(join(tmpdir(), 'nook-private-norepo-'));
    dirs.push(loose);
    const io = capture(loose);

    expect(await run(['init', '--private'], io)).toBe(1);

    expect(io.err).toContain('nook init');
    expect(io.err.startsWith('NoGitDir:')).toBe(false);
    expect(io.out).toBe('');
    // 拒絕不留痕跡的那一半，在 CLI 這一層也成立。
    expect(existsSync(join(loose, '.issues'))).toBe(false);
  });
});
