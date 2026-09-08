import type { Issue, Status } from './types.js';
import { STATUSES } from './types.js';
import type { Op } from './ops.js';

/** 以 (t, a, id) 全序排序 → dedupe by id → fold。順序無關性的來源 —— docs/adr/0001。 */
export function reduce(id: string, ops: readonly Op[]): Issue {
  // 排序必須在 dedupe 之前：union merge 會保留同 id 但內容不同的兩行（spike T3），
  // 若先 dedupe 就等於「保留檔案裡的第一個」，收斂性隨即取決於行的順序。
  const seen = new Set<string>();
  const ordered = [...ops]
    .sort((x, y) => x.t - y.t || cmp(x.a, y.a) || cmp(x.id, y.id))
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));

  let title = '';
  let status: Status = 'backlog';
  let description = '';
  let archived = false;

  for (const o of ordered) {
    // 未知的 Op 型別必須忽略而非崩潰 —— docs/adr/0001 硬規則 2。
    if (o.op === 'create') {
      title = o.title;
    } else if (o.op === 'set') {
      // 型別不符或未知欄位同樣忽略：資料活在 git 裡，隊友的版本不同步是常態。
      if (o.k === 'title') {
        if (typeof o.v === 'string') title = o.v;
      } else if (o.k === 'description') {
        if (typeof o.v === 'string') description = o.v;
      } else if (o.k === 'archived') {
        if (typeof o.v === 'boolean') archived = o.v;
      } else if (o.k === 'status') {
        if (isStatus(o.v)) status = o.v;
      }
    }
  }

  return { id, title, status, description, labels: [], archived, comments: [] };
}

function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
