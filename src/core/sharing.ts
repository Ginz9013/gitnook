import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * 一塊 Board 的 op-log 是否交給 git 追蹤。
 *
 * - `shared`：預設。op-log 被 commit，`merge=union` 是它的零衝突保證。
 * - `private`：op-log 被 `$GIT_DIR/info/exclude` 排除，只存在於這一個工作目錄。
 *
 * **Sharing 是推導出來的，不是儲存的** —— 沒有 config 檔、沒有 marker 檔
 * （ADR-0002：`.issues/` 底下零本機狀態）。
 */
export type Sharing = 'shared' | 'private';

/** 這次寫入實際動了什麼。消費者見 `excludeBoard` 的註解。 */
export type ExcludeOutcome = 'created' | 'added' | 'unchanged';

/**
 * 這塊 board 的 op-log 已經被 git 追蹤 —— 它已經共享出去了，所以 `init --private`
 * 拒絕而不是照寫一條沒有效果的規則（為什麼沒有效果，見 `opLogsTracked`）。
 *
 * 訊息講出解法，但**不執行它**：`git rm -r --cached` 會從同事的 clone 裡刪掉這塊
 * board，那是破壞性的，由使用者自己決定並自己執行（spec.md 的 non-goal
 * `nook unshare`）。nook 從不跑任何會寫入的 git 指令。
 */
export class AlreadySharedBoard extends Error {
  constructor(readonly dir: string) {
    super(
      `${dir} 的 op-log 已經被 git 追蹤：這塊 board 已經共享出去了。\n` +
        `被追蹤的路徑勝過 ignore 規則（git check-ignore 會查 index），` +
        `所以寫一條排除規則不會有任何效果 —— 它只會讓你以為成功了。\n` +
        `要降級成 private，請自己執行 git rm -r --cached .issues 並 commit；` +
        `那會從同事的 clone 裡刪掉這塊 board，所以 nook 不替你跑任何會寫入的 git 指令。`,
    );
    this.name = 'AlreadySharedBoard';
  }
}

/**
 * 這個目錄不在任何 git work tree 內，所以沒有 `$GIT_DIR/info/exclude` 可寫。
 *
 * private mode 整個建立在那個檔案上：**沒有 git 就沒有共享可言，也就沒有 private
 * 可言**。所以訊息不繞路叫他先 `git init`，而是直接叫他 `nook init` —— 他要的
 * 「一塊 board」在這裡本來就不需要 `--private`，而 board 在 `git init` 之前也
 * 照樣能用。
 */
export class NoGitDir extends Error {
  constructor(readonly dir: string) {
    super(
      `${dir} 不在任何 git work tree 內：private mode 靠 $GIT_DIR/info/exclude ` +
        `把 board 藏起來，沒有 git 就沒有東西需要藏。\n` +
        `這裡直接跑 nook init 就有一塊可用的 board。`,
    );
    this.name = 'NoGitDir';
  }
}

/**
 * nook 自己寫進 `info/exclude` 的那一行，`/<board 相對於 work tree 頂端的路徑>/.issues/`。
 * board 在 repo 根目錄時就是 `/.issues/`。
 *
 * 排除的是整個 `.issues/` 而不只是 op-log：private board 的**權威資料本身**
 * 不進 git，所以索引、附帶檔案、日後新增的任何東西都一併在外。
 */
function boardPattern(top: string, root: string): string {
  const rel = relative(top, resolve(root));
  // Windows 的 path.relative 給的是反斜線，而 gitignore 的 pattern 只認 `/`。
  const prefix = rel === '' ? '' : `${rel.split(sep).join('/')}/`;
  return `/${prefix}.issues/`;
}

/**
 * 一塊 board 所在的 git 版面。
 *
 * `top` 是 work tree 頂端（由 fs 向上找 `.git`，同 `findBoardRoot` 的走法），
 * `commonDir` 是**共用的** `$GIT_DIR` —— `info/exclude` 住在那裡。
 */
