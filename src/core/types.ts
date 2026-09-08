/** 八個固定 Status。不可自訂 —— 見 docs/adr/0003。 */
export const STATUSES = [
  'backlog',
  'todo',
  'queued',
  'in_progress',
  'review',
  'blocked',
  'done',
  'cancelled',
] as const;

export type Status = (typeof STATUSES)[number];

/**
 * 接受完整值或無歧義前綴（`in_p` → `in_progress`），同 git 的 short hash。
 * 撞號或無對應時拋出 InvalidStatus —— 絕不猜測。
 */
export function resolveStatus(value: string): Status {
  if ((STATUSES as readonly string[]).includes(value)) return value as Status;

  const matches = STATUSES.filter((s) => s.startsWith(value));
  if (matches.length !== 1) throw new InvalidStatus(value);
  return matches[0]!;
}

export interface Comment {
  readonly id: string;
  readonly actor: string;
  readonly t: number;
  readonly body: string;
}

/** 一張 Issue 的狀態，即其 Op-log 摺疊後的結果。 */
export interface Issue {
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  readonly description: string;
  readonly labels: readonly string[];
  /** 可見性，與 done/cancelled 所表達的工作結果正交 —— 見 docs/adr/0003。 */
  readonly archived: boolean;
  readonly comments: readonly Comment[];
}

export interface CreateInput {
  readonly title: string;
  readonly description?: string;
  readonly labels?: readonly string[];
  /** 同 Change.status：接受完整值或無歧義前綴。 */
  readonly status?: Status | string;
}

/**
 * 呼叫端表達的意圖。Board 負責把它翻譯成一個或多個 Op ——
 * 呼叫端永遠不接觸 Op。
 */
export interface Change {
  readonly title?: string;
  readonly description?: string;
  readonly status?: Status | string;
  readonly archived?: boolean;
  readonly labels?: { readonly add?: readonly string[]; readonly remove?: readonly string[] };
  readonly comment?: string;
}

export interface Filter {
  /** 預設隱藏 archived、done、cancelled；true 則全部回傳。 */
  readonly all?: boolean;
  /** 接受完整值或無歧義前綴。明確指定時，done/cancelled 不再被預設隱藏。 */
  readonly status?: string;
  /** 收斂條件（AND）：只回傳同時掛有全部指定 label 者。 */
  readonly labels?: readonly string[];
}

export type DiagnosticKind =
  | 'MissingMergeDriver'
  | 'NotAGitRepo'
  | 'GluedLine'
  | 'UnparsableLine'
  | 'UnknownOp';

export interface Diagnostic {
  readonly kind: DiagnosticKind;
  readonly file?: string;
  readonly line?: number;
  readonly message: string;
}

/** 非確定性的識別碼來源。測試注入種子化版本以取得可重現的輸出。 */
export interface IdSource {
  ulid(): string;
}

export interface Board {
  create(input: CreateInput): Issue;
  get(ref: string): Issue;
  /**
   * 整塊 Board 上每一張 Issue 的**完整** Ref，已排序。
   *
   * 只列目錄，**不摺疊任何 Op-log** —— 算短 Ref 的顯示長度只需要一串 Ref，
   * 而 `list({ all: true })` 會把整塊 Board 摺一遍，那會打破「show 只讀它
   * 要的那一張」的效能保證。同時，長度必須對整塊 Board 算而不是對過濾後的
   * 子集算，否則 `list` 印出的 Ref 會被 `get` 判為有歧義。
   */
  refs(): readonly string[];
  list(filter?: Filter): Issue[];
  apply(ref: string, change: Change): Issue;
  health(): Diagnostic[];
}

export interface OpenBoardOptions {
  readonly dir?: string;
  readonly actor?: string;
  readonly ids?: IdSource;
}

export class BoardNotInitialized extends Error {
  constructor(dir: string) {
    super(`不是一個 Nook board：${dir}（先執行 nook init）`);
    this.name = 'BoardNotInitialized';
  }
}

export class RefNotFound extends Error {
  constructor(ref: string) {
    super(`找不到 issue：${ref}`);
    this.name = 'RefNotFound';
  }
}

export class AmbiguousRef extends Error {
  constructor(ref: string, readonly candidates: readonly string[]) {
    super(`前綴 ${ref} 對應到 ${candidates.length} 張 issue：${candidates.join(', ')}`);
    this.name = 'AmbiguousRef';
  }
}

export class InvalidStatus extends Error {
  constructor(value: string) {
    super(`不是合法的 status：${value}（可用：${STATUSES.join(', ')}）`);
    this.name = 'InvalidStatus';
  }
}

export class NotImplemented extends Error {
  constructor(what: string) {
    super(`${what} 尚未實作`);
    this.name = 'NotImplemented';
  }
}
