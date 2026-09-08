import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from './types.js';
import { MERGE_RULE, inspectMergeGuarantee } from './gitattributes.js';

/**
 * 資料健康診斷。彙整成一份 Diagnostic 清單 ——
 * 黏合行與未知 Op 的偵測由票 05 補進來。
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
      if (isParsable(text)) continue;
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
