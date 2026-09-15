import type { DecisionOp, DecisionSetKey, DecisionSetOp } from './decisionOps.js';
import type { Decision, Disposition } from './decisionTypes.js';
import { DISPOSITIONS } from './decisionTypes.js';
import { orderOps } from './oplog.js';

/**
 * 一個 Decision 的 Op-log 裡，對 LWW 欄位的每一次寫入。同 `reduce.ts` 的
 * `fieldWrites`——`create` op 帶的 title 折成 title 的第一次寫入，理由相同：
 * 不折的話「這個欄位從沒被寫過」會是一句假話。供票 04 的 `nook decision
 * history` 用，介面先在這裡定義好。
 */
export function decisionFieldWrites(ops: readonly DecisionOp[], field?: DecisionSetKey): readonly DecisionSetOp[] {
  const writes: DecisionSetOp[] = [];
  for (const o of ops) {
    if (o.op === 'create') {
      if (field === undefined || field === 'title') {
        writes.push({ id: o.id, t: o.t, a: o.a, op: 'set', k: 'title', v: o.title });
      }
    } else if (o.op === 'set') {
      if (field === undefined || o.k === field) writes.push(o);
    }
  }
  return writes;
}

/**
 * 全序 → fold。全部 LWW，沒有 OR-Set／comments —— Decision 沒有 Issue 那種
 * add-wins 的合併語意（spec.md Design contract）。
 *
 * 沒被寫過的欄位落到型別自己的預設值：`title`/`body` 是空字串，`disposition`
 * 是 `proposed`（新提案的自然起點，同 Issue 的 `backlog`）,
 * `supersededBy`/`legacyRef` 完全不出現在回傳的物件上（它們是 optional 欄位，
 * 「從沒被寫過」用鍵不存在表達，不是空字串）。
 */
export function reduceDecision(id: string, ops: readonly DecisionOp[]): Decision {
  const ordered = orderOps(ops);

  let title = '';
  let body = '';
  let disposition: Disposition = 'proposed';
  let supersededBy: string | undefined;
  let legacyRef: string | undefined;

  for (const o of ordered) {
    // 未知的 Op 型別必須忽略而非崩潰 —— 同 ADR-0001 硬規則 2 對 Issue 的規定。
    if (o.op === 'create') {
      title = o.title;
    } else if (o.op === 'set') {
      // 型別不符或未知欄位同樣忽略：資料活在 git 裡，隊友的版本不同步是常態。
      if (o.k === 'title') {
        if (typeof o.v === 'string') title = o.v;
      } else if (o.k === 'body') {
        if (typeof o.v === 'string') body = o.v;
      } else if (o.k === 'disposition') {
        if (isDisposition(o.v)) disposition = o.v;
      } else if (o.k === 'supersededBy') {
        if (typeof o.v === 'string') supersededBy = o.v;
      } else if (o.k === 'legacyRef') {
        if (typeof o.v === 'string') legacyRef = o.v;
      }
    }
  }

  return {
    id,
    title,
    body,
    disposition,
    ...(supersededBy === undefined ? {} : { supersededBy }),
    ...(legacyRef === undefined ? {} : { legacyRef }),
  };
}

function isDisposition(v: unknown): v is Disposition {
  return typeof v === 'string' && (DISPOSITIONS as readonly string[]).includes(v);
}
