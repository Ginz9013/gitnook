import type { Op } from './ops.js';

/** 八個固定 Status。不可自訂 —— 見 decision legacyRef 0003（`nook decision show 0003`）。 */
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
  /** 可見性，與 done/cancelled 所表達的工作結果正交 —— 見 decision legacyRef 0003（`nook decision show 0003`）。 */
  readonly archived: boolean;
  /** 已被刪除。與 archived 同一種東西（LWW boolean），差別全在讀取端 —— 見 decision legacyRef 0009（`nook decision show 0009`）。 */
  readonly deleted: boolean;
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
  readonly deleted?: boolean;
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
  /** fs 與 git 對「這塊 board 共享了嗎」給出不同的答案 —— 三種狀態共用一個 kind。 */
  | 'SharingMismatch'
  | 'NotAGitRepo'
  | 'GluedLine'
  | 'UnparsableLine'
  | 'UnknownOp'
  /** `.gitnook/config.json` 存在但無法解析（不是合法 JSON，或不是物件）。 */
  | 'InvalidNookConfig';

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
   * 一張 Issue 的 Op-log 原文。
   *
   * 這是 Board 上**唯一**交出 Op 的地方，而且是唯讀的 —— 寫入端仍然只有
   * Change（CONTEXT.md：呼叫端永遠不接觸 Op）。之所以要有它：`description`
   * 是 LWW，兩個 Actor 並行編輯時摺疊只留一份，敗方的文字完整躺在檔案裡卻
   * 沒有任何介面拿得回來（v1 spec 的 Risks 記為已知缺口）。`get()` 回答
   * 「現在是什麼」，這裡回答「曾經被寫過什麼、誰寫的」。
   */
  opLog(ref: string): readonly Op[];
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
  /**
   * 這塊 board 的根目錄（含 `.issues/` 的那一層）的絕對路徑。
   *
   * 尋根是**向上**找，所以這個值與呼叫端交給 `openBoard({ dir })` 的目錄可以
   * 不一樣 —— 從子目錄開的 board，根仍然是含 `.issues/` 的那一層。呼叫端因此
   * 不必（也不該）自己再尋一次根：那會讓「這塊 board 在哪裡」有兩個真相來源，
   * 而兩者只在剛好從根目錄開的時候才一致。
   *
   * 同其餘公開呼叫，board 目錄消失時拋 `BoardNotInitialized` 而不是回一個
   * 過期的路徑。
   */
  root(): string;
  health(): Diagnostic[];
}

export interface OpenBoardOptions {
  readonly dir?: string;
  readonly actor?: string;
  readonly ids?: IdSource;
}

export class BoardNotInitialized extends Error {
  /**
   * `ceiling` 是向上尋根搜尋到的終點。訊息刻意保持單行 —— CLI 把它整條
   * 寫到 stderr，換行會被讀成「有兩個問題要修」。
   */
  constructor(dir: string, ceiling?: string) {
    super(
      ceiling === undefined
        ? `not a Nook board: ${dir} (run nook init first)`
        : `not a Nook board: ${dir}` +
          ` (searched up to ${ceiling} without finding .issues/issues/; run nook init at the project root)`,
    );
    this.name = 'BoardNotInitialized';
  }
}

export class RefNotFound extends Error {
  constructor(ref: string) {
    super(`issue not found: ${ref}`);
    this.name = 'RefNotFound';
  }
}

export class AmbiguousRef extends Error {
  constructor(ref: string, readonly candidates: readonly string[]) {
    super(`prefix ${ref} matches ${candidates.length} issues: ${candidates.join(', ')}`);
    this.name = 'AmbiguousRef';
  }
}

/** 跨 board 操作要求完整 ULID（spec.md Non-goals）：ref 不是完整 26 碼時拋這個。 */
export class IncompleteRef extends Error {
  constructor(readonly ref: string) {
    super(`incomplete ref: ${ref} (cross-board operations require the full 26-character ULID, no short prefixes)`);
    this.name = 'IncompleteRef';
  }
}

/** `locateInWorkspace()` 掃過全部成員都沒找到這個 ref。 */
export class RefNotFoundInWorkspace extends Error {
  constructor(readonly ref: string, readonly searchedCount: number) {
    super(`ref not found in any of ${searchedCount} members: ${ref}`);
    this.name = 'RefNotFoundInWorkspace';
  }
}

/**
 * 同一個 ref 同時存在於多個成員 —— 資料完整性問題（通常是檔案被手動複製
 * 造成），`locateInWorkspace()` 只負責清楚報錯、不猜、不自動選一個。
 */
export class AmbiguousWorkspaceRef extends Error {
  constructor(readonly ref: string, readonly memberPaths: readonly string[]) {
    super(`ref ${ref} exists in ${memberPaths.length} members at once: ${memberPaths.join(', ')}`);
    this.name = 'AmbiguousWorkspaceRef';
  }
}

/** `memberAt()` 解析出來的 Board 根目錄不在這個 workspace 的 members 裡。 */
export class NotAWorkspaceMember extends Error {
  constructor(readonly resolvedRoot: string, readonly workspaceRoot: string) {
    super(`${resolvedRoot} is not a member found under workspace ${workspaceRoot}`);
    this.name = 'NotAWorkspaceMember';
  }
}

/** 對一張已刪的 Issue 寫入。復原（`{ deleted: false }`）不在此列 —— decision legacyRef 0009（`nook decision show 0009`）。 */
export class IssueDeleted extends Error {
  constructor(readonly ref: string) {
    super(`issue already deleted: ${ref}`);
    this.name = 'IssueDeleted';
  }
}

export class InvalidStatus extends Error {
  constructor(value: string) {
    super(`not a valid status: ${value} (available: ${STATUSES.join(', ')})`);
    this.name = 'InvalidStatus';
  }
}

/**
 * 遞迴掃描檔案系統找出的一塊子 Board。純粹是觀察的角度 —— 不建立任何新的
 * 儲存或狀態，`board` 完全維持自己的獨立性（見 CONTEXT.md 的 Workspace 詞條）。
 */
export interface WorkspaceMember {
  /** 絕對路徑，同 Board.root()。 */
  readonly path: string;
  /** `openBoard({ dir: path })` 的產物。 */
  readonly board: Board;
}

/**
 * 從一個根目錄往下遞迴掃描找到的一組 Board，供跨 Board 檢視（列表、篩選、
 * 健康檢查）之用 —— 不合併任何 Op-log，見 ADR-0012。
 */
export interface Workspace {
  /** 依 path 字典序排序。 */
  readonly members: readonly WorkspaceMember[];
  root(): string;
}

export interface OpenWorkspaceOptions {
  /** 預設 process.cwd()。 */
  readonly dir?: string;
}

