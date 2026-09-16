import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * 一塊 Board 的 op-log 是否交給 git 追蹤。
 *
 * - `shared`：預設。op-log 被 commit，`merge=union` 是它的零衝突保證。
 * - `private`：op-log 被 `$GIT_DIR/info/exclude` 排除，只存在於這一個工作目錄。
 *
 * **Sharing 是推導出來的，不是儲存的** —— 沒有 config 檔、沒有 marker 檔
 * （ADR-0002：`.gitnook/` 底下零本機狀態）。
 */
export type Sharing = 'shared' | 'private';

/** 這次寫入實際動了什麼。消費者見 `excludeBoard` 的註解。 */
export type ExcludeOutcome = 'created' | 'added' | 'unchanged';

/** 這次移除實際動了什麼。消費者見 `unexcludeBoard` 的註解。 */
export type UnexcludeOutcome = 'removed' | 'unchanged';

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
      `${dir}'s op-log is already tracked by git: this board is already shared.\n` +
        `A tracked path beats an ignore rule (git check-ignore checks the index), ` +
        `so writing an exclude rule would have no effect — it would only make you think it worked.\n` +
        // 指令帶上完整路徑而不是相對的 `.gitnook`：board 可能不在 repo 根目錄
        // （`/services/api/.gitnook/` 是支援且被測試的形狀），那時貼上一條相對
        // 指令的人會在錯的目錄下執行它，而 git 只會說 pathspec 沒命中。
        `To downgrade to private, run git rm -r --cached "${dir}/.gitnook" and commit it yourself; ` +
        `that would delete this board from your colleagues' clones, so nook runs no git command that writes.`,
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
      `${dir} is not inside any git work tree: private mode relies on $GIT_DIR/info/exclude ` +
        `to hide the board, and without git there is nothing to hide.\n` +
        `Run nook init here directly to get a usable board.`,
    );
    this.name = 'NoGitDir';
  }
}

/**
 * Issue op-log 那個目錄，作為 git pathspec（一律 `/`，不吃平台的分隔符號）。
 * 「這塊 board 共享了嗎」問的就是這裡有沒有東西進 index。
 */
export const OP_LOG_DIR = '.gitnook/issues';

/**
 * Decision op-log 那個目錄 —— `OP_LOG_DIR` 的 Decision 版，兩者各自窄探測後
 * OR 起來（見 `opLogsTracked`/`ignoredByGit`）。不 export：呼叫端只問得到
 * `.gitnook/` 整體共享與否，不需要知道底下拆成兩個模組。
 */
const DECISION_LOG_DIR = '.gitnook/decisions';

/**
 * `.gitnook/` 容器目錄本身，作為 git pathspec。**不帶尾斜線** —— 否定規則是在
 * 目錄那一層生效的，而 `git check-ignore` 對 `.gitnook/` 這種帶斜線的問法答
 * 不出東西（見 `overridingRule` 的實測）。
 */
const GITNOOK_DIR = '.gitnook';

/** op-log 的副檔名。`health.ts` 也在掃同一批檔案，兩邊認的必須是同一件事。 */
const LOG_SUFFIX = '.ndjson';

/**
 * nook 自己寫進 `info/exclude` 的那一行，`/<board 相對於 work tree 頂端的路徑>/.gitnook/`。
 * board 在 repo 根目錄時就是 `/.gitnook/`。
 *
 * 排除的是整個 `.gitnook/` 而不只是 op-log：private board 的**權威資料本身**
 * 不進 git，所以索引、附帶檔案（issues 與 decisions 兩個模組）、日後新增的任何
 * 東西都一併在外 —— 一條規則涵蓋兩個模組。
 */
function boardPattern(top: string, root: string): string {
  const rel = relative(top, resolve(root));
  // Windows 的 path.relative 給的是反斜線，而 gitignore 的 pattern 只認 `/`。
  const prefix = rel === '' ? '' : `${rel.split(sep).map(escapeSegment).join('/')}/`;
  return `/${prefix}.gitnook/`;
}

