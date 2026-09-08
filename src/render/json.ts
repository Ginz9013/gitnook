import type { Issue } from '../core/types.js';

/**
 * 鍵依字母排序，讓輸出只取決於資料本身而非物件的屬性建立順序 ——
 * 這是 golden file 與 diff 能穩定的前提。
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
  return sorted;
}

/**
 * `--json` 的輸出。僅供程式化串接 —— agent 用預設的緊湊表格，見 docs/adr/0005。
 * 無縮排：結構字元對機器讀者是純粹的成本。
 */
export function renderJson(issues: readonly Issue[]): string;
export function renderJson(issue: Issue): string;
export function renderJson(input: readonly Issue[] | Issue): string {
  return JSON.stringify(sortKeys(input));
}
