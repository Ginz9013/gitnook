import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AlreadySharedBoard, excludeBoard, opLogsTracked } from './sharing.js';
import type { Sharing } from './sharing.js';

/**
 * 整個零衝突保證的唯一支柱 —— docs/adr/0001。
 * 這一行被誤刪時資料會靜默開始衝突，因此 doctor 持續驗證它還在。
 */
export const MERGE_RULE = '.issues/issues/*.ndjson merge=union';

/**
 * 一個代表性的 op-log 路徑。問題永遠是「新的 op-log 檔會不會拿到 merge=union」，
 * 所以判斷方式就是拿一條真實形狀的路徑去比對 .gitattributes 的 pattern。
 */
const OP_LOG_SAMPLE = '.issues/issues/01JBX7A9Q3.ndjson';

/**
 * Decision 版的零衝突保證 —— 同 `MERGE_RULE`/`OP_LOG_SAMPLE`，一份給
 * Decision Log 用。`.decisions/decisions/` 是它的 marker 目錄（同
 * `ISSUES_DIR` 之於 Issue）。
 *
 * 這是 spec.md 提到的「泛化尋根/初始化」在這個檔案裡實際落地的形狀：不是
 * 一個吃任意 marker 的公開泛型 API，而是 Issue 與 Decision 各自一組具名的
 * 薄常數 + 呼叫同一份內部泛化邏輯（`findRoot`/`initMarkerRoot`）—— 呼叫端
 * （`board.ts`/`decisionLog.ts`/CLI）永遠只看到具名的
 * `findBoardRoot`/`findDecisionRoot`，不必知道底下共用了什麼。
 */
export const DECISION_MERGE_RULE = '.decisions/decisions/*.ndjson merge=union';
export const DECISION_LOG_SAMPLE = '.decisions/decisions/01JBX7A9Q3.ndjson';
export const DECISIONS_DIR = ['.decisions', 'decisions'] as const;

/**
 * 使用者既有的 .gitattributes 會讓 op-log 拿到 union 以外的 merge 行為。
 * 此時 init 報錯停止 —— 不靜默改寫別人的 merge 設定。
 */