interface GitLayout {
  readonly top: string;
  readonly commonDir: string;
}

/**
 * 純 fs 解出版面，不 spawn 任何子行程（`inspectSharing` 是讀取熱路徑）。
 *
 * `.git` 有三種形狀：普通 repo 的目錄、linked worktree 與 submodule 的**檔案**
 * （內容 `gitdir: <path>`）。而 linked worktree 的那個 gitdir 自己還有一個
 * `commondir` 檔才指得到共用的 `info/exclude` —— 少讀這一層，規則會被寫進
 * 只有那個 worktree 看得到的地方。實測基準：`git rev-parse --git-path
 * info/exclude` 在 worktree 內回傳的就是 common dir 的路徑。
 */
function gitLayout(root: string): GitLayout | null {
  let here = resolve(root);
  for (;;) {
    const dotGit = join(here, '.git');
    if (existsSync(dotGit)) {
      const gitDir = resolveGitDir(here, dotGit);
      return gitDir === null ? null : { top: here, commonDir: commonDirOf(gitDir) };
    }
    const parent = dirname(here);
    if (parent === here) return null;
    here = parent;
  }
}

function resolveGitDir(top: string, dotGit: string): string | null {
  if (statSync(dotGit).isDirectory()) return dotGit;
  const content = readFileSync(dotGit, 'utf8').trim();
  const marker = 'gitdir:';
  if (!content.startsWith(marker)) return null;
  // `git worktree add` 預設寫絕對路徑，`--relative-paths` 則寫相對於 work tree 頂端。
  return resolve(top, content.slice(marker.length).trim());
}

function commonDirOf(gitDir: string): string {
  const pointer = join(gitDir, 'commondir');
  if (!existsSync(pointer)) return gitDir;
  return resolve(gitDir, readFileSync(pointer, 'utf8').trim());
}

const excludeFileOf = (layout: GitLayout): string => join(layout.commonDir, 'info', 'exclude');

/**
 * 那一行在不在。**整行字串比對**，刻意不實作 gitignore 的 pattern 與優先序
 * 規則（目錄排除、否定、後行覆蓋前行）—— 那套規則只有 git 自己說得準，而讀取
 * 熱路徑不能 spawn git。手寫成別的形狀的 ignore 規則因此不算 private：那是
 * 保守的失敗（照舊警告、照舊回報），不是靜默的失敗。
 *
 * **右側照 git 的規則收，左側一個字元都不收。** 實測（git 2.x）：`/.issues/   `
 * 與 `/.issues/\r` 照樣生效（尾端空白與 CR 被 git 忽略），而 ` /.issues/` 與
 * `\t/.issues/` **不生效** —— 前導空白是 pattern 的一部分。拿 trim() 比對會把
 * 後兩種當成 nook 的那一行：`inspectSharing` 回答 private，`excludeBoard` 回答
 * unchanged，於是使用者永遠等不到一條生效的規則，而 list / show 還順手停止
 * 警告。那正是這個不變式要避開的靜默失敗，所以左側必須逐字比。
 *
 * 尾端只收空白與 CR，不收 tab：git 的文件只承諾忽略尾端空白，少收一種的
 * 代價是答 shared（保守），多收一種的代價是上面那種靜默失敗。
 */
const hasLine = (content: string, pattern: string): boolean =>
  content.split('\n').some((line) => line.replace(/ *\r?$/, '') === pattern);

/**
 * 這塊 board 是 shared 還是 private。**純 fs，不 spawn 任何子行程** ——
 * 這是讀取熱路徑（list / show 每一次都問）唯一的問法。
 *
 * **private 是被測的那一側，其餘一律算 shared**：不在 git work tree 內、沒有
 * `info/exclude`、那一行不在、或規則被手寫成別的形狀，都回答 shared。剛 init
 * 還沒 commit 的 board 也是 shared —— 它的意圖是共享，只是還沒送出去。這讓
 * 讀取熱路徑只需要回答一個是非題。
 */
