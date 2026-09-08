import type { Issue } from './types.js';
import type { Op } from './ops.js';

/** dedupe by id → 以 (t, a, id) 全序排序 → fold。順序無關性的來源 —— docs/adr/0001。 */
export function reduce(id: string, ops: readonly Op[]): Issue {
  const seen = new Set<string>();
  const ordered = ops
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .sort((x, y) => x.t - y.t || cmp(x.a, y.a) || cmp(x.id, y.id));

  let title = '';
  for (const o of ordered) {
    if (o.op === 'create') title = o.title;
  }

  return { id, title, status: 'backlog', description: '', labels: [], archived: false, comments: [] };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
