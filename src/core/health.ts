import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from './types.js';
import { MERGE_RULE, inspectMergeGuarantee } from './gitattributes.js';
import { OP_KINDS, splitGluedLine } from './ops.js';

/**
 * 資料健康診斷。彙整成一份 Diagnostic 清單：merge=union 那條唯一支柱是否還在、
 * 黏合行（ADR-0001 硬規則 1）、未知的 op 型別（硬規則 2）、以及真正無法解析的行。
 */
export function diagnose(dir: string): Diagnostic[] {
  const found: Diagnostic[] = [];

  // .gitattributes 只在 git 底下生效，不是 repo 就沒有零衝突保證可言。
  if (!isInsideGitWorkTree(dir)) {
    found.push({
      kind: 'NotAGitRepo',
      message: `${dir} 不在 git work tree 內：merge=union 不會生效`,
    });
  }

  // 唯一的單點失效：保證不在，資料就會靜默開始衝突（docs/adr/0001）。
  const guarantee = inspectMergeGuarantee(dir);
  if (guarantee.kind === 'absent') {
    found.push({
      kind: 'MissingMergeDriver',
      file: '.gitattributes',
      message: `缺少零衝突保證：${MERGE_RULE}（執行 nook init 補回）`,
    });
  } else if (guarantee.kind === 'conflicting') {
    found.push({
      kind: 'MissingMergeDriver',
      file: '.gitattributes',
      line: guarantee.line,
      message: `這一行讓 op-log 拿不到 merge=union：${guarantee.rule}`,
    });
  }

  for (const name of opLogNames(dir)) {
    const relative = `${ISSUES_DIR}/${name}`;
    for (const [line, text] of numberedLines(readFileSync(join(dir, ISSUES_DIR, name), 'utf8'))) {
      if (isParsable(text)) {
        // 向前相容是資料安全問題（ADR-0001 硬規則 2）：reducer 靜默忽略未知 op，
        // 所以 doctor 必須把它說出來，否則使用者只會看到欄位莫名其妙沒生效。
        const kind = opKindOf(text);
        if (kind !== null && !OP_KINDS.has(kind)) {
          found.push({
            kind: 'UnknownOp',
            file: relative,
            line,
            message: `未知的 op 型別 ${kind}：reducer 會忽略這一行（可能需要升級 nook）`,
          });
        }
        continue;
      }

      // 黏合行不是壞掉的資料，是還原得回來的資料 —— 分開回報，doctor 才能修復。
      const glued = splitGluedLine(text);
      if (glued !== null) {
        found.push({
          kind: 'GluedLine',
          file: relative,
          line,
          message: `${glued.length} 個 op 被黏成一行（寫入時缺少 trailing newline），可修復：${excerpt(text)}`,
        });
        continue;
      }

      found.push({
        kind: 'UnparsableLine',
        file: relative,
        line,
        message: `無法解析，reducer 會丟棄這一行：${excerpt(text)}`,
      });
    }
  }

  return found;
}

/** 一條被還原回來的黏合行。 */
export interface Repair {
  readonly file: string;
  readonly line: number;
  /** 這一行還原出幾個 op。 */
  readonly ops: number;
}

/**
 * 把黏合行還原成多行。**只拆行，不做任何語意判斷** ——
 * union merge 複製出來的重複 op 交給 reduce 的 dedupe by id 吸收，
 * 修復不該替使用者決定哪個 op 該留下。
 */
export function repair(dir: string): Repair[] {
  const done: Repair[] = [];

  for (const name of opLogNames(dir)) {
    const path = join(dir, ISSUES_DIR, name);
    const relative = `${ISSUES_DIR}/${name}`;
    const out: string[] = [];
    let changed = false;

    for (const [line, text] of numberedLines(readFileSync(path, 'utf8'))) {
      const glued = isParsable(text) ? null : splitGluedLine(text);
      if (glued === null) {
        out.push(text);
        continue;
      }
      out.push(...glued);
      done.push({ file: relative, line, ops: glued.length });
      changed = true;
    }

    // 修好的檔案自己也必須守住硬規則 1，否則下一次 merge 又黏起來。
    if (changed) writeFileSync(path, out.map((l) => `${l}\n`).join(''), 'utf8');
  }

  return done;
}

const ISSUES_DIR = '.issues/issues';

function opLogNames(dir: string): string[] {
  const path = join(dir, ISSUES_DIR);
  if (!existsSync(path)) return [];
  // 排序讓 doctor 的輸出穩定，不隨檔案系統的回傳順序漂移。
  return readdirSync(path).filter((name) => name.endsWith('.ndjson')).sort();
}

/** 以 1 為起點編號；尾端換行後的空字串不是一行。 */
function numberedLines(content: string): Array<[number, string]> {
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((text, i) => [i + 1, text]);
}

/**
 * 刻意不借用 ops.parseLine：那裡的職責是「取出 Op」，日後收緊成只認識已知 Op 型別時，
 * 未知 Op 會被誤報成無法解析 —— 而未知 Op 是另一種 Diagnostic（票 05）。
 */
function isParsable(text: string): boolean {
  if (text.trim() === '') return true;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** 已知可解析的行的 op 欄位。不是物件、或 op 不是字串時回傳 null。 */
function opKindOf(text: string): string | null {
  if (text.trim() === '') return null;
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const op = (parsed as { op?: unknown }).op;
  return typeof op === 'string' ? op : null;
}

function excerpt(text: string): string {
  return text.length <= 60 ? text : `${text.slice(0, 60)}…`;
}

function isInsideGitWorkTree(dir: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}