/**
 * 一段目錄名，轉義成只比對**它自己**的 gitignore pattern。
 *
 * board 的路徑是一條**字面路徑**，而 `info/exclude` 收的是 pattern 語言 ——
 * 不轉義寫出去的就是一條別的規則。實測（git 2.50.1，`apps/[id]/` 是 Next.js
 * 動態路由那種目錄名）：`/apps/[id]/.gitnook/` **不**比對 `apps/[id]/`（`[id]`
 * 是一個字元類別），卻會比對 `apps/i/`。那個狀態下 board 整塊進得了 git，而
 * 使用者剛剛才被告知它是 private 的。
 *
 * 轉義的形狀不是這一層發明的：`git check-ignore -v` 自己回寫的就是
 * `/apps/\[id\]/.gitnook/`。
 *
 * **`#` 與 `!` 不在這一組裡**：那兩個字元只在**行首**有特殊意義，而這一行永遠
 * 以 `/` 開頭。實測確認過推論（`/#hash/.gitnook/` 命中），所以不多轉義一個字元
 * —— 每多轉一個，寫出去的與 `matchesExcludeRule` 讀回來的就多一次錯開的機會。
 *
 * **尾端空白另外處理**：它不是 pattern 的 metacharacter，而是 gitignore 唯一一種
 * 會**改寫我們寫出去的那一行**的規則（未轉義的尾端空白被 git 吃掉）。票 01 的
 * 不變式是「寫出去的與讀回來的必須是同一條規則」，所以帶尾端空白的那一段一律
 * 轉義 —— 今天這一行以 `.gitnook/` 結尾、那條規則咬不到它，但那個「今天」不是契約。
 */
const escapeSegment = (segment: string): string =>
  segment.replace(/[\\*?[\]]/g, '\\$&').replace(/ (?= *$)/g, '\\ ');

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
 * 這一行**就是** nook 寫的那一行嗎 —— 兩個方向（認得它、移除它）共用的唯一判斷。
 *
 * **整行字串比對**，刻意不實作 gitignore 的 pattern 與優先序
 * 規則（目錄排除、否定、後行覆蓋前行）—— 那套規則只有 git 自己說得準，而讀取
 * 熱路徑不能 spawn git。手寫成別的形狀的 ignore 規則因此不算 private：那是
 * 保守的失敗（照舊警告、照舊回報），不是靜默的失敗。
 *
 * **右側照 git 的規則收，左側一個字元都不收。** 實測（git 2.x）：`/.gitnook/   `
 * 與 `/.gitnook/\r` 照樣生效（尾端空白與 CR 被 git 忽略），而 ` /.gitnook/` 與
 * `\t/.gitnook/` **不生效** —— 前導空白是 pattern 的一部分。拿 trim() 比對會把
 * 後兩種當成 nook 的那一行：`inspectSharing` 回答 private，`excludeBoard` 回答
 * unchanged，於是使用者永遠等不到一條生效的規則，而 list / show 還順手停止
 * 警告。那正是這個不變式要避開的靜默失敗，所以左側必須逐字比。
 *
 * 尾端只收空白與 CR，不收 tab：git 的文件只承諾忽略尾端空白，少收一種的
 * 代價是答 shared（保守），多收一種的代價是上面那種靜默失敗。
 */
const matchesExcludeRule = (line: string, pattern: string): boolean =>
  line.replace(/ *\r?$/, '') === pattern;

