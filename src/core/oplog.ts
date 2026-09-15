/**
 * 泛型 Op-log 引擎：序列化 / 解析 / 全序排序 / lamport clock，供任何實體重用。
 *
 * **Issue 繼續用 `ops.ts`/`reduce.ts` 既有的版本，一行都不動** —— 這是一個
 * 全新引擎，只給 Decision 用（spec.md Domain decisions：兩份序列化/排序/
 * dedupe/lamport 邏輯完全相同，值得抽出共用引擎；但目標是新引擎給新實體用，
 * 不是把 Issue 現有、已測試穩定的程式碼重構過去冒風險）。
 *
 * 只認 `OpBase`（`id`/`t`/`a`）——不知道任何具體 Op 型別（`Op`、`DecisionOp`）
 * 的欄位形狀。fold（reduce）邏輯不在這裡：每個實體自己的語意（LWW／OR-Set／…）
 * 差異太大，硬塞會變成「介面跟實作一樣複雜」的假接縫。
 *
 * 純函數，無副作用，無 I/O。內部工具，不上 `src/index.ts` 公開面。
 */
export interface OpBase {
  readonly id: string;
  /** lamport clock，per-log。 */
  readonly t: number;
  /** actor。 */
  readonly a: string;
}

/**
 * 一個 Op 一行，永遠以 \n 結尾。
 * 缺少 trailing newline 會讓 git 的 union merge 把兩行黏成非法 JSON —— decision legacyRef 0001（`nook decision show 0001`）。
 */
export function serialize<T extends OpBase>(op: T): string {
  return JSON.stringify(op) + '\n';
}

/** 解析單行。無法解析時回傳 null —— 診斷與修復屬於各實體自己的 health 邏輯。 */
export function parseLine<T extends OpBase>(line: string): T | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** 下一個 lamport 值：讀該單檔取 max(t)+1。 */
export function nextLamport<T extends OpBase>(ops: readonly T[]): number {
  let max = 0;
  for (const o of ops) if (typeof o.t === 'number' && o.t > max) max = o.t;
  return max + 1;
}

/**
 * 以 (t, a, id) 全序排序 → dedupe by id。**與 `core/reduce.ts` 既有的 `orderOps`
 * 是同一條規則的兩份實作**（那份只認 `Op`，這份泛型化只認 `OpBase`）——
 * 兩者刻意不共用同一份程式碼（見本檔頂端的說明），但規則本身必須逐字相同，
 * 否則兩個實體的收斂性各自漂移，正是 commit 463343d 那類 bug 的成因。
 */
export function orderOps<T extends OpBase>(ops: readonly T[]): readonly T[] {
  // 排序必須在 dedupe 之前：union merge 會保留同 id 但內容不同的兩行（spike T3），
  // 若先 dedupe 就等於「保留檔案裡的第一個」，收斂性隨即取決於行的順序。
  const seen = new Set<string>();
  return [...ops]
    .sort((x, y) => x.t - y.t || cmp(x.a, y.a) || cmp(x.id, y.id))
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 把一條黏合行拆回原本的多個 op 文字，不是黏合行時回傳 null。
 * 同 `ops.ts` 的 `splitGluedLine` ——不含 `OpBase` 型別參數，因為它只需要
 * 「這一段本身是不是一個合法的 op 物件」，不需要知道具體欄位形狀。
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
