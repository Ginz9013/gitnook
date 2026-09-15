import type { OpBase } from './oplog.js';

/**
 * Decision 的 Op 型別。同 `ops.ts` 之於 Issue，但沒有 label（OR-Set）與
 * comment（只增不減）——Decision 這次只要 title/body/disposition/history
 * （spec.md Non-goals）。`serialize`/`parseLine`/`nextLamport`/`orderOps`
 * 不在這裡，呼叫 `oplog.ts` 的泛型版本，不自己重寫排序/dedupe。
 */
export interface DecisionCreateOp extends OpBase {
  readonly op: 'create';
  readonly title: string;
}

/**
 * 五個 LWW 欄位。沒有 OR-Set／comments —— Decision 的全部欄位都是
 * 「最後一次寫入贏」，這是它與 Issue 的 Op 型別最大的不同（spec.md Design
 * contract）。
 */
export type DecisionSetKey = 'title' | 'body' | 'disposition' | 'supersededBy' | 'legacyRef';

export interface DecisionSetOp extends OpBase {
  readonly op: 'set';
  readonly k: DecisionSetKey;
  readonly v: string;
}

export type DecisionOp = DecisionCreateOp | DecisionSetOp;

/** 已知的 op 型別 —— 同 `ops.ts` 的 `OP_KINDS`，未知的種類交給 health 診斷。 */
export const DECISION_OP_KINDS = new Set(['create', 'set']);
