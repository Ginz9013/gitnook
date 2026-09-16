import { join } from 'node:path';
import type { DecisionOp } from './decisionOps.js';
import type { Diagnostic } from './types.js';
import type { LegacyLayout } from './gitattributes.js';

/**
 * 四個固定 Disposition。不可自訂——同 `Status` 之於 Issue，但這是完全不同的
 * 語意軸（CONTEXT.md 的 Disposition 詞條）：Status 問「工作流走到哪」，
 * Disposition 問「定案了沒」。
 */
export const DISPOSITIONS = ['proposed', 'accepted', 'superseded', 'rejected'] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * 接受完整值或無歧義前綴，同 `resolveStatus`（`core/types.ts`）的規則 ——
 * 撞號或無對應時拋出 `InvalidDisposition`，絕不猜測。這是一份獨立的實作，
 * 不重用 `resolveStatus`：兩者的值域完全不同，硬共用只會需要一個「這是哪一種
 * 值域」的參數，那樣的共用函式比兩份各自四行的實作更複雜。
 */
export function resolveDisposition(value: string): Disposition {
  if ((DISPOSITIONS as readonly string[]).includes(value)) return value as Disposition;

  const matches = DISPOSITIONS.filter((d) => d.startsWith(value));
  if (matches.length !== 1) throw new InvalidDisposition(value);
  return matches[0]!;
}

/** 一個 Decision 的狀態，即其 Op-log 摺疊後的結果。 */
export interface Decision {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly disposition: Disposition;
  /** 指向另一個 Decision 的 ref。只驗證形狀不驗證存在（spec.md Non-goals）。 */
  readonly supersededBy?: string;
  /** 遷移用的歷史欄位，只在票 07 遷移既有 12 篇 ADR 時標記一次，新建的
   * Decision 永遠不會有它（spec.md Domain decisions）。 */
  readonly legacyRef?: string;
}

export interface CreateDecisionInput {
  readonly title: string;
  readonly body?: string;
  /** 同 DecisionChange.disposition：接受完整值或無歧義前綴。未指定時預設 `proposed`。 */
  readonly disposition?: Disposition | string;
}

/**
 * 呼叫端表達的意圖。DecisionLog 負責把它翻譯成一個或多個 DecisionOp ——
 * 呼叫端永遠不接觸 Op（同 Board 的 `Change`）。
 */
export interface DecisionChange {
  readonly title?: string;
  readonly body?: string;
  readonly disposition?: Disposition | string;
  readonly supersededBy?: string;
  readonly legacyRef?: string;
}

/** `list()` 的篩選條件。目前只有 disposition——票 02 的 `nook decision list --disposition <d>` 用它。 */
export interface DecisionFilter {
  readonly disposition?: string;
}

/**
 * Decision 的集合，一個 repo 一份 —— 同 `Board` 之於 Issue，但刻意不共用
 * `Board`/`DecisionLog` 的泛型介面：欄位驗證規則差異真實存在（`IssueDeleted`
 * 檢查、label add-wins 完全是 Decision 用不到的東西），硬統一會製造假接縫
 * （spec.md Design contract）。
 */
export interface DecisionLog {
  create(input: CreateDecisionInput): Decision;
  get(ref: string): Decision;
  list(filter?: DecisionFilter): Decision[];
  /** 整塊 Decision Log 上每一個 Decision 的完整 Ref，已排序。同 `Board.refs()`。 */
  refs(): readonly string[];
  apply(ref: string, change: DecisionChange): Decision;
  /** 一個 Decision 的 Op-log 原文，唯讀。同 `Board.opLog()`，供票 04 的 history 用。 */
  opLog(ref: string): readonly DecisionOp[];
  /** 這個 Decision Log 的根目錄（含 `.decisions/` 的那一層）的絕對路徑。 */
  root(): string;
  health(): Diagnostic[];
}

export interface OpenDecisionLogOptions {
  readonly dir?: string;
  readonly actor?: string;
  readonly ids?: { ulid(): string };
}

export class DecisionLogNotInitialized extends Error {
  /**
   * 對稱於 `BoardNotInitialized`（`core/types.ts`）—— 同一份措辭結構，同一份
   * `legacy` 提示邏輯（票 03），只是 marker 換成 `.gitnook/decisions/`。
   * `nook decision init` 已經被票 01 移除，這裡不再提它，唯一的初始化入口是
   * `nook init`。
   */
  constructor(dir: string, ceiling?: string, legacy?: LegacyLayout) {
    super(
      ceiling === undefined
        ? `not a Nook decision log: ${dir} (run nook init first)`
        : `not a Nook decision log: ${dir}` +
          ` (searched up to ${ceiling} without finding .gitnook/decisions/; run nook init at the project root)` +
          legacyMoveHint(legacy),
    );
    this.name = 'DecisionLogNotInitialized';
  }
}

/**
 * 同 `core/types.ts` 的 `legacyMoveHint`——各自一份薄包裝，理由見那邊的註解。
 * 兩份逐字相同：`BoardNotInitialized`/`DecisionLogNotInitialized` 對稱處理同
 * 一種提示，不因為呼叫端是哪一個模組而有第二種措辭。
 */
function legacyMoveHint(legacy: LegacyLayout | undefined): string {
  if (legacy === undefined) return '';
  const moves: string[] = [];
  if (legacy.issues) {
    moves.push(`git mv "${join(legacy.dir, '.issues', 'issues')}" "${join(legacy.dir, '.gitnook', 'issues')}"`);
  }
  if (legacy.decisions) {
    moves.push(
      `git mv "${join(legacy.dir, '.decisions', 'decisions')}" "${join(legacy.dir, '.gitnook', 'decisions')}"`,
    );
  }
  if (moves.length === 0) return '';
  return ` — found a legacy layout at ${legacy.dir}, run: ${moves.join(' && ')}`;
}

export class DecisionNotFound extends Error {
  constructor(ref: string) {
    super(`decision not found: ${ref}`);
    this.name = 'DecisionNotFound';
  }
}

export class AmbiguousDecisionRef extends Error {
  constructor(ref: string, readonly candidates: readonly string[]) {
    super(`prefix ${ref} matches ${candidates.length} decisions: ${candidates.join(', ')}`);
    this.name = 'AmbiguousDecisionRef';
  }
}

export class InvalidDisposition extends Error {
  constructor(value: string) {
    super(`not a valid disposition: ${value} (available: ${DISPOSITIONS.join(', ')})`);
    this.name = 'InvalidDisposition';
  }
}
