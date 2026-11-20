import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DECISIONS_DIR, ISSUES_DIR } from './opLogModules.js';

/**
 * `.gitattributes` 的規則比對與寫入，加上尋根。這是 Container（`container.ts`）
 * 內部的 seam：「哪些 Op-log 需要哪一條規則、在什麼 Sharing 下才需要」由
 * Container 回答，這裡只回答「這條 sample 路徑實際拿到什麼 merge 行為」與
 * 「把這一行冪等地寫進去」。
 */

/**
 * 使用者既有的 .gitattributes 會讓 op-log 拿到 union 以外的 merge 行為。
 * 此時 init 報錯停止 —— 不靜默改寫別人的 merge 設定。
 */
export class ConflictingGitAttributes extends Error {
  /**
   * `wanted` 是被蓋掉的那一條 Nook 規則 —— 訊息要點名**實際**衝突的那一條，
   * 而不是一律叫使用者去調整 Issue 那一條（Decision 的規則衝突時那是錯的指示）。
   */
  constructor(
    readonly file: string,
    readonly line: number,
    readonly rule: string,
    readonly wanted: string,
  ) {
    super(
      `${file}:${line}'s rule conflicts with Nook's zero-conflict guarantee: ${rule}\n` +
        `Nook will not silently change your merge behavior. Adjust that line yourself, or make sure ${wanted} comes after it.`,
    );
    this.name = 'ConflictingGitAttributes';
  }
}

/** op-log 檔在既有 .gitattributes 下實際拿到的合併保證。 */
export type MergeGuarantee =
  | { readonly kind: 'union' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'conflicting'; readonly line: number; readonly rule: string };

/**
 * 一條 sample 路徑（`OpLogModule.sample`）在既有 .gitattributes 下實際拿到的
 * merge 行為。init 與 doctor 共用同一份判斷。
 */
export function inspectMergeGuarantee(dir: string, sample: string): MergeGuarantee {
  const file = join(dir, '.gitattributes');
  if (!existsSync(file)) return { kind: 'absent' };

  const setting = effectiveMerge(readFileSync(file, 'utf8'), sample);
  if (setting === null) return { kind: 'absent' };
  if (setting.value === 'union') return { kind: 'union' };
  return { kind: 'conflicting', line: setting.line, rule: setting.rule };
}

/**
 * 票 01 之前的佈局：各自獨立的 `.issues/issues/`、`.decisions/decisions/`。
 * 只在尋根落空時拿來偵測「這裡是不是一個還沒搬家的舊 board」——找到 marker
 * 之後本身不會被拿來開 Board／DecisionLog，那條路仍然只認 `.gitnook/...`。
 */
const LEGACY_ISSUES_DIR = ['.issues', 'issues'] as const;
const LEGACY_DECISIONS_DIR = ['.decisions', 'decisions'] as const;

/**
 * 尋根落空、但沿路看到舊版佈局 marker 時的位置與種類 —— `BoardNotInitialized`／
 * `DecisionLogNotInitialized` 拿它組出可直接複製貼上的 `git mv` 指令
 * （票 03：舊版佈局偵測）。`dir` 是看到 marker 的那個目錄，不是呼叫端傳入的
 * `dir`——board 可能不在呼叫端的 cwd，指令必須以實際位置為準。
 */
export interface LegacyLayout {
  readonly dir: string;
  readonly issues: boolean;
  readonly decisions: boolean;
}

/**
 * `BoardNotInitialized`/`DecisionLogNotInitialized` 共用的措辭——兩者各自對稱
 * 組出同一種提示，理由同 `findBoardRoot`/`findDecisionRoot` 之於
 * `findMarkerRoot` 的既有設計語言：同一份邏輯只寫一次，兩個呼叫端各自匯入。
 * 指令帶上完整路徑而不是相對路徑：board 可能不在呼叫端的 cwd，貼上一條相對
 * 指令的人會在錯的目錄下執行它。兩條指令用 `&&` 接在同一行，維持這兩個錯誤
 * 訊息單行的既有紀律，也讓使用者一次貼上就搬完，不必先後執行兩次、失敗兩次。
 */