/** 那一行在不在（`inspectSharing` 與 `excludeBoard` 的問法）。 */
const hasLine = (content: string, pattern: string): boolean =>
  content.split('\n').some((line) => matchesExcludeRule(line, pattern));

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
  // 反過來的話，呼叫端會留下一個 git 看得見的 .gitnook/（見 `initBoard`）。
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
 * 把 board 交回給 git —— `share` 的寫入側，`excludeBoard` 的反向。
 *
 * **只移除 nook 自己寫的那一行**，其餘內容與順序一個 byte 都不動，而且檔案本身
 * 留在原地：`info/exclude` 是使用者的檔案，nook 在 `init --private` 時只借了一行。
 * 清空或刪掉它會順手丟掉他排除 build 產物的設定，而那與共享這塊 board 無關。
 *
 * 認的是 `matchesExcludeRule` —— 與 `inspectSharing` / `excludeBoard` **同一個**判斷，包含
 * 它左右不對稱的那一面（尾端空白與 CR 收、前導空白不收）。兩邊各寫一套比對會
 * 長出兩種不一致：寬的一邊（trim）會刪掉使用者自己寫的 ` /.gitnook/`，窄的一邊
 * 會留下一條 git 仍然承認的 `/.gitnook/   ` —— 那時 `inspectSharing` 照樣回答
 * private，於是 `share` 報告成功、board 卻還被 ignore。
 *
 * 不在 git work tree 內時回 `unchanged` 而不是丟 `NoGitDir`（`excludeBoard` 丟是
 * 因為它**要寫**，沒有 `$GIT_DIR` 就無處可寫）：那裡沒有任何 ignore 規則，board
 * 本來就是 shared（`inspectSharing` 也這麼答），所以「什麼都不用動」是事實，不是
 * 一個使用者要修的錯誤。
 */
export function unexcludeBoard(root: string): UnexcludeOutcome {
  const layout = gitLayout(root);
  if (layout === null) return 'unchanged';

  const file = excludeFileOf(layout);
  if (!existsSync(file)) return 'unchanged';

  const pattern = boardPattern(layout.top, root);
  const lines = readFileSync(file, 'utf8').split('\n');
  const kept = lines.filter((line) => !matchesExcludeRule(line, pattern));
  if (kept.length === lines.length) return 'unchanged';

  // split/join 成對，所以結尾那個換行（split 後是最後一格空字串）原樣還原 ——
  // 少了它，下一次 excludeBoard 的 append 會黏在使用者的最後一行上。
  writeFileSync(file, kept.join('\n'), 'utf8');
  return 'removed';
}

/**
 * git 自己對這塊 board 的 ignore 判斷 —— 以及**它自己指出的來源**
 * （`<file>:<line>:<pattern>`），原封不動帶著走：那個行號是上層編不出來的東西。
 *
 * **會 spawn `git check-ignore -v`**，所以只准 init / doctor / share 呼叫。
 *
 * 問的是**一個真的存在的 op-log 檔**，不是那個目錄，也不是一個代表性的檔名 ——
 * 三者在真實 git 下不等價（實測）：
 *
 * | 狀態 | 問目錄 | 問存在的 op-log | 問不存在的檔名 |
 * |---|---|---|---|
 * | `.gitignore` 是 `*.ndjson`、op-log 未 tracked | 沒命中 ← **漏報** | 命中 ✓ | 命中 |
 * | `.gitignore` 是 `.gitnook/`、op-log 已 tracked | 沒命中 | 沒命中 ✓ | 命中 ← **假警報** |
 *
 * 也就是：只有「存在的檔案」兩邊都對。tracked 勝過 ignore 規則這件事要靠 index
 * 查得到那條路徑才成立，所以路徑必須真的在 index 的視野裡。
 *
 * **還沒有任何 op-log 時退回問目錄**（保守）。代價是「空 board + `*.ndjson`」
 * 這一格要等第一張 Issue 出現才報得出來 —— 那是延後，不是永久漏報，而拿不存在
 * 的檔名去問會在上表第二列變成假警報。
 */
