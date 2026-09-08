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

export type Op = CreateOp;

export const OP_KINDS = new Set(['create']);

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