export function legacyMoveHint(legacy: LegacyLayout | undefined): string {
  if (legacy === undefined) return '';
  const moves: string[] = [];
  if (legacy.issues) {
    moves.push(`git mv "${join(legacy.dir, '.issues', 'issues')}" "${join(legacy.dir, '.gitnook', 'issues')}"`);
  }
  if (legacy.decisions) {
    moves.push(
      `git mv "${join(legacy.dir, '.decisions', 'decisions')}" "${join(legacy.dir, '.gitnook', 'decisions')}"`,
    );
  }
  if (moves.length === 0) return '';
  return ` — found a legacy layout at ${legacy.dir}, run: ${moves.join(' && ')}`;
}

/** 由某個目錄向上尋根的結果。 */
export type BoardRoot =
  | { readonly found: true; readonly root: string }
  /** 找不到時交代搜尋到哪裡為止 —— 錯誤訊息必須說出範圍。 */
  | { readonly found: false; readonly ceiling: string; readonly legacy?: LegacyLayout | undefined };

/**
 * 由 dir 向上找最近的一塊 board，行為同 git 尋找 `.git`。
 * 沒有它，`cd src/deep && nook list` 會說這裡不是 board。
 *
 * **停止條件是 git repo 的根目錄**，只有不在任何 repo 內時才一路走到
 * filesystem root。理由：`.gitnook/` 的每一個 byte 都在 git 裡（ADR-0002），
 * 一塊 board 屬於一個 repo。越過 repo 根去命中上層的 board，等於把 Issue
 * 寫進另一個 repo 的資料 —— 那是「board 被無聲切成兩塊」的鏡像失敗，同樣
 * 沒有任何東西會提示。而在 `git init` 之前 board 仍然要能用，所以沒有 repo
 * 根可停時退回 filesystem root，而不是就地拒絕。
 */
export function findBoardRoot(dir: string): BoardRoot {
  return findMarkerRoot(dir, ISSUES_DIR);
}

/**
 * 同 `findBoardRoot`，但 marker 換成 `.gitnook/decisions`——給 Decision Log
 * 用。兩者呼叫的是同一份尋根邏輯（`findMarkerRoot`），差別只在 marker 目錄，
 * 因此停止條件（repo 根）與退回規則（找不到 repo 根就走到 filesystem root）
 * 逐字相同，不會漂移成兩份規則。
 */
export function findDecisionRoot(dir: string): BoardRoot {
  return findMarkerRoot(dir, DECISIONS_DIR);
}

/**
 * 由 dir 向上找最近一個 `.gitnook` 容器 —— Container 的 init 用它做 NestedBoard
 * 檢查，**只檢查一次，涵蓋全部 Op-log 模組**。`.gitnook` 本身在任一模組 mkdir 時
 * 就會被建出來，所以只問這一層就足以認出「這裡已經 init 過」。
 */
export function findNookRoot(dir: string): BoardRoot {
  return findMarkerRoot(dir, ['.gitnook']);
}

/**
 * 由 dir 向上找最近一個含 `marker` 這個相對路徑的目錄，行為同 git 尋找
 * `.git`。`findBoardRoot`/`findDecisionRoot` 是它的兩個具名薄包裝 ——
 * 呼叫端只看得到那兩個名字，不知道底下共用了同一份走法。
 *
 * 同一趟walk 順便偵測舊版佈局 marker（`LegacyLayout`）——找到現行 marker 就直接
 * 回傳，用不到；找不到時，沿路第一個看到舊版 marker 的目錄（離 `dir` 最近的
 * 那一個，同現行 marker「最近命中」的規則一致）連同兩個旗標一起交給呼叫端組
 * 錯誤訊息。只記第一個看到的位置，不會被更上層的第二個舊版殘留覆蓋掉。
 */
