export interface OpBase {
  readonly id: string;
  /** lamport clock，per-issue */
  readonly t: number;
  /** actor */
  readonly a: string;
}

export interface CreateOp extends OpBase {
  readonly op: 'create';
  readonly title: string;
}

/** LWW 欄位。labels 是 OR-Set、comments 只增不減，兩者都不是 set —— 見 CONTEXT.md。 */
export type SetKey = 'title' | 'status' | 'description' | 'archived';

export interface SetOp extends OpBase {
  readonly op: 'set';
  readonly k: SetKey;
  readonly v: string | boolean;
}

export type Op = CreateOp | SetOp;

export const OP_KINDS = new Set(['create', 'set']);

/**
 * 一個 Op 一行，永遠以 \n 結尾。
 * 缺少 trailing newline 會讓 git 的 union merge 把兩行黏成非法 JSON —— docs/adr/0001。
 */
export function serialize(op: Op): string {
  return JSON.stringify(op) + '\n';
}

/** 解析單行。無法解析時回傳 null —— 診斷與修復屬於 health（票 05/06）。 */
export function parseLine(line: string): Op | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Op;
  } catch {
    return null;
  }
}

/**
 * 下一個 lamport 值：讀該單檔取 max(t)+1。
 * 每張 Issue 是獨立的 CRDT 文件，clock 只需 per-issue —— spec.md「儲存」。
 */
export function nextLamport(ops: readonly Op[]): number {
  let max = 0;
  for (const o of ops) if (typeof o.t === 'number' && o.t > max) max = o.t;
  return max + 1;
}
