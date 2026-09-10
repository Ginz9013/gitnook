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
  // 不在 git work tree 內就沒有 info/exclude 可寫。這條拒絕的使用者訊息
  // （以及它該是 exit 1 而不是 exit 2）屬於下一張票，這裡先不假裝處理得好。
  if (layout === null) throw new Error(`${resolve(root)} 不在任何 git work tree 內`);

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