function findMarkerRoot(dir: string, marker: readonly string[]): BoardRoot {
  let here = resolve(dir);
  let legacy: LegacyLayout | undefined;
  for (;;) {
    // 只問存在，不問是不是目錄：marker 變成一個檔案是「board 壞了」，
    // 不是「這裡沒有 board」—— 靜默略過它會讓呼叫端接到上層那一塊。
    if (existsSync(join(here, ...marker))) return { found: true, root: here };

    if (legacy === undefined) {
      const issues = existsSync(join(here, ...LEGACY_ISSUES_DIR));
      const decisions = existsSync(join(here, ...LEGACY_DECISIONS_DIR));
      if (issues || decisions) legacy = { dir: here, issues, decisions };
    }

    // repo 根本身也要先看過才停，所以這個檢查排在後面。
    // `.git` 可能是檔案而不是目錄（worktree、submodule），因此同樣只問存在。
    if (existsSync(join(here, '.git'))) return { found: false, ceiling: here, legacy };
    const parent = dirname(here);
    if (parent === here) return { found: false, ceiling: here, legacy };
    here = parent;
  }
}

/**
 * 在既有 board 的**子目錄**中 init。照做會把 board 切成兩塊，各自累積 Issue
 * 且沒有任何東西會提示 —— 這是資料完整性問題，所以拒絕。
 */
export class NestedBoard extends Error {
  constructor(readonly dir: string, readonly root: string) {
    super(
      `${dir} is already inside a Nook board (root ${root}): ` +
        `running init in a subdirectory would split the board in two, each accumulating its own issues.`,
    );
    this.name = 'NestedBoard';
  }
}

/**
 * 冪等寫入一條 merge=union 規則。**不做衝突檢查** —— 呼叫端（Container 的 init）
 * 要在任何寫入之前把每一條規則的衝突都檢查完（見 `ConflictingGitAttributes`），
 * 所以這裡只管寫。回傳值是三分法：`created`（.gitattributes 這次才有）、`added`
 * （補了一行進既有檔案）、`unchanged`（規則早就讓 sample 拿到 union 了）。
 */
export function ensureGuaranteeRule(here: string, rule: string, sample: string): 'created' | 'added' | 'unchanged' {
  const file = join(here, '.gitattributes');
  if (inspectMergeGuarantee(here, sample).kind === 'union') return 'unchanged';

  if (!existsSync(file)) {
    writeFileSync(file, `${rule}\n`, 'utf8');
    return 'created';
  }

  const existing = readFileSync(file, 'utf8');
  // 既有檔案缺 trailing newline 時，直接 append 會把規則黏在使用者的最後一行上。
  const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(file, `${lead}${rule}\n`, 'utf8');
  return 'added';
}

interface MergeSetting {
  /** `union`、`ours`、或 `-merge` / `!merge` / `merge` 這類非 union 的設定值。 */
  readonly value: string;
  readonly rule: string;
  readonly line: number;
}

/**
 * op-log 檔實際生效的 merge 屬性。git 的規則是**後面的行覆蓋前面的**，
 * 因此取最後一條命中的設定。沒有任何一行設定 merge 時回傳 null。
 */
function effectiveMerge(content: string, sample: string): MergeSetting | null {
  const lines = content.split('\n');
  let found: MergeSetting | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rule = lines[i]!.trim();
    // 空行、註解、以及 [attr] 巨集定義都不是 pattern 行。
    if (rule === '' || rule.startsWith('#') || rule.startsWith('[')) continue;

    const tokens = rule.split(/\s+/);
    const pattern = tokens[0]!;
    if (!matchesOpLog(pattern, sample)) continue;

    for (const token of tokens.slice(1)) {
      const value = mergeValueOf(token);
      if (value !== null) found = { value, rule, line: i + 1 };
    }
  }

  return found;
}

function mergeValueOf(token: string): string | null {
  if (token.startsWith('merge=')) return token.slice('merge='.length);
  if (token === 'merge') return 'set';
  if (token === '-merge') return 'unset';
  if (token === '!merge') return 'unspecified';
  return null;
}

function matchesOpLog(pattern: string, sample: string): boolean {
  const glob = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  if (glob === '') return false;
  // 不含 / 的 pattern 比對任何層級的檔名；含 / 的則錨定在 .gitattributes 所在目錄。
  const target = glob.includes('/') ? sample : sample.slice(sample.lastIndexOf('/') + 1);
  return globToRegExp(glob).test(target);
}

function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i++;
      } else {
        source += '[^/]*';
      }
    } else if (c === '?') {
      source += '[^/]';
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}
