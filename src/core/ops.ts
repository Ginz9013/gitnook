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
export type SetKey = 'title' | 'status' | 'description' | 'archived' | 'deleted';

export interface SetOp extends OpBase {
  readonly op: 'set';
  readonly k: SetKey;
  readonly v: string | boolean;
}

/** OR-Set 的一個 add tag：op 的 id 本身就是 tag —— spec.md「op 型別」。 */
export interface LabelAddOp extends OpBase {
  readonly op: 'label.add';
  readonly v: string;
}

/**
 * 移除**它觀察到的那些 add tag**，而非「這個值」。
 * 並行發生、不在 seen 內的 add 因此存活 —— 這是 add-wins 的全部來源（spec.md）。
 */
export interface LabelRmOp extends OpBase {
  readonly op: 'label.rm';
  readonly v: string;
  readonly seen: readonly string[];
}

/** 只增不減，是 Nook 中唯一的討論載體 —— CONTEXT.md。 */
export interface CommentOp extends OpBase {
  readonly op: 'comment';
  readonly body: string;
}

export type Op = CreateOp | SetOp | LabelAddOp | LabelRmOp | CommentOp;

export const OP_KINDS = new Set(['create', 'set', 'label.add', 'label.rm', 'comment']);

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

/**
 * 把一條黏合行拆回原本的多個 op 文字，不是黏合行時回傳 null。
 *
 * 缺少 trailing newline 時 union merge 會把兩行黏成 `{"id":"b1"}{"id":"b2"}`
 * 這種非法 JSON（spike T2）。這種行**不是壞掉的資料，是還原得回來的資料** ——
 * 區分它與真正無法解析的行，doctor 才能修復而不是叫人手動編輯。
 */
export function splitGluedLine(line: string): string[] | null {
  const segments: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (c === '}') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) {
        segments.push(line.slice(start, i + 1));
        start = -1;
      }
      continue;
    }
    // 兩個物件之間只容許空白。其他任何東西都表示這不是單純的黏合。
    if (depth === 0 && c.trim() !== '') return null;
  }

  if (depth !== 0 || inString || segments.length < 2) return null;
  // 每一段都必須自己就是一個合法的 op 物件，否則稱不上「還原得回來」。
  for (const s of segments) if (parseLine(s) === null) return null;
  return segments;
}
