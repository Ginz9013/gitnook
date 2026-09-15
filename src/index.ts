/**
 * 公開面。
 *
 * spec.md 的 Design contract：「`src/index.ts` 公開匯出（僅 openBoard 與型別）」。
 *
 * 對 library-first 的產品，**每一個匯出都是永久的相容負債** —— 加一個是相容的
 * 改動，拿掉一個不是。所以這份清單是刻意列出來的，不是「順手 export 一下讓別
 * 的模組取用」累積出來的結果：同一個 package 內的模組本來就可以直接
 * `import { renderTable } from './render/table.js'`，那條路不必經過公開面。
 *
 * 刻意**不**在此的東西：
 * - 兩個渲染函式（`renderTable`、`renderJson`），以及 server 端的
 *   `renderMarkdown`。它們是呈現，不是領域；`renderTable` 的欄位配置正被 token
 *   預算閘門（ADR-0005）盯著，公開它等於把那個版面凍結成相容承諾。
 * - `handleRequest` 與 `boardHash`。它們是 `serve()` 的內部零件；公開它們會
 *   一併凍結 StudioRequest / StudioResponse 的形狀。
 * - `shortIdLength` / `resolvePrefix` / `normalizeRef` / `isValidRef` /
 *   `SHORT_ID_MIN`。Ref 的解析是 Board 的責任（`board.get()` 收任何無歧義前綴），
 *   呼叫端不需要自己算。
 * - `inspectMergeGuarantee`。`diagnose()` 已經回報同一件事，且格式一致。
 * - `inspectSharing` 與 `opLogsTracked`。同上：Sharing 是推導出來的，而
 *   `diagnose()` 已經把「這塊 board 的共享狀態不一致」說成一條 Diagnostic。
 *   公開它們等於把「怎麼問」也凍結成承諾，而呼叫端要的是答案。
 * - `SetOp` 等 `Op` 的各個成員。discriminated union 的縮小（`o.op === 'set'`）
 *   不需要成員的名字，而每多一個名字就多凍結一份儲存格式的細節。
 *
 * 這些都補得回來 —— 新增匯出不會破壞任何人。反過來就不成立。
 *
 * 刻意**在**此的一個新面孔：型別 `Op`。它是 `Board.opLog()` 的回傳值，而那個
 * 方法一上公開面，Op 的形狀就已經是相容承諾了 —— 藏起名字並不會少欠一分，
 * 只會讓呼叫端包不住它。同 `ServeOptions` 的理由。
 *
 * **Decision 這一批（票 01）比照同一套紀律。** `openDecisionLog` 是它的
 * `openBoard`；`Decision`/`DecisionChange`/`CreateDecisionInput`/
 * `DecisionLog`/`Disposition`/`DISPOSITIONS`/`DecisionFilter`/
 * `OpenDecisionLogOptions` 對應 Issue 那一組型別，理由逐項相同 ——
 * `DecisionLog.opLog()` 一上公開面，`DecisionOp` 的形狀就已經是承諾了，所以
 * 它也在此列。錯誤型別（`DecisionLogNotInitialized`/`DecisionNotFound`/
 * `AmbiguousDecisionRef`/`InvalidDisposition`）同樣公開——`openDecisionLog`
 * 是公開的，它會丟的東西呼叫端必須 `instanceof` 得到，否則只能去比對
 * `err.name` 或訊息字串（同 `ConflictingGitAttributes`/`NestedBoard` 的理由）。
 *
 * 刻意**不**匯出的東西，同 Issue 那一批的理由：
 * - `DecisionOp` 各個成員（`DecisionCreateOp`/`DecisionSetOp`）與
 *   `DECISION_OP_KINDS`。discriminated union 的縮小不需要成員的名字。
 * - `decisionFieldWrites`。它是 `nook decision history`（票 04）與 core 之間
 *   的內部零件，不是呼叫端會直接用到的東西——同 `fieldWrites` 不上公開面
 *   的理由。
 * - `resolveDisposition`。前綴解析是 DecisionLog 的責任（`create`/`apply`/
 *   `list` 都收任何無歧義前綴），呼叫端不需要自己算——同
 *   `resolveStatus` 不上公開面的理由。
 * - `oplog.ts` 的全部匯出（`serialize`/`parseLine`/`splitGluedLine`/
 *   `nextLamport`/`orderOps`）。純粹是 `decisionLog.ts` 的內部零件，同
 *   `ops.ts`/`reduce.ts` 從不上公開面的理由。
 * - `initDecisionRoot`/`findDecisionRoot`。CLI 才需要「尋根/初始化」這兩個
 *   動作本身；library 呼叫端只需要 `openDecisionLog()` 就拿得到一切——同
 *   `findBoardRoot` 不上公開面（只有 `initBoard` 上）的理由，這裡連
 *   `initDecisionRoot` 都先不上，因為目前唯一的消費者是 CLI，等第二個真實
 *   呼叫端出現再決定要不要公開。
 */
export { openBoard } from './core/board.js';
export { openDecisionLog } from './core/decisionLog.js';
export { openWorkspace } from './core/workspace.js';
export { initBoard, ConflictingGitAttributes, NestedBoard } from './core/gitattributes.js';
/**
 * `initBoard(dir, { sharing: 'private' })` 的兩個出口。理由同
 * `ConflictingGitAttributes` / `NestedBoard`：`initBoard` 是公開的，它會丟的
 * 東西呼叫端必須 `instanceof` 得到，否則只能去比對 `err.name` 或訊息字串。
 */
export { AlreadySharedBoard, NoGitDir } from './core/sharing.js';
export { diagnose, repair } from './core/health.js';
export { serve, PortInUse } from './server/serve.js';
export { serveWorkspace } from './server/serveWorkspace.js';
export {
  STATUSES,
  BoardNotInitialized,
  RefNotFound,
  AmbiguousRef,
  InvalidStatus,
  IssueDeleted,
} from './core/types.js';
export {
  DISPOSITIONS,
  DecisionLogNotInitialized,
  DecisionNotFound,
  AmbiguousDecisionRef,
  InvalidDisposition,
} from './core/decisionTypes.js';

export type {
  Board,
  Issue,
  Comment,
  Change,
  CreateInput,
  Filter,
  Status,
  Diagnostic,
  DiagnosticKind,
  IdSource,
  OpenBoardOptions,
  Workspace,
  WorkspaceMember,
  OpenWorkspaceOptions,
} from './core/types.js';
export type {
  Decision,
  DecisionChange,
  CreateDecisionInput,
  DecisionFilter,
  DecisionLog,
  Disposition,
  OpenDecisionLogOptions,
} from './core/decisionTypes.js';
export type { Repair } from './core/health.js';
/** `board.opLog()` 交出的東西。唯讀 —— 寫入端仍然只有 Change。 */
export type { Op } from './core/ops.js';
/** `decisionLog.opLog()` 交出的東西。唯讀，理由同 `Op`。 */
export type { DecisionOp } from './core/decisionOps.js';
/** `serve()` 的簽章要能被呼叫端命名，否則它等於只能被呼叫、不能被包裝。 */
export type { Studio, ServeOptions } from './server/serve.js';