export class ConflictingGitAttributes extends Error {
  constructor(readonly file: string, readonly line: number, readonly rule: string) {
    super(
      `${file}:${line}'s rule conflicts with Nook's zero-conflict guarantee: ${rule}\n` +
        `Nook will not silently change your merge behavior. Adjust that line yourself, or make sure ${MERGE_RULE} comes after it.`,
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
 * 支柱還在不在。init 與 doctor 共用同一份判斷。
 *
 * `sample` 預設是 Issue 的代表性 op-log 路徑（`OP_LOG_SAMPLE`）—— 既有呼叫端
 * （`run.ts`/`health.ts`/`board.ts`）一個字元都不必改。Decision 側傳入
 * `DECISION_LOG_SAMPLE` 問的是同一件事，只是換一條路徑形狀。
 */
export function inspectMergeGuarantee(dir: string, sample: string = OP_LOG_SAMPLE): MergeGuarantee {
  const file = join(dir, '.gitattributes');
  if (!existsSync(file)) return { kind: 'absent' };

  const setting = effectiveMerge(readFileSync(file, 'utf8'), sample);
  if (setting === null) return { kind: 'absent' };
  if (setting.value === 'union') return { kind: 'union' };
  return { kind: 'conflicting', line: setting.line, rule: setting.rule };
}

/**
 * board 的資料目錄，相對於 board 的根目錄。
 *
 * 匯出給 `workspace.ts` 重用同一個「這裡有沒有一塊 board」的判斷——兩處各自
 * 寫一份 `.issues/issues` 字面路徑，其中一份改了資料目錄名稱就會漏改。
 */
export const ISSUES_DIR = ['.issues', 'issues'] as const;

/** 由某個目錄向上尋根的結果。 */
export type BoardRoot =
  | { readonly found: true; readonly root: string }
  /** 找不到時交代搜尋到哪裡為止 —— 錯誤訊息必須說出範圍。 */
  | { readonly found: false; readonly ceiling: string };

/**
 * 由 dir 向上找最近的一塊 board，行為同 git 尋找 `.git`。
 * 沒有它，`cd src/deep && nook list` 會說這裡不是 board。
 *
 * **停止條件是 git repo 的根目錄**，只有不在任何 repo 內時才一路走到
 * filesystem root。理由：`.issues/` 的每一個 byte 都在 git 裡（ADR-0002），
 * 一塊 board 屬於一個 repo。越過 repo 根去命中上層的 board，等於把 Issue
 * 寫進另一個 repo 的資料 —— 那是「board 被無聲切成兩塊」的鏡像失敗，同樣
 * 沒有任何東西會提示。而在 `git init` 之前 board 仍然要能用，所以沒有 repo
 * 根可停時退回 filesystem root，而不是就地拒絕。
 */
export function findBoardRoot(dir: string): BoardRoot {
  return findMarkerRoot(dir, ISSUES_DIR);
}

/**
 * 同 `findBoardRoot`，但 marker 換成 `.decisions/decisions`——給 Decision Log
 * 用。兩者呼叫的是同一份尋根邏輯（`findMarkerRoot`），差別只在 marker 目錄，
 * 因此停止條件（repo 根）與退回規則（找不到 repo 根就走到 filesystem root）
 * 逐字相同，不會漂移成兩份規則。
 */
export function findDecisionRoot(dir: string): BoardRoot {
  return findMarkerRoot(dir, DECISIONS_DIR);
}

/**
 * 由 dir 向上找最近一個含 `marker` 這個相對路徑的目錄，行為同 git 尋找
 * `.git`。`findBoardRoot`/`findDecisionRoot` 是它的兩個具名薄包裝 ——
 * 呼叫端只看得到那兩個名字，不知道底下共用了同一份走法。
 */
function findMarkerRoot(dir: string, marker: readonly string[]): BoardRoot {
  let here = resolve(dir);
  for (;;) {
    // 只問存在，不問是不是目錄：marker 變成一個檔案是「board 壞了」，
    // 不是「這裡沒有 board」—— 靜默略過它會讓呼叫端接到上層那一塊。
    if (existsSync(join(here, ...marker))) return { found: true, root: here };
    // repo 根本身也要先看過才停，所以這個檢查排在後面。
    // `.git` 可能是檔案而不是目錄（worktree、submodule），因此同樣只問存在。
    if (existsSync(join(here, '.git'))) return { found: false, ceiling: here };
    const parent = dirname(here);
    if (parent === here) return { found: false, ceiling: here };
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
 * 建立 .issues/issues/，並依 Sharing 補上這個模式的保證：
 * shared 冪等寫入 MERGE_RULE（不覆蓋既有內容），private 則把整塊 board 冪等
 * 排除在 git 之外。
 *
 * 為什麼是一個參數而不是另一個 `initPrivateBoard`：一塊 board 只有一種建立
 * 方式，Sharing 是它的參數 —— 兩個入口會讓 `NestedBoard` 與建目錄的前置條件
 * 各有兩份。
 */
export function initBoard(dir: string, opts?: { readonly sharing?: Sharing }): void {
  const here = resolve(dir);
  // 排在任何寫入之前。在 board 根目錄重複 init 仍然是冪等的 —— 被擋下的
  // 只有「在既有 board 底下另開一塊」。
  const enclosing = findBoardRoot(here);
  if (enclosing.found && enclosing.root !== here) throw new NestedBoard(here, enclosing.root);

  // 預設值收在一處：`undefined`、`{}`、`{ sharing: 'shared' }` 是同一件事的三種
  // 寫法，分散比對會讓日後多出來的第三個 Sharing 值靜默走進 shared 那一條。
  const sharing: Sharing = opts?.sharing ?? 'shared';

  if (sharing === 'private') {
    // **兩條拒絕都排在任何寫入之前，然後才是排除，最後才建目錄。** 反過來的話，
    // 拒絕會留下一個 git 看得見的 .issues/（NoGitDir）或一條對 tracked 路徑毫無
    // 效果、卻讓 inspectSharing 從此回答 private 的規則（AlreadySharedBoard）——
    // 兩者都與使用者要的「不留痕跡」正好相反，而他以為指令失敗了。shared 路徑的
    // ConflictingGitAttributes 同樣排在 mkdir 之前，是同一條紀律。
    //
    // op-log 已被追蹤就是「這塊 board 已經共享出去了」，而 **index 勝過 ignore
    // 規則**：照寫排除規則是一個完全沒有效果的動作（理由見 `opLogsTracked`）。
    // 這是 init 這條路徑唯一 spawn git 的地方 —— 讀取熱路徑只問純 fs 的
    // inspectSharing，list 不得為此付一個子行程的錢。
    //
    // 刻意**完全不碰 .gitattributes**，連讀都不讀：被 ignore 的 op-log 永遠不會
    // merge，所以 MERGE_RULE 在這個模式下無意義，而既有的 conflicting 規則同樣
    // 無意義 —— 因此也不得拿它來報錯。
    if (opLogsTracked(here)) throw new AlreadySharedBoard(here);
    // 不在 git work tree 內時這裡丟 NoGitDir，同樣在 mkdir 之前。
    excludeBoard(here);
    mkdirSync(join(here, ...ISSUES_DIR), { recursive: true });
    return;
  }

  initGuardedMarkerDir(here, ISSUES_DIR, MERGE_RULE, OP_LOG_SAMPLE);
}

/**
 * Decision Log 版的 `initBoard`：**只有 shared 模式**——ticket 01 的 Decision
 * 不支援 `--private`（沒有任何 AC 要求它，見 spec.md 的 Non-goals 精神：這次
 * 不是把 Issue 的每個能力都複製一份）。Nested 檢查沿用同一個 `NestedBoard`
 * 型別——訊息本來就是泛用的「已經在一塊 Nook board 裡」，不必為 Decision
 * 另開一個型別。
 */
export function initDecisionRoot(dir: string): void {
  const here = resolve(dir);
  const enclosing = findDecisionRoot(here);
  if (enclosing.found && enclosing.root !== here) throw new NestedBoard(here, enclosing.root);

  initGuardedMarkerDir(here, DECISIONS_DIR, DECISION_MERGE_RULE, DECISION_LOG_SAMPLE);
}

/**
 * `initBoard`/`initDecisionRoot` 的共用下半段：檢查衝突規則、建立 marker 目錄、
 * 冪等寫入這個 marker 專屬的 merge=union 規則。**巢狀檢查刻意留在呼叫端** ——
 * 那一步在 private 模式下走的是完全不同的路徑（`excludeBoard` 而非
 * `.gitattributes`），硬塞進來會讓這個函式多一個它不需要知道的分支。
 */
function initGuardedMarkerDir(here: string, marker: readonly string[], rule: string, sample: string): void {
  const file = join(here, '.gitattributes');
  const guarantee = inspectMergeGuarantee(here, sample);

  if (guarantee.kind === 'conflicting') {
    throw new ConflictingGitAttributes(file, guarantee.line, guarantee.rule);
  }

  mkdirSync(join(here, ...marker), { recursive: true });

  if (!existsSync(file)) {
    writeFileSync(file, `${rule}\n`, 'utf8');
    return;
  }
  // 既有規則已經讓 op-log 拿到 union 時就不再寫入 —— 冪等。
  if (guarantee.kind === 'union') return;

  const existing = readFileSync(file, 'utf8');

  // 既有檔案缺 trailing newline 時，直接 append 會把規則黏在使用者的最後一行上。
  const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(file, `${lead}${rule}\n`, 'utf8');
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
