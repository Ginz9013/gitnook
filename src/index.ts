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
 * - `SetOp` 等 `Op` 的各個成員。discriminated union 的縮小（`o.op === 'set'`）
 *   不需要成員的名字，而每多一個名字就多凍結一份儲存格式的細節。
 *
 * 這些都補得回來 —— 新增匯出不會破壞任何人。反過來就不成立。
 *
 * 刻意**在**此的一個新面孔：型別 `Op`。它是 `Board.opLog()` 的回傳值，而那個
 * 方法一上公開面，Op 的形狀就已經是相容承諾了 —— 藏起名字並不會少欠一分，
 * 只會讓呼叫端包不住它。同 `ServeOptions` 的理由。
 */
export { openBoard } from './core/board.js';
export { initBoard, ConflictingGitAttributes, NestedBoard } from './core/gitattributes.js';
export { diagnose, repair } from './core/health.js';
export { serve, PortInUse } from './server/serve.js';
export {
  STATUSES,
  BoardNotInitialized,
  RefNotFound,
  AmbiguousRef,
  InvalidStatus,
} from './core/types.js';

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
} from './core/types.js';
export type { Repair } from './core/health.js';
/** `board.opLog()` 交出的東西。唯讀 —— 寫入端仍然只有 Change。 */
export type { Op } from './core/ops.js';
/** `serve()` 的簽章要能被呼叫端命名，否則它等於只能被呼叫、不能被包裝。 */
export type { Studio, ServeOptions } from './server/serve.js';
