import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
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
  unexcludeBoard,
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
 * `initBoard` 之後的空 `.gitnook/issues/` 是 git 看不見的（git 不追蹤空目錄），
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
  it('建出 board、把 /.gitnook/ 寫進 info/exclude，而 git 看不到任何東西', () => {
    const repo = makeRepo();

    initBoard(repo, { sharing: 'private' });

    expect(existsSync(join(repo, '.gitnook', 'issues'))).toBe(true);
    // private 模式完全不碰 .gitattributes：被 ignore 的 op-log 永遠不會 merge，
    // 那條規則在這裡是「不需要」而不是「缺少」。
    expect(existsSync(join(repo, '.gitattributes'))).toBe(false);
    expect(linesOf(excludeFileOf(repo))).toContain('/.gitnook/');
    // zero committed bytes：這一票的 outcome 就是這兩行。
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'ls-files', '.gitnook')).toBe('');
    // git 自己確認那條規則真的生效。不存在的路徑也答得出來（純 pattern 比對），
    // 所以不必先造一個 op-log 檔。
    expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/01JBXA.ndjson').status).toBe(0);
  });
});

describe('exclude 的寫入是冪等的', () => {
  it('重跑不會把規則寫成第二行，且說得出這次什麼都沒做', () => {
    const repo = makeRepo();
    const file = excludeFileOf(repo);

    initBoard(repo, { sharing: 'private' });
    // 第二次是使用者真的會做的事（忘了自己跑過）。它必須是 no-op 而不是錯誤。
    initBoard(repo, { sharing: 'private' });

    expect(linesOf(file).filter((l) => l === '/.gitnook/')).toHaveLength(1);
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
    expect(readFileSync(file, 'utf8')).toBe('/.gitnook/\n');

    const used = makeRepo();
    // 缺 trailing newline 的既有檔案：直接 append 會生出 `*.log/.gitnook/`，
    // 那條規則兩邊都不生效（ADR-0001 硬規則 1 的同一種 I/O 紀律）。
    writeFileSync(excludeFileOf(used), '*.log', 'utf8');

    expect(excludeBoard(used)).toBe('added');
    expect(linesOf(excludeFileOf(used))).toEqual(['*.log', '/.gitnook/', '']);
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
    for (const written of [' /.gitnook/', '\t/.gitnook/']) {
      const repo = makeRepo();
      initBoard(repo);
      writeFileSync(excludeFileOf(repo), `${written}\n`, 'utf8');

      // 先確認前提：git 真的不 ignore 它（前導空白是 pattern 的一部分）。
      expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/x.ndjson').status).toBe(1);
      expect(inspectSharing(repo)).toBe('shared');
      // 而且補得上去 —— 答 shared 之後還回 unchanged 等於永遠不修。
      expect(excludeBoard(repo)).toBe('added');
      expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/x.ndjson').status).toBe(0);
    }
  });

  it('尾端空白與 CR 是 git 自己就忽略的，所以那仍然是 nook 的那一行', () => {
    for (const written of ['/.gitnook/   ', '/.gitnook/\r']) {
      const repo = makeRepo();
      initBoard(repo);
      writeFileSync(excludeFileOf(repo), `${written}\n`, 'utf8');

      // 前提同上，但這次 git 說它生效 —— 所以答 private 才與 git 一致。
      expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/x.ndjson').status).toBe(0);
      expect(inspectSharing(repo)).toBe('private');
      expect(excludeBoard(repo)).toBe('unchanged');
    }
  });
});

