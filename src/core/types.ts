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
  readonly status?: Status;
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
  readonly status?: string;
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
