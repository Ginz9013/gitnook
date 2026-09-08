import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * 使用者既有的 .gitattributes 會讓 op-log 拿到 union 以外的 merge 行為。
 * 此時 init 報錯停止 —— 不靜默改寫別人的 merge 設定。
 */
export class ConflictingGitAttributes extends Error {
  constructor(readonly file: string, readonly line: number, readonly rule: string) {
    super(
      `${file}:${line} 的規則與 Nook 的零衝突保證衝突：${rule}\n` +
        `Nook 不會靜默改變你的 merge 行為。請自行調整該行，或確保 ${MERGE_RULE} 排在它之後。`,
    );
    this.name = 'ConflictingGitAttributes';
  }
}

/** op-log 檔在既有 .gitattributes 下實際拿到的合併保證。 */
export type MergeGuarantee =
  | { readonly kind: 'union' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'conflicting'; readonly line: number; readonly rule: string };

/** 支柱還在不在。init 與 doctor 共用同一份判斷。 */
export function inspectMergeGuarantee(dir: string): MergeGuarantee {
  const file = join(dir, '.gitattributes');
  if (!existsSync(file)) return { kind: 'absent' };

  const setting = effectiveMerge(readFileSync(file, 'utf8'));
  if (setting === null) return { kind: 'absent' };
  if (setting.value === 'union') return { kind: 'union' };
  return { kind: 'conflicting', line: setting.line, rule: setting.rule };
}

/** 建立 .issues/issues/ 並冪等寫入 MERGE_RULE，不覆蓋既有內容。 */
export function initBoard(dir: string): void {
  const file = join(dir, '.gitattributes');
  const guarantee = inspectMergeGuarantee(dir);

  if (guarantee.kind === 'conflicting') {
    throw new ConflictingGitAttributes(file, guarantee.line, guarantee.rule);
  }

  mkdirSync(join(dir, '.issues', 'issues'), { recursive: true });

  if (!existsSync(file)) {
    writeFileSync(file, `${MERGE_RULE}\n`, 'utf8');
    return;
  }
  // 既有規則已經讓 op-log 拿到 union 時就不再寫入 —— 冪等。
  if (guarantee.kind === 'union') return;

  const existing = readFileSync(file, 'utf8');

  // 既有檔案缺 trailing newline 時，直接 append 會把規則黏在使用者的最後一行上。
  const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(file, `${lead}${MERGE_RULE}\n`, 'utf8');
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
function effectiveMerge(content: string): MergeSetting | null {
  const lines = content.split('\n');
  let found: MergeSetting | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rule = lines[i]!.trim();
    // 空行、註解、以及 [attr] 巨集定義都不是 pattern 行。
    if (rule === '' || rule.startsWith('#') || rule.startsWith('[')) continue;

    const tokens = rule.split(/\s+/);
    const pattern = tokens[0]!;
    if (!matchesOpLog(pattern)) continue;

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

function matchesOpLog(pattern: string): boolean {
  const glob = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  if (glob === '') return false;
  // 不含 / 的 pattern 比對任何層級的檔名；含 / 的則錨定在 .gitattributes 所在目錄。
  const target = glob.includes('/') ? OP_LOG_SAMPLE : OP_LOG_SAMPLE.slice(OP_LOG_SAMPLE.lastIndexOf('/') + 1);
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