export function inspectSharing(root: string): Sharing {
  const layout = gitLayout(root);
  if (layout === null) return 'shared';
  const file = excludeFileOf(layout);
  if (!existsSync(file)) return 'shared';
  return hasLine(readFileSync(file, 'utf8'), boardPattern(layout.top, root)) ? 'private' : 'shared';
}

/**
 * 冪等地把 board 排除在 git 之外。
 *
 * 回傳值說的是這次**實際動了什麼**。`init --private` 刻意不把 created 與 added
 * 分開印：`.gitattributes` 要分是因為那是使用者**自己 commit 的檔案**，他得知道
 * 自己接下來要 commit 的是一個全新檔案還是被加了一行；`info/exclude` 從不進
 * git，這個差別對他的下一步沒有任何影響。三分值仍然在介面上，因為 `share`
 * （票 06）要靠它講出「這次把規則拿掉了」還是「本來就不在」。
 */
export function excludeBoard(root: string): ExcludeOutcome {
  const layout = gitLayout(root);
  // 不在 git work tree 內就沒有 info/exclude 可寫。**排在任何寫入之前** ——
  // 反過來的話，呼叫端會留下一個 git 看得見的 .issues/（見 `initBoard`）。
  if (layout === null) throw new NoGitDir(resolve(root));

  const pattern = boardPattern(layout.top, root);
  const file = excludeFileOf(layout);

  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${pattern}\n`, 'utf8');
    return 'created';
  }

  const existing = readFileSync(file, 'utf8');
  if (hasLine(existing, pattern)) return 'unchanged';

  // 既有檔案缺 trailing newline 時，直接 append 會把規則黏在使用者的最後一行上。
  const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(file, `${lead}${pattern}\n`, 'utf8');
  return 'added';
}

/**
 * op-log 是否已經躺在 git 的 index 裡 —— 也就是這塊 board 是不是真的已經共享出去了。
 *
 * **會 spawn `git ls-files`**，所以只准 init / doctor / share 呼叫，**絕不得進入
 * list / show 這些讀取熱路徑**（那裡唯一的問法是純 fs 的 `inspectSharing`，而
 * `run.ts` 的 `boardDir` 與 `warnIfUnguarded` 把「list 不 spawn git」當承諾在守）。
 *
 * 為什麼 index 才是權威、而不是 `info/exclude` 裡那一行：**tracked 勝過 ignore
 * 規則**。實測（git 2.x）：已被追蹤的路徑 `git check-ignore` 預設回報 not
 * ignored —— 它會查 index。所以在一塊已共享的 board 上照寫 exclude 規則是一個
 * 完全沒有效果的動作，而使用者會以為成功了。那是靜默失敗，所以 init 寧可拒絕
 * （`AlreadySharedBoard`）。
 *
 * 問的是整個 `.issues/` 而不只 `.issues/issues/*.ndjson`：exclude 規則排除的是
 * 整個目錄，使用者要跑的解法（`git rm -r --cached .issues`）也是整個目錄。問得
 * 窄一點，一塊「git 還追蹤著 `.issues/` 底下某個東西」的 board 就會靜默通過，
 * 而那正是要避開的那種失敗。
 *
 * 不在 git work tree 內（git 自己以非 0 結束）時回 false：這個函式只回答一個是非
 * 題，而「沒有 repo」不是「有東西被追蹤」。那條拒絕是呼叫端的事，見 `NoGitDir`。
 */
export function opLogsTracked(root: string): boolean {
  try {
    // 路徑相對於 cwd，所以問到的只會是這一塊 board —— 不是上層那一塊。
    const out = execFileSync('git', ['ls-files', '--', '.issues'], {
      cwd: resolve(root),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() !== '';
  } catch {
    return false;
  }
}