export function ignoredByGit(root: string): { readonly ignored: boolean; readonly source: string | null } {
  let out: string;
  try {
    out = execFileSync('git', ['check-ignore', '-v', '--', ignoreProbe(root)], {
      cwd: resolve(root),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (thrown) {
    // status 是數字就表示 git 真的跑完並自己以非 0 結束（沒命中、或這裡不是 work
    // tree）。其餘（ENOENT、權限）是我們答不出來的，往外丟 —— 同 `opLogsTracked`：
    // 「不知道」不能被當成「沒有」。
    if (typeof (thrown as { status?: unknown }).status === 'number') {
      return { ignored: false, source: null };
    }
    throw thrown;
  }

  // 命中了（exit 0），但來源的形狀不是 `<file>:<line>:<pattern>\t<pathname>` 時
  // `source` 是 null：**ignored 仍然是 true** —— git 說了它 ignore，那是事實；
  // 我們只是沒有可以引用的來源。兩件事分開，呼叫端才決定得了要不要開口。
  const line = out.split('\n')[0] ?? '';
  const tab = line.lastIndexOf('\t');
  return { ignored: true, source: tab > 0 ? line.slice(0, tab) : null };
}

/**
 * 拿去問 git 的那條路徑。見 `ignoredByGit` 的表格。**依序嘗試 issues op-log
 * 目錄底下的檔案、decisions op-log 目錄底下的檔案**，都沒有時退回
 * `OP_LOG_DIR` 這個目錄路徑本身（保守）——兩個模組共用同一份「保守退回」邏輯，
 * 只是候選來源從一個變兩個。
 */
function ignoreProbe(root: string): string {
  return firstOpLogFile(root, OP_LOG_DIR) ?? firstOpLogFile(root, DECISION_LOG_DIR) ?? OP_LOG_DIR;
}

/** 某個 op-log 目錄底下排序後第一個 `.ndjson` 檔的路徑，沒有則 null。 */
function firstOpLogFile(root: string, opLogDir: string): string | null {
  const dir = join(resolve(root), ...opLogDir.split('/'));
  if (!existsSync(dir)) return null;
  // 排序讓答案穩定，不隨檔案系統的回傳順序漂移（同 health.ts 的 opLogNames）。
  const first = readdirSync(dir).filter((n) => n.endsWith(LOG_SUFFIX)).sort()[0];
  return first === undefined ? null : `${opLogDir}/${first}`;
}

/**
 * 我們那一行**沒有效果**時，是哪一條規則壓過它 —— git 自己指出的
 * `<file>:<line>:<pattern>`，原封不動帶著走。說不出來時是 null。
 *
 * **會 spawn `git check-ignore -v --non-matching`**，所以只准 doctor 呼叫，而且
 * 只在已經知道「規則在、卻沒生效」之後才問 —— 健康的 board 不該為它多付一個
 * 子行程。
 *
 * 兩個實測出來、缺一不可的細節（git 2.50.1）：
 *
 * - **要問 board 目錄本身，而且不能帶尾斜線。** committed 的 `!.gitnook/` 壓過
 *   `info/exclude` 時：問 `.gitnook` 得到 `.gitignore:1:!.gitnook/`（exit 0）、
 *   問 `.gitnook/` 或 `.gitnook/issues` 都只得到 `::`（exit 1，什麼都沒比對到）。
 *   否定規則是在**目錄**那一層生效的，所以問檔案問不出來。
 * - **要 `--non-matching`。** 沒有它，一條把路徑排除在外的否定規則就是「沒命中」，
 *   git 不會印出來 —— 而我們要的正是那一條。
 */
export function overridingRule(root: string): string | null {
  let out: string;
  try {
    out = execFileSync('git', ['check-ignore', '-v', '--non-matching', '--', GITNOOK_DIR], {
      cwd: resolve(root),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (thrown) {
    // 同 opLogsTracked：git 自己以非 0 結束是一個答案（沒有任何 pattern 命中），
    // 其餘（ENOENT、權限）是我們答不出來的。這裡兩者都只是「說不出來」——
    // 呼叫端已經有話要說了，這一句只是錦上添花。
    if (typeof (thrown as { status?: unknown }).status === 'number') return null;
    return null;
  }

  // `::\t<path>` 是 git 說「沒有任何 pattern 命中」的形狀 —— 那不是一條規則。
  const line = out.split('\n')[0] ?? '';
  const tab = line.lastIndexOf('\t');
  if (tab <= 0) return null;
  const source = line.slice(0, tab);
  return source === '::' ? null : source;
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
 * **問的是 op-log 那個目錄，不是整個 `.gitnook/`。** 這個函式有兩個消費者，而寬
 * 一格對它們不是同一個答案：對 init 的拒絕，多拒是保守的；但 doctor 拿它當否決權
 * （答 true 就是「不要壓掉 `MissingMergeDriver`」），寬一格就變成假陽性 ——
 * 一塊 private board 底下有個被 commit 過的 `.gitkeep` 或 `README`，op-log 本身
 * 仍然沒被追蹤（git 不會走進被排除的目錄），board 其實是 private，doctor 卻會
 * 吐出診斷並 exit 1。實測（git 2.x）：只有 `.gitkeep` 進 index 時，問
 * `.gitnook` 得到 exit 0（算 tracked），問 `.gitnook/issues` 得到 exit 1。
 * 共享狀態問的是 op-log 有沒有出去，所以窄的那一個才是兩邊都對的答案。
 *
 * **兩個模組各自窄探測後 OR 起來**——issues、decisions 各自的 op-log 目錄各問
 * 一次 `git ls-files --error-unmatch`，任一個被追蹤就算 `true`。**不**探測
 * `.gitnook/config.json`：一個被 commit 過的 config.json 不該讓「已共享」誤判
 * 成立，同上面對 `.gitkeep`／README 的假陽性防護邏輯。
 *
 * **答案全在 exit code，不讀輸出。** `--error-unmatch` 讓 git 在 pathspec 一個都
 * 沒命中時以非 0 結束，所以這裡不必把檔案清單收進 buffer —— 一塊兩萬張 issue 的
 * board 會撐爆 `execFileSync` 預設的 maxBuffer，而那個失敗會被 catch 吃掉、答成
 * false，正是這條拒絕存在的理由。把問題問成 exit code 就沒有那個 buffer。
 *
 * **只有「git 跑起來了、而它說非 0」才回 false。** git 不在 PATH 上、`.git`
 * 讀不動這類失敗一律往外丟：那時我們**不知道**這塊 board 是否已共享，而「不知道」
 * 絕不能被當成「沒共享」—— 那會讓 init 在一塊真的已共享的 board 上寫下一條無效
 * 規則。不在 git work tree 內走的也是這條非 0（git 自己回 128），而它不是
 * 「有東西被追蹤」，所以回 false；那條拒絕是呼叫端的事，見 `NoGitDir`。第一個
 * 探測若真的答不出來（非 status 的失敗）就直接往外丟，不繼續問第二個。
 */
export function opLogsTracked(root: string): boolean {
  return isTracked(root, OP_LOG_DIR) || isTracked(root, DECISION_LOG_DIR);
}

/** 單一 op-log 目錄是否已被 git 追蹤——`opLogsTracked` 對 issues、decisions 各問一次。 */
function isTracked(root: string, opLogDir: string): boolean {
  try {
    // 路徑相對於 cwd，所以問到的只會是這一塊 board —— 不是上層那一塊。
    execFileSync('git', ['ls-files', '--error-unmatch', '--', opLogDir], {
      cwd: resolve(root),
      stdio: 'ignore',
    });
    return true;
  } catch (thrown) {
    // status 是數字就表示 git 真的跑完並自己以非 0 結束（沒命中 pathspec、或
    // 這裡不是 work tree）。其餘（ENOENT、權限）是我們答不出來的情況，往外丟。
    if (typeof (thrown as { status?: unknown }).status === 'number') return false;
    throw thrown;
  }
}
