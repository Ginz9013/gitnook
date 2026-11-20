import { DECISION_OP_KINDS } from './decisionOps.js';
import { OP_KINDS } from './ops.js';

/**
 * 一個 Container（`.gitnook/`）裡的一種 Op-log —— Issue 或 Decision。
 *
 * 這是「容器裡有哪些 Op-log」這件事的**唯一**清單。Container（`container.ts`）
 * 逐一走它來 init、share、檢查零衝突保證、逐行診斷與修復；`sharing.ts` 走它來
 * 探測 index 與 ignore。日後第三種實體只需要在 `OP_LOG_MODULES` 加一筆。
 *
 * 為什麼是獨立的葉節點、而不是放在 `container.ts`：`sharing.ts` 也需要這份清單，
 * 而 `container.ts` 依賴 `sharing.ts`。兩者互相 import 時頂層常數的求值順序由
 * 打包器決定（`cli/decision.ts` 記錄過的那一種 bug），葉節點讓這條環不存在。
 *
 * merge 規則與 sample 路徑都由 `path` **推導**，不手寫 —— 兩者原本各自是一個
 * 手打的常數，必須靠人記得對齊。每個模組仍然各自一條規則，不合併成一條 glob：
 * 兩個獨立的零衝突保證（ADR-0001）。
 */
export interface OpLogModule {
  /** 相對於 board 根目錄的 marker 目錄，路徑片段形式（給 `join` 用）。 */
  readonly dir: readonly string[];
  /** 同一個目錄，一律以 `/` 拼成的字串（給 git pathspec 與 `Diagnostic.file` 用）。 */
  readonly path: string;
  /** 這個模組在 `.gitattributes` 裡的那一行。 */
  readonly rule: string;
  /** 一條真實形狀的 op-log 路徑 —— 問「新的 op-log 檔會不會拿到 merge=union」用。 */
  readonly sample: string;
  /** reducer 認得的 op 種類；其餘的會被 doctor 回報為 UnknownOp（ADR-0001 硬規則 2）。 */
  readonly opKinds: ReadonlySet<string>;
}

function opLogModule(name: string, opKinds: ReadonlySet<string>): OpLogModule {
  const dir = ['.gitnook', name] as const;
  const path = dir.join('/');
  return {
    dir,
    path,
    rule: `${path}/*.ndjson merge=union`,
    sample: `${path}/01JBX7A9Q3.ndjson`,
    opKinds,
  };
}

export const ISSUES_MODULE: OpLogModule = opLogModule('issues', OP_KINDS);
export const DECISIONS_MODULE: OpLogModule = opLogModule('decisions', DECISION_OP_KINDS);

/** 容器裡的全部 Op-log 模組。順序就是 init / share / doctor 說話的順序。 */
export const OP_LOG_MODULES: readonly OpLogModule[] = [ISSUES_MODULE, DECISIONS_MODULE];

/** Issue 的 marker 目錄 —— `findBoardRoot`、`openBoard` 認的就是它。 */
export const ISSUES_DIR = ISSUES_MODULE.dir;
/** Decision 的 marker 目錄 —— `findDecisionRoot`、`openDecisionLog` 認的就是它。 */
export const DECISIONS_DIR = DECISIONS_MODULE.dir;