describe('拒絕時不留痕跡', () => {
  /**
   * 排除失敗（這裡是不在 git work tree 內）時若已經 mkdir 過，使用者會得到
   * 一個 **git 看得見的** .gitnook/ —— 與他要的正好相反，而他以為指令失敗了。
   * 那條拒絕的使用者訊息屬於票 02；這一條守的是順序。
   */
  it('不在 git work tree 內時丟錯，且不留下 .gitnook/', () => {
    const loose = mkdtempSync(join(tmpdir(), 'nook-private-norepo-'));
    dirs.push(loose);

    expect(() => initBoard(loose, { sharing: 'private' })).toThrow();
    expect(existsSync(join(loose, '.gitnook'))).toBe(false);
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
    writeFileSync(excludeFileOf(repo), '.gitnook/\n', 'utf8');
    expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/01JBXA.ndjson').status).toBe(0);

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
    const existing = '*.png binary\n.gitnook/issues/*.ndjson merge=ours\n';
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
  it('寫的是 /<相對路徑>/.gitnook/，而且 git 確認那條規則真的生效', () => {
    const repo = makeRepo();
    const nested = join(repo, 'services', 'api');
    mkdirSync(nested, { recursive: true });

    initBoard(nested, { sharing: 'private' });

    // pattern 一律相對於 work tree 頂端 —— info/exclude 是整個 repo 的一份檔案，
    // 寫成 /.gitnook/ 會排除掉頂端那塊（不存在的）board 而放過這一塊。
    expect(linesOf(excludeFileOf(repo))).toContain('/services/api/.gitnook/');
    expect(
      tryGit(repo, 'check-ignore', '-q', 'services/api/.gitnook/issues/01JBXA.ndjson').status,
    ).toBe(0);
    // 錨定的另一半：頂端的同名路徑不該被這條規則掃到。
    expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/01JBXA.ndjson').status).toBe(1);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(inspectSharing(nested)).toBe('private');
  });
});

/**
 * board 的相對路徑是一條**字面路徑**，而 `info/exclude` 收的是 gitignore 的
 * **pattern 語言**。目錄名裡的 metacharacter 不轉義，寫出去的就是一條**別的**
 * 規則：`/apps/[id]/.gitnook/`（Next.js 動態路由那種目錄名）不比對
 * `apps/[id]/` —— `[id]` 是一個字元類別 —— 卻會比對 `apps/i/`。實測
 * （git 2.50.1）那個狀態下 `git status` 看得到整塊 board，而 nook 三個面都沉默。
 *
 * 期望的形狀不是這一層發明的：`git check-ignore -v` 自己回寫的就是
 * `/apps/\[id\]/.gitnook/`。
 */
describe('board 路徑含 gitignore metacharacter', () => {
  /** [board 的目錄名, 該寫出去的那一行, 未轉義的規則會誤中的鄰居] */
  const shapes: ReadonlyArray<readonly [string, string, string]> = [
    ['a[bc]d', '/a\\[bc\\]d/.gitnook/', 'abd'],
    ['a*b', '/a\\*b/.gitnook/', 'aXb'],
    ['q?z', '/q\\?z/.gitnook/', 'qAz'],
    ['back\\slash', '/back\\\\slash/.gitnook/', 'backslash'],
  ];

  it('寫出去的是轉義過的字面路徑，git 只咬得到那一個目錄', () => {
    for (const [name, rule, decoy] of shapes) {
      const repo = makeRepo();
      const board = join(repo, name);
      mkdirSync(board, { recursive: true });
      // 鄰居只建目錄、不放檔案：git 看不見空目錄，所以下面 status 那條斷言
      // 量的仍然只有 board 自己。
      mkdirSync(join(repo, decoy), { recursive: true });

      initBoard(board, { sharing: 'private' });

      expect(linesOf(excludeFileOf(repo))).toContain(rule);
      // 基準一律是真實的 git：規則真的咬得到這塊 board。
      expect(tryGit(repo, 'check-ignore', '-q', `${name}/.gitnook/issues/x.ndjson`).status).toBe(0);
      // 而且只咬得到它 —— 未轉義的那一行會誤中這個鄰居，那才是 pattern 而不是路徑。
      expect(tryGit(repo, 'check-ignore', '-q', `${decoy}/.gitnook/issues/x.ndjson`).status).toBe(1);
      // zero committed bytes 在這種目錄名上同樣成立。
      expect(git(repo, 'status', '--porcelain')).toBe('');
    }
  });
});

/**
 * 尾端空白是 gitignore 唯一一種會**改寫我們寫出去的那一行**的規則（git 會吃掉
 * 未轉義的尾端空白），而票 01 釘住的不變式就是：**寫出去的與讀回來的必須是
 * 同一條規則**。所以路徑裡帶尾端空白的那一段一律轉義，不讓那條規則有機會
 * 咬到 nook 自己的行 —— 這一行今天以 `.gitnook/` 結尾，那個「今天」不是契約。
 */
describe('board 路徑含尾端空白', () => {
  it('那一段的尾端空白也轉義，而且三個問法認的仍是同一行', () => {
    const repo = makeRepo();
    const board = join(repo, 'trail ');
    mkdirSync(board);

    initBoard(board, { sharing: 'private' });

    expect(linesOf(excludeFileOf(repo))).toContain('/trail\\ /.gitnook/');
    // 基準是真實的 git：轉義過的那一行照樣咬得到這塊 board。
    expect(tryGit(repo, 'check-ignore', '-q', 'trail /.gitnook/issues/x.ndjson').status).toBe(0);
    expect(git(repo, 'status', '--porcelain')).toBe('');

    // 寫什麼就認什麼 —— 認得它、補不重複、也移得掉。
    expect(inspectSharing(board)).toBe('private');
    expect(excludeBoard(board)).toBe('unchanged');
    expect(unexcludeBoard(board)).toBe('removed');
    expect(tryGit(repo, 'check-ignore', '-q', 'trail /.gitnook/issues/x.ndjson').status).toBe(1);
    expect(inspectSharing(board)).toBe('shared');
  });
});

/**
 * `#`（註解）與 `!`（否定）只在**行首**有特殊意義，而 nook 寫的這一行永遠以 `/`
 * 開頭 —— 所以推論上不必轉義。**推論要由真實的 git 確認**，不靠我們對 gitignore
 * 的記憶：多轉義一個字元是有代價的（寫出去的與 `matchesExcludeRule` 讀回來的
 * 多一次錯開的機會），所以這裡要的是「確實不必」而不是「轉了比較安心」。
 */
describe('board 路徑以 # 或 ! 開頭的那一段', () => {
  it('不轉義，而 git 確認那一行照樣生效', () => {
    for (const [name, rule] of [
      ['#hash', '/#hash/.gitnook/'],
      ['!bang', '/!bang/.gitnook/'],
    ] as const) {
      const repo = makeRepo();
      const board = join(repo, name);
      mkdirSync(board);

      initBoard(board, { sharing: 'private' });

      expect(linesOf(excludeFileOf(repo))).toContain(rule);
      // git 自己說了：`#` 沒被讀成註解、`!` 沒被讀成否定 —— 行首是那個 `/`。
      expect(tryGit(repo, 'check-ignore', '-q', `${name}/.gitnook/issues/x.ndjson`).status).toBe(0);
      expect(git(repo, 'status', '--porcelain')).toBe('');
      expect(inspectSharing(board)).toBe('private');
    }
  });
});

/**
 * 轉換期：一塊在轉義**之前**就被 `init --private` 過的 board，`info/exclude` 裡
 * 是未轉義的那一行。`matchesExcludeRule` 是整行比對，所以 nook 從此認不得它 ——
 * 而這是**保守的**失敗，不是新的靜默失敗：答 shared 就是照舊警告、照舊回報，
 * doctor 也不沉默，而 `nook init --private` 補得上一條真的生效的規則。
 */
describe('轉義之前就寫下的那一行（轉換期）', () => {
  it('認不得那一行：答 shared、doctor 不沉默，init --private 修得回來', () => {
    const repo = makeRepo();
    const board = join(repo, 'apps', '[id]');
    mkdirSync(board, { recursive: true });
    initBoard(board, { sharing: 'private' });
    openBoard({ dir: board, actor: 'aaaa' }).create({ title: 'Fix login redirect' });
    // 舊版寫出去的形狀：一模一樣的路徑，只是沒有轉義。
    writeFileSync(excludeFileOf(repo), '/apps/[id]/.gitnook/\n', 'utf8');

    // 這一批的起點，由真實 git 確認：那條規則對這塊 board 沒有效果，board 整塊
    // 在 git 眼前 —— 下一次 git add -A 就把它推出去。
    expect(tryGit(repo, 'check-ignore', '-q', 'apps/[id]/.gitnook/issues/x.ndjson').status).toBe(1);
    expect(git(repo, 'status', '--porcelain')).toContain('apps/');

    // 認不得 → 答 shared。保守的失敗：list / show 照舊警告。
    expect(inspectSharing(board)).toBe('shared');
    // 而且有人說話：doctor 在這塊 board 上不沉默。
    expect(diagnose(board).map((d) => d.kind)).toContain('MissingMergeDriver');

    // 下一步修得回來：init --private 補上一條轉義過的規則。
    initBoard(board, { sharing: 'private' });

    expect(linesOf(excludeFileOf(repo))).toContain('/apps/\\[id\\]/.gitnook/');
    expect(tryGit(repo, 'check-ignore', '-q', 'apps/[id]/.gitnook/issues/x.ndjson').status).toBe(0);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(inspectSharing(board)).toBe('private');
    expect(diagnose(board)).toEqual([]);
    // 舊那一行留在檔案裡：`info/exclude` 是使用者的檔案，nook 只認也只動自己
    // 寫的那一行（同 unexcludeBoard 的紀律）。
    expect(linesOf(excludeFileOf(repo))).toContain('/apps/[id]/.gitnook/');
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
    expect(linesOf(excludeFileOf(linked))).toContain('/.gitnook/');
    expect(tryGit(linked, 'check-ignore', '-q', '.gitnook/issues/01JBXA.ndjson').status).toBe(0);
    expect(git(linked, 'status', '--porcelain')).toBe('');
    expect(inspectSharing(linked)).toBe('private');

    // 代價三：ignore 規則是共用的，untracked 的檔案不是 —— 每個 worktree 各有
    // 一塊空 board。這裡把那個事實釘住，README 要講的就是它。
    expect(existsSync(join(main, '.gitnook'))).toBe(false);
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
    expect(git(shared, 'ls-files', '.gitnook')).not.toBe('');

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
    expect(git(repo, 'ls-files', '.gitnook')).not.toBe('');

    const error = caught(() => initBoard(repo, { sharing: 'private' }));

    expect(error).toBeInstanceOf(AlreadySharedBoard);
    // 指令帶完整路徑：board 不在 repo 根目錄時，一條相對指令會在錯的目錄下
    // 執行，而 git 只會說 pathspec 沒命中 —— 貼得上去才算講出解法。
    expect((error as Error).message).toContain(`git rm -r --cached "${repo}/.gitnook"`);
    // 「你自己跑」這件事必須寫在訊息裡，否則使用者會等 nook 動手。
    expect((error as Error).message).toContain('yourself');
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

describe('共享狀態問的是 op-log，不是整個 .gitnook/', () => {
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
    writeFileSync(join(repo, '.gitnook', '.gitkeep'), '', 'utf8');
    // -f 是必要的：整個 .gitnook/ 已經被排除了。
    git(repo, 'add', '-f', '.gitnook/.gitkeep');
    git(repo, 'commit', '-qm', 'keep the dir');

    // 前提一：git 確實追蹤著 .gitnook/ 底下的某個東西（寬的問法會答 true）。
    expect(git(repo, 'ls-files', '.gitnook')).not.toBe('');
    // 前提二：op-log 本身仍然沒有被追蹤，而且仍然被 ignore。
    expect(git(repo, 'ls-files', '.gitnook/issues')).toBe('');

    expect(opLogsTracked(repo)).toBe(false);
    expect(inspectSharing(repo)).toBe('private');
    expect(diagnose(repo)).toEqual([]);
  });
});

describe('拒絕時一個目錄都不建', () => {
  /**
   * 「什麼都沒寫」的另一半：git 看不見空目錄，所以只比對 info/exclude 與
   * `git status` 的話，把 mkdir 搬到拒絕之前不會讓任何測試變紅。這個情境
   * （index 裡有 .gitnook，工作目錄那一份被 rm -rf 掉了）讓那一半也有斷言。
   */
  it('op-log 在 index 裡、工作目錄卻沒有那個目錄時，拒絕不會順手把它建回來', () => {
    const repo = makeSharedBoard();
    rmSync(join(repo, '.gitnook'), { recursive: true, force: true });
    const before = readFileSync(excludeFileOf(repo), 'utf8');

    expect(caught(() => initBoard(repo, { sharing: 'private' }))).toBeInstanceOf(
      AlreadySharedBoard,
    );

    expect(existsSync(join(repo, '.gitnook'))).toBe(false);
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
    expect(existsSync(join(loose, '.gitnook'))).toBe(false);
  });
});

describe('unexcludeBoard —— 只拿掉 nook 寫的那一行', () => {
  /**
   * `share` 的寫入側。規則必須**只**移除那一行：`info/exclude` 是使用者自己的
   * 檔案，nook 在 `init --private` 時只借了一行，升級時就只還那一行 —— 把檔案
   * 清空或刪掉會順手丟掉他排除 build 產物的設定，而那與共享這塊 board 無關。
   */
  it('移除那一行、其餘內容與順序不動，檔案留在原地，git 也不再 ignore', () => {
    const repo = makeRepo();
    const file = excludeFileOf(repo);
    // 使用者自己的規則前後各一條，nook 的那一行夾在中間 —— 順序被動過才看得出來。
    writeFileSync(file, '*.log\n', 'utf8');
    initBoard(repo, { sharing: 'private' });
    appendFileSync(file, 'build/\n', 'utf8');
    expect(linesOf(file)).toEqual(['*.log', '/.gitnook/', 'build/', '']);
    // 前提：git 真的在 ignore 這塊 board。
    expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/01JBXA.ndjson').status).toBe(0);

    expect(unexcludeBoard(repo)).toBe('removed');

    expect(linesOf(file)).toEqual(['*.log', 'build/', '']);
    // 檔案本身留著 —— 它不是 nook 的檔案。
    expect(existsSync(file)).toBe(true);
    // 基準是真實的 git，不是我們對 gitignore 的記憶：規則真的失效了。
    expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/01JBXA.ndjson').status).toBe(1);
    expect(inspectSharing(repo)).toBe('shared');
  });

  it('那一行本來就不在時是 unchanged，一個 byte 都不動', () => {
    const repo = makeRepo();
    const file = excludeFileOf(repo);
    writeFileSync(file, '*.log\n', 'utf8');

    expect(unexcludeBoard(repo)).toBe('unchanged');
    expect(readFileSync(file, 'utf8')).toBe('*.log\n');
  });
});

describe('移除時認的是 hasLine 的同一個判斷', () => {
  /**
   * 左右不對稱的那一面在移除這一側同樣成立，而且**兩個方向必須是同一個判斷**。
   * 各寫一套比對會長出兩種不一致的失敗：
   *
   * - 移除端比得寬（`trim()`）：連使用者自己寫的 ` /.gitnook/` 一起刪掉 —— 那是
   *   git 不承認的規則，也就不是 nook 的那一行，nook 沒有權限動它。
   * - 移除端比得窄（整行相等）：`/.gitnook/   ` 留在檔案裡，而 git **仍然承認它**
   *   —— `share` 報告成功、board 卻還被 ignore，而 `inspectSharing` 也照樣回答
   *   private。那是這一批最不想要的那種靜默失敗。
   *
   * 基準一律是真實的 git check-ignore。
   */
  it('尾端空白與 CR 的那一行要拿掉 —— git 承認它，所以它就是 nook 的那一行', () => {
    for (const written of ['/.gitnook/   ', '/.gitnook/\r']) {
      const repo = makeRepo();
      initBoard(repo);
      writeFileSync(excludeFileOf(repo), `${written}\n`, 'utf8');
      // 前提：git 說這條規則生效，所以這塊 board 真的是 private。
      expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/x.ndjson').status).toBe(0);
      expect(inspectSharing(repo)).toBe('private');

      expect(unexcludeBoard(repo)).toBe('removed');

      expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues/x.ndjson').status).toBe(1);
      expect(inspectSharing(repo)).toBe('shared');
    }
  });

  it('前導空白的那一行不准碰 —— git 不承認它，它是使用者自己的內容', () => {
    for (const written of [' /.gitnook/', '\t/.gitnook/']) {
      const repo = makeRepo();
      initBoard(repo);
      writeFileSync(excludeFileOf(repo), `${written}\n`, 'utf8');

      expect(unexcludeBoard(repo)).toBe('unchanged');
      expect(readFileSync(excludeFileOf(repo), 'utf8')).toBe(`${written}\n`);
    }
  });

  /**
   * pattern 錨定的另一半（同 `excludeBoard` 那一條）：`info/exclude` 是整個 repo
   * 共用的一份檔案，所以 share 一塊 `/services/api/.gitnook/` 的 board 不得順手
   * 解除頂端那一塊 —— 那會把另一塊 private board 無聲地交給 git。
   */
  it('board 不在 repo 根目錄時，只拿掉它自己那一行', () => {
    const repo = makeRepo();
    const nested = join(repo, 'services', 'api');
    mkdirSync(nested, { recursive: true });
    // git 自己的樣板註解不是契約的一部分，清掉才逐行比對得起來（同上面那一條）。
    writeFileSync(excludeFileOf(repo), '', 'utf8');
    initBoard(nested, { sharing: 'private' });
    // 頂端那一塊 board 的規則（一塊 board 不能開在另一塊底下，所以只寫規則）——
    // info/exclude 是整個 repo 共用的一份檔案，兩條規則本來就會並存。
    excludeBoard(repo);
    expect(linesOf(excludeFileOf(repo))).toEqual(['/services/api/.gitnook/', '/.gitnook/', '']);

    expect(unexcludeBoard(nested)).toBe('removed');

    expect(linesOf(excludeFileOf(repo))).toEqual(['/.gitnook/', '']);
    expect(inspectSharing(nested)).toBe('shared');
    // 頂端那一塊還是 private —— 它不是這次 share 的對象。
    expect(inspectSharing(repo)).toBe('private');
  });
});

describe('share 之後 git 仍然 ignore 那些檔案時', () => {
  /**
   * 移除 nook 自己那一行之後，git **仍然**可能在 ignore 這塊 board —— 例如
   * committed 的 `.gitignore` 也有一條。那時 `git add` 會被拒絕，所以報告成功
   * 等於騙人：使用者會以為升級完成了，而同事的 clone 仍然是空的。
   *
   * 說得出是哪個檔案第幾行在擋，靠的是 `ignoredByGit` 帶回來的 git 原文
   * （`<file>:<line>:<pattern>`）—— 那個行號是上層編不出來的東西。
   */
  it('exit 1，說出是哪個檔案第幾行在擋，而且不印那條會失敗的 git add', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, '.gitignore'), '# project junk\n.gitnook/\n', 'utf8');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-qm', 'ignore the nook board');
    initBoard(repo, { sharing: 'private' });
    openBoard({ dir: repo, actor: 'aaaa' }).create({ title: 'Fix login redirect' });
    const io = capture(repo);

    expect(await run(['issue', 'share'], io)).toBe(1);

    // nook 那一行真的被拿掉了（它做完了自己那一半），但 git 還是說 ignore ——
    // 擋路的是 .gitignore 第 2 行，而那是使用者自己的檔案，nook 不改它。
    expect(linesOf(excludeFileOf(repo))).not.toContain('/.gitnook/');
    expect(tryGit(repo, 'check-ignore', '-q', '.gitnook/issues').status).toBe(0);
    expect(io.err).toContain('.gitignore:2:.gitnook/');
    // 不假裝成功：那條 git add 會被 git 拒絕，印出來就是叫使用者去撞牆。
    expect(io.out).not.toContain('git add');
    // **也不得先承諾再收回。** stdout 那一行不能說「從現在起會進 git」，因為
    // 下一行 stderr 正要說 git 還在擋 —— 先承諾再收回比直接說不行更糟。
    expect(io.out).not.toContain('will enter git from now on');
  });
});

describe('不在 git work tree 內時，unexcludeBoard 不是錯誤', () => {
  /**
   * 與 `excludeBoard` 刻意不對稱：那個丟 `NoGitDir`，因為它**要寫**，沒有
   * `$GIT_DIR` 就無處可寫。這裡沒有任何規則在排除什麼，board 本來就是 shared
   * （`inspectSharing` 也這麼答），所以「什麼都不用動」是事實，不是一個使用者
   * 要修的錯誤 —— 否則 `nook share` 會在 git repo 外的 board 上無故 exit 1。
   */
  it('回 unchanged 而不是丟 NoGitDir', () => {
    const loose = mkdtempSync(join(tmpdir(), 'nook-private-norepo-'));
    dirs.push(loose);
    initBoard(loose);

    expect(inspectSharing(loose)).toBe('shared');
    expect(unexcludeBoard(loose)).toBe('unchanged');
    // 對照：同一個目錄上 excludeBoard 確實丟 NoGitDir，所以上面那個不是因為
    // 這個目錄剛好有個 $GIT_DIR。
    expect(caught(() => excludeBoard(loose))).toBeInstanceOf(NoGitDir);
  });
});
