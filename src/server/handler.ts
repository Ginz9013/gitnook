import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveActor } from '../core/actor.js';
import { shortIdLength } from '../core/ids.js';
import type { SetKey } from '../core/ops.js';
import { fieldWrites } from '../core/reduce.js';
import type { Board, Change, Diagnostic, Issue, Status } from '../core/types.js';
import { AmbiguousRef, InvalidStatus, IssueDeleted, RefNotFound } from '../core/types.js';
import { escapeHtml, renderMarkdown } from '../render/html.js';

/**
 * 純請求處理器。刻意不接觸 node:http —— 路由與回應在不綁 port 的情況下即可測試，
 * serve.ts 只負責把它接上 socket。
 */
export interface StudioRequest {
  readonly method: string;
  readonly url: string;
  /** 請求主體。只有 `POST /i/<ref>` 會看它，內容是一份 `Change` 的 JSON。 */
  readonly body?: string;
}

export interface StudioResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const HASH_PATH = '/hash';
const API_BOARD_PATH = '/api/board';
const API_ISSUES_PATH = '/api/issues';
const API_BOARD_INFO_PATH = '/api/board-info';
const API_HISTORY_PREFIX = '/api/history/';
const ASSETS_PREFIX = '/assets/';
const ISSUE_PREFIX = '/i/';

function html(body: string): StudioResponse {
  return { status: 200, headers: { 'content-type': HTML }, body };
}

function json(payload: unknown): StudioResponse {
  return { status: 200, headers: { 'content-type': JSON_TYPE }, body: JSON.stringify(payload) };
}

/** 201：這次請求造出了一個之前不存在的資源（RFC 9110）。 */
function created(payload: unknown): StudioResponse {
  return { status: 201, headers: { 'content-type': JSON_TYPE }, body: JSON.stringify(payload) };
}

function notFound(message = 'not found'): StudioResponse {
  return { status: 404, headers: { 'content-type': TEXT }, body: `${message}\n` };
}

/** 405 的唯一形狀。Allow 講的是這個資源支援什麼（RFC 9110）。 */
function methodNotAllowed(path: string, allow: string): StudioResponse {
  return { status: 405, headers: { 'content-type': TEXT, allow }, body: `${path} 只接受 ${allow}\n` };
}

function badRequest(message: string): StudioResponse {
  return { status: 400, headers: { 'content-type': TEXT }, body: `${message}\n` };
}

/**
 * 那張 Issue 曾經在，現在被刪了。**410 而不是 404** —— 兩者對 client 是不同的
 * 下一步：404 說的是「你的 ref 打錯了」，410 說的是「ref 沒錯，這張沒了」，
 * 而後者正是 SPA 要用來把卡片從畫面上收掉的訊號（ADR-0009）。
 */
function gone(message: string): StudioResponse {
  return { status: 410, headers: { 'content-type': TEXT }, body: `${message}\n` };
}

/**
 * 兜底的 500。**只送 message，不送 `err.stack`** —— 堆疊講的是 nook 的內部
 * 結構，對讀者（就是跑 `nook studio` 的那個人）沒有一個字是可行動的，而
 * 「board 目錄不見了，先執行 nook init」有。同 missingAssetsPage 的模型：
 * 訊息裡的本機路徑沒有外洩對象，因為只綁 loopback（ADR-0007）。
 *
 * 非 Error 的擲出物不做猜測 —— 沒有 message 可信，就不要假裝有。
 */
function serverError(err: unknown): StudioResponse {
  const message = err instanceof Error ? err.message : '伺服器內部錯誤';
  return { status: 500, headers: { 'content-type': TEXT }, body: `${message}\n` };
}

/**
 * 當前 board 狀態的指紋。ADR-0002：沒有快取也沒有版本戳，每次就是全量掃描
 * 加摺疊 —— 500 張 Issue 14ms，每 2 秒問一次的成本趨近於零。
 *
 * 涵蓋 all: true，因為 archived 與 done 的變動同樣是「畫面要重畫」的變動。
 */
export function boardHash(board: Board): string {
  return createHash('sha256').update(JSON.stringify(board.list({ all: true }))).digest('hex');
}

/**
 * SPA 的殼。**沒有任何 board 資料** —— 它是一個常數字串，`GET /` 因此不掃描
 * 任何東西，資料一律走 `/api/board`。
 *
 * 資產檔名固定（不帶內容雜湊）：studio 只服務 loopback 上的一個人，快取破壞
 * 買不到任何東西，而固定檔名讓這份殼是純函數 —— 不必先建置才測得動。
 */
const SHELL =
  `<!doctype html>\n<html lang="en">\n<head>\n` +
  `<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
  `<title>Nook</title>\n` +
  `<link rel="stylesheet" href="/assets/studio.css">\n` +
  `</head>\n<body>\n<div id="root"></div>\n` +
  `<script type="module" src="/assets/studio.js"></script>\n` +
  `</body>\n</html>\n`;

/**
 * 打包後的前端資產所在處：套件根目錄底下的 `dist/studio/`。
 *
 * 從本模組往上找最近的 package.json 而不是寫死相對路徑 —— 原始碼是
 * `src/server/`、打包後是 `dist/cli/`，兩者到根目錄的深度不同，寫死的
 * `../..` 只會有一邊對。
 *
 * 快取的是**路徑**，不是檔案內容：資產本身每次請求都重讀（ADR-0008）。
 */
let cachedAssetsDir: string | undefined;

export function studioAssetsDir(): string {
  if (cachedAssetsDir !== undefined) return cachedAssetsDir;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) break;
    const parent = dirname(dir);
    // 找到檔案系統根都沒有 package.json：不猜，就用當下這一層。
    // 目錄不在的話，`GET /` 會送出說得出下一步的訊息頁。
    if (parent === dir) break;
    dir = parent;
  }
  cachedAssetsDir = join(dir, 'dist', 'studio');
  return cachedAssetsDir;
}

/**
 * 服務得出去的副檔名，以及它們的 content-type。
 *
 * 白名單而非黑名單：漏列一個副檔名只是少一個功能，多放行一個是一條讀檔路徑。
 * 全部都是文字格式 —— StudioResponse.body 是 string，二進位資產（字型、圖片）
 * 會被 utf8 解碼靜靜地毀掉，所以乾脆不讓它們存在：studio 用系統字型，
 * icon 走 lucide 的 inline SVG。
 */
const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': JSON_TYPE,
  '.svg': 'image/svg+xml; charset=utf-8',
};

/**
 * 一個資產請求。**在 request 當下才從磁碟讀**（ADR-0008）—— bundle 一旦被
 * 當成模組或字串 import，每一次 `nook list` 都要多 parse 400KB。
 *
 * 檔名不得含任何路徑結構：`/assets/` 之後只能是一個平坦的檔名。`..`、`/`、
 * 以及跳脫後才現形的分隔符都因此在拼路徑之前就被擋掉，而不是靠事後比對
 * 正規化過的絕對路徑 —— 後者每加一個平台就多一種寫錯的方式。
 */
function asset(assetsDir: string, name: string): StudioResponse {
  const decoded = safeDecode(name);
  if (decoded === undefined || !/^[A-Za-z0-9._-]+$/.test(decoded) || decoded.startsWith('.')) {
    return notFound();
  }

  const ext = decoded.slice(decoded.lastIndexOf('.'));
  const type = ASSET_TYPES[ext];
  if (type === undefined) return notFound();

  try {
    return { status: 200, headers: { 'content-type': type }, body: readFileSync(join(assetsDir, decoded), 'utf8') };
  } catch {
    // 不存在、是目錄、讀不到 —— 對呼叫端都是同一件事：這個 URL 沒有東西。
    return notFound();
  }
}

/** `%2e%2e%2f` 這類跳脫要先還原才看得見，但壞掉的跳脫不該變成例外。 */
function safeDecode(name: string): string | undefined {
  try {
    return decodeURIComponent(name);
  } catch {
    return undefined;
  }
}

/**
 * 前端資產不在的時候送的那一頁。只有從原始碼跑而忘了建置的人會看到它 ——
 * 出貨的 tarball 裡 `dist/studio/` 一定在。
 *
 * 目錄路徑照實印出來：「找不到資產」而不說是哪一個目錄，等於要對方自己
 * 去猜我們往哪裡找。路徑是本機的，沒有外洩對象 —— 讀者就是跑它的那個人。
 */
function missingAssetsPage(assetsDir: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<title>Nook studio —— 前端資產尚未建置</title>\n` +
    `</head>\n<body>\n` +
    `<h1>studio 的前端資產不在</h1>\n` +
    `<p>找不到：<code>${escapeHtml(assetsDir)}</code></p>\n` +
    `<p>先執行 <code>npm run build</code>，再重新啟動 <code>nook studio</code>。</p>\n` +
    `</body>\n</html>\n`
  );
}

export interface CommentView {
  readonly id: string;
  readonly actor: string;
  readonly t: number;
  /** 原文，供編輯與比對用。 */
  readonly body: string;
  /** renderMarkdown 的產物，已安全。 */
  readonly bodyHtml: string;
}

/**
 * SPA 眼中的一張 Issue。`Issue` 本身**不因為有了前端而改變** —— 這是一個
 * 檢視模型，加的是 client 自己算不出來（或算了會不安全）的東西。
 */
export interface IssueView {
  readonly id: string;
  /**
   * 顯示用的短 Ref。長度對**整塊 board** 算，且**整份快照共用一個** ——
   * 見 displayLength()。client 拿不到 board.refs()，所以它算不出這個值。
   */
  readonly shortId: string;
  readonly title: string;
  readonly status: Status;
  readonly labels: readonly string[];
  readonly archived: boolean;
  /**
   * 已被刪除。`board.list()` 從來不交出這種 Issue，所以快照裡它一律是 false ——
   * 這一格是為了寫入的回印：client 收到 `deleted: true` 的 ACK 才知道要把那張
   * 從快照上拿掉，而不是拿回應蓋回那一格（ADR-0009）。
   */
  readonly deleted: boolean;
  /** 原文，供編輯用。 */
  readonly description: string;
  /** renderMarkdown 的產物，已安全。 */
  readonly descriptionHtml: string;
  readonly comments: readonly CommentView[];
}

/**
 * 短 Ref 的顯示長度，對整塊 board 算一次（同 cli/run.ts 的 displayLength）。
 *
 * 不是對單張、也不是對正要送出的那個子集算：ULID 前綴編的是時間的高位，
 * 前 6 碼每 17.5 分鐘才變一次（ADR-0006），`shortIdLength([issue.id])` 因此
 * 一律回下限 6 —— 那個前綴在整塊 board 上可能對應到幾十張。而短 Ref 正是
 * 使用者接著要拿去當 Ref 用的東西，解析是對整塊 board 做的，所以算短了
 * 印出來的東西會被 `get` 判為有歧義。
 *
 * 來源是 `board.refs()`：它就是解析所看的那一串識別碼，而且只列目錄、不摺疊
 * Op-log，所以一次寫入的回印也付得起。
 */
function displayLength(board: Board): number {
  return shortIdLength(board.refs());
}

function toIssueView(issue: Issue, shortIdLen: number): IssueView {
  return {
    id: issue.id,
    shortId: issue.id.slice(0, shortIdLen),
    title: issue.title,
    status: issue.status,
    labels: issue.labels,
    archived: issue.archived,
    deleted: issue.deleted,
    description: issue.description,
    descriptionHtml: renderMarkdown(issue.description),
    // 不重排：Issue.comments 已由 reduce() 以 (t, a, id) 全序產出。
    comments: issue.comments.map((c) => ({
      id: c.id,
      actor: c.actor,
      t: c.t,
      body: c.body,
      bodyHtml: renderMarkdown(c.body),
    })),
  };
}

/**
 * SPA 的一次讀取。快照與它的指紋一起送 —— 兩次請求拿到的會是兩個不同時刻的
 * board，client 就無從知道自己手上的快照對應哪一版。
 */
export interface BoardSnapshot {
  readonly issues: readonly IssueView[];
  readonly hash: string;
}

function boardSnapshot(board: Board): BoardSnapshot {
  // all: true —— archived 是可見性欄位（ADR-0003），由 client 決定藏不藏；
  // done 與 cancelled 是看板上實際存在的兩欄，被預設過濾掉就永遠是空的。
  const len = displayLength(board);
  return { issues: board.list({ all: true }).map((i) => toIssueView(i, len)), hash: boardHash(board) };
}

/**
 * 開場抓一次的那份東西：這塊 board 在磁碟上的位置。
 *
 * **與快照分開，而且只在開場抓一次。** `board.health()` 會 spawn 子行程 ——
 * 一個 `git rev-parse`，而在 private board 上還多一個 `git ls-files`（`diagnose`
 * 要確認那塊被排除的 board 是不是其實已經共享出去了）。摺進 `/api/board` 等於
 * 每次全量讀取都付這筆帳 —— 而快照在 ACK 落空時還會被重抓。
 *
 * （刻意不寫行號：上一版寫了 health.ts:167，一次改動就讓它指到別的地方。）
 */
export interface BoardInfo {
  /** board 的絕對路徑。同時開兩個 repo 的 studio 時，這是唯一分得出來的東西。 */
  readonly root: string;
  /**
   * 目前的分支，**說不出來時是 `null` 而不是一個錯誤**：nook 不強制在 git repo
   * 裡跑（`doctor` 只是把 `NotAGitRepo` 當成一條 Diagnostic 回報），detached HEAD
   * 也是一個正常的工作狀態。兩者都只是「這一格沒有東西可寫」。
   */
  readonly branch: string | null;
  /**
   * 經由 studio 產生的每一個 op 都記在這個 Actor 身上（ADR-0007）。同一份
   * 推導（`deriveActor`），不是第二份 —— 畫面上寫著的必須就是 op-log 上記著的。
   */
  readonly actor: string;
  /**
   * `board.health()` 的產物，原樣送出去。**這裡不做第二份判斷** —— 哪些東西
   * 算 Diagnostic 只有 `diagnose()` 一份定義，header 只是把它畫出來（票 B4）。
   */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * 目前的分支名。try/catch 包住整個子行程，比照 health.ts:167 既有的寫法 ——
 * 不是 repo、git 不在 PATH、HEAD 還沒有第一次提交，對這一格都是同一件事。
 *
 * `--abbrev-ref` 在 detached HEAD 上印的是字面上的 `HEAD`，那不是分支名，
 * 所以一併收成 `null`：畫面上寫著「分支：HEAD」比留白更難懂。
 */
function currentBranch(dir: string): string | null {
  try {
    const name = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return name === '' || name === 'HEAD' ? null : name;
  } catch {
    return null;
  }
}

function boardInfo(board: Board): StudioResponse {
  // 路徑向 `Board` 要，不在這裡另尋一次根 —— 尋根是向上找，所以 board 從子目錄
  // 開起來的時候，「呼叫端給的目錄」與「這塊 board 的根」是兩個不同的答案，而
  // 錯的那一個看起來完全正常。branch 與 actor 都對這個值算，四個欄位因此必然
  // 描述同一個目錄（票 B8）。
  const root = board.root();
  const info: BoardInfo = {
    root,
    branch: currentBranch(root),
    actor: deriveActor(root),
    diagnostics: board.health(),
  };
  return json(info);
}

/**
 * 一次對 LWW 欄位的寫入。`Op` 本身不外送 —— 這是一個檢視模型，欄位名照
 * studio 的說法（`field`／`value`）而不是儲存格式的 `k`／`v`。
 */
export interface WriteView {
  readonly field: SetKey;
  readonly value: string | boolean;
  readonly actor: string;
  readonly t: number;
}

export interface IssueHistory {
  readonly writes: readonly WriteView[];
}

/**
 * 一張 Issue 的變更歷史。`description` 是 LWW，兩個 Actor 並行編輯時摺疊只留
 * 一份，敗方的文字仍然完整躺在 op-log 裡 —— 這條端點就是把它撈回來的路。
 *
 * 篩選走 core 的 `fieldWrites`，**與 `nook history` 是同一份**：`create` op 就是
 * title 的第一次寫入，這裡自己濾 `op === 'set'` 的那份寫法會讓每一張 Issue 的
 * 原始標題不在面板裡（票 B9）。抄一份過來就是第三份會漂開的實作。
 *
 * **不另寫一份排序**：`board.opLog()` 交出來的已經是 `orderOps` 的全序
 * （board.ts:113），而 `fieldWrites` 沿用傳進去的順序，所以畫面上的順序必然
 * 與 Issue 被摺出來的順序一致。
 *
 * **已刪的 Issue 照樣讀得到**，而且是 200：`opLog` 對它照常（ADR-0009），
 * 那正是誤刪的救生索 —— drawer 的刪除確認框就是這樣答應使用者的。
 */
function issueHistory(board: Board, ref: string): StudioResponse {
  try {
    const writes: WriteView[] = fieldWrites(board.opLog(ref)).map((op) => ({
      field: op.k,
      value: op.v,
      actor: op.a,
      t: op.t,
    }));
    const payload: IssueHistory = { writes };
    return json(payload);
  } catch (err) {
    // 沿用 applyChange 既有的對應：解析不出來的 Ref 是「這個 URL 沒有對應的
    // 東西」，不是伺服器錯誤；有歧義時把候選原樣送出去。
    if (err instanceof RefNotFound || err instanceof AmbiguousRef) return notFound(err.message);
    throw err;
  }
}

export interface HandlerOptions {
  /**
   * 前端資產的所在目錄。預設是套件自己的 `dist/studio/`；測試傳入自己造的
   * 假目錄，因此不必先跑一次 vite build 才測得動。
   */
  readonly assetsDir?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  // 陣列也是 object，而 `["queued"]` 絕不是一份 Change。
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** `Change.labels` 的形狀：只有 add 與 remove，兩者都是字串陣列。 */
function isLabelEdit(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(([k, v]) => (k === 'add' || k === 'remove') && isStringArray(v))
  );
}

/**
 * `Change` 每個欄位的形狀。逐欄列出而不是信任 `as Change` —— JSON 來自網路，
 * 型別斷言在執行期什麼都不檢查。
 */
const CHANGE_SHAPE: Readonly<Record<string, (value: unknown) => boolean>> = {
  title: (v) => typeof v === 'string',
  description: (v) => typeof v === 'string',
  status: (v) => typeof v === 'string',
  archived: (v) => typeof v === 'boolean',
  deleted: (v) => typeof v === 'boolean',
  labels: isLabelEdit,
  comment: (v) => typeof v === 'string',
};

/**
 * 把請求主體解讀成一份 Change，形狀不符時回傳 undefined。
 *
 * 不認得的欄位一律拒絕，而不是忽略：append-only 之下沒有「被拒絕的寫入」
 * 可以事後翻查（ADR-0007），一個打錯的欄位名若被靜靜吃掉，呼叫端看到的是
 * 200 加上一張沒有變化的 Issue —— 那是最難查的一種失敗。
 */
function parseChange(body: string): Change | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  for (const [key, value] of Object.entries(parsed)) {
    const shaped = CHANGE_SHAPE[key];
    if (shaped === undefined || !shaped(value)) return undefined;
  }
  return parsed as Change;
}

/**
 * 一次寫入。端點直接鏡射 `board.apply(ref, change)` —— `Change` 已經是領域裡
 * 「呼叫端表達的意圖」的型別（CONTEXT.md），studio 因此不發明任何新詞彙。
 * 端點不對任何 Status 附加額外條件。`blocked` 曾經有一條「必須同時留下說明
 * 原因的 Comment」的規則，而它在三個介面上實作成三種行為（studio 擋下、
 * CLI 只提醒、這裡完全不管）—— 那條規則已經整條移除（ADR-0003）：狀態不該
 * 帶有額外效果。這裡因此沒有什麼要「保持一致」的，八個 Status 一視同仁。
 *
 * ref 原樣交給 core：前綴解析、大小寫正規化與路徑穿越檢查只有一份實作，
 * 就是 `board` 自己那一份。
 */
function applyChange(board: Board, ref: string, body: string): StudioResponse {
  const change = parseChange(body);
  if (change === undefined) return badRequest('body 必須是一份 Change 的 JSON 物件');

  try {
    return json(toIssueView(board.apply(ref, change), displayLength(board)));
  } catch (err) {
    // 解析不出來的 Ref 是「這個 URL 沒有對應的東西」，不是伺服器錯誤 ——
    // 沿用讀取面既有的對應。有歧義時把候選原樣送出去：猜一張來寫是
    // append-only 之下最貴的錯，事後只能再寫一筆蓋回去。
    if (err instanceof RefNotFound || err instanceof AmbiguousRef) return notFound(err.message);
    // 呼叫端送了一個不是 Status 的值 —— 這是請求的問題，不是找不到東西。
    if (err instanceof InvalidStatus) return badRequest(err.message);
    // 已刪的 Issue 上的寫入被 core 擋下（復原除外）。這不是找不到，也不是
    // 請求寫錯 —— 是那張 Issue 不再接受寫入。
    if (err instanceof IssueDeleted) return gone(err.message);
    throw err;
  }
}

/**
 * `POST /api/issues` 收得的欄位。**`description` 與 `labels` 刻意不收** ——
 * 表單只填標題，端點不該提供一個沒有呼叫端的能力；要補描述就是接著一次
 * `POST /i/<ref>`。
 */
const CREATE_FIELDS: ReadonlySet<string> = new Set(['title', 'status']);

/**
 * 一次新增。新增是這一批唯一新增的端點 —— 建立的時候還沒有 ref 可以放進 URL，
 * 所以它不可能走 `POST /i/<ref>`。
 */
function createIssue(board: Board, body: string): StudioResponse {
  // 不是 JSON，與是 JSON 但不是物件（`3`、`"x"`、`[]`），對呼叫端是同一件事，
  // 所以它們回同一句話 —— 而那句話只寫一次：解析失敗收斂成一個接不住 isRecord
  // 的值，兩條路在下一行匯合。手抄第二份的下場是有一天只改到其中一份。
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (!isRecord(parsed)) return badRequest('body 必須是一份 JSON 物件');

  // 不認得的欄位一律拒絕，而不是忽略 —— 同 parseChange。被靜靜吃掉的欄位換來
  // 的是 201 加上一張少了東西的 Issue，而 append-only 之下沒有「被拒絕的寫入」
  // 可以事後翻查（ADR-0007）。
  for (const key of Object.keys(parsed)) {
    if (!CREATE_FIELDS.has(key)) return badRequest(`不認得的欄位：${key}（只收 title 與 status）`);
  }

  // 標題是唯一的必填欄位，而且空白不算：一張沒有標題的 Issue 在板上是看不懂的
  // 一列空白，而 append-only 之下它刪不掉，只能再寫一次 op 蓋過去。
  const title = parsed['title'];
  if (typeof title !== 'string' || title.trim() === '') {
    return badRequest('title 必須是非空字串');
  }

  // status 原樣交給 core：前綴解析（`rev` → `review`）與合法性只有一份實作，
  // 就是 resolveStatus 那一份。這裡只確認它是個字串。
  const status = parsed['status'];
  if (status !== undefined && typeof status !== 'string') {
    return badRequest('status 必須是字串');
  }

  try {
    const issue = board.create(status === undefined ? { title } : { title, status });
    return created(toIssueView(issue, displayLength(board)));
  } catch (err) {
    // 呼叫端送了一個不是 Status 的值 —— 這是請求的問題，不是伺服器錯誤。
    // 同 applyChange 的對應：狀態碼的決定權集中在這個檔案裡。
    if (err instanceof InvalidStatus) return badRequest(err.message);
    throw err;
  }
}

/**
 * 一個請求，一份回應。**這是一個全函數（total function）：任何輸入都回得出
 * 一份 StudioResponse，一個例外都不往上拋。**
 *
 * 兜底放在這裡而不是 serve.ts 的 callback 外圍，是刻意的取捨：
 *
 * 1. **狀態碼的決定權集中在一處。** 404（RefNotFound / AmbiguousRef）、
 *    400（InvalidStatus、非法 body）、405（方法白名單）全都在這個檔案裡；
 *    把「其餘一律 500」搬到 serve.ts，會讓「這個請求會拿到什麼」這個問題
 *    必須讀兩個檔案才答得出來，而下一個新的 core 例外要對應到哪一層也就
 *    多了一個可以吵的地方。代價是 500 成為本模組新的回應詞彙 —— 划算。
 * 2. **例外在它產生的那一格就變成值。** serve.ts 是
 *    `readBody(req).then(onOk, onErr)`，onOk 跑在後來的一個 tick 上，所以
 *    包在 `createServer` callback 外圍的 try/catch 一個字都接不到 ——
 *    它會變成 unhandled rejection，也就是**整個 process 當場結束**。
 *    在這裡接住，那條路徑就不存在，而不是靠再包一層 `.catch` 補救。
 * 3. **純函數性質不變。** try/catch 不碰 node:http，這條兜底因此在不綁 port
 *    的情況下測得動（見 handler.test.ts），也保護 serve.ts 以外的呼叫端。
 */
export function handleRequest(
  board: Board,
  req: StudioRequest,
  opts: HandlerOptions = {},
): StudioResponse {
  try {
    return route(board, req, opts);
  } catch (err) {
    // 認得的例外在 applyChange 裡就已經對應完畢（404 / 400）；走到這裡的
    // 一律是「沒預期到」—— 例如 session 進行中 board 目錄被移走。
    return serverError(err);
  }
}

function route(board: Board, req: StudioRequest, opts: HandlerOptions): StudioResponse {
  // 手動切掉 query string，不走 new URL() —— 後者會把 `..` 正規化掉，
  // 使路徑穿越在到達 /assets/ 的守衛之前就消失，而那個守衛正是這一層要證明的。
  const path = req.url.split('?')[0]!;

  // ADR-0007 解除了「無任何寫入路徑」的契約，但白名單是**收窄而非移除**：
  // 多出來的只有 `POST /i/<ref>` 與 `POST /api/issues` 兩條。方法檢查仍然放在
  // 路由之前 —— 「哪些路徑存在」不該決定「能不能寫」，所以 POST 到一個不存在
  // 的路徑是 405 而不是 404：不存在的路徑不會因為不存在就變得可寫。
  //
  // `/api/issues` 用**完全相等**比對，不是 startsWith：白名單只有短而精確才
  // 守得住上面那條性質，前綴比對會讓 `/api/issues/foo` 一併變成可寫。
  const writable = path.startsWith(ISSUE_PREFIX) || path === API_ISSUES_PATH;
  if (req.method !== 'GET' && !(req.method === 'POST' && writable)) {
    // 兩條路徑答案不同：可寫的那些只收 POST（`/i/<ref>` 伺服器渲染的詳情頁已經
    // 移除，讀取一律走 `/api/board`），其餘只收 GET。
    return methodNotAllowed(path, writable ? 'POST' : 'GET');
  }

  // `/api/issues` 是一條**只收 POST** 的路徑，GET 它因此是 405 而不是 404 ——
  // 那條路徑存在，只是不收這個方法。`/i/<ref>` 不走這條：它的 GET 是一個曾經
  // 存在、後來移除掉的讀取面，仍然回 404。
  if (req.method === 'GET' && path === API_ISSUES_PATH) return methodNotAllowed(path, 'POST');

  if (req.method === 'POST') {
    if (path === API_ISSUES_PATH) return createIssue(board, req.body ?? '');
    return applyChange(board, path.slice(ISSUE_PREFIX.length), req.body ?? '');
  }

  if (path === '/') {
    // 殼不碰 board。看板的內容一律走 /api/board —— 兩條路徑各渲染一次同一份
    // 資料，遲早會有一邊漏掉往後的修改，而且首頁會白付一次全量掃描。
    const assetsDir = opts.assetsDir ?? studioAssetsDir();
    return html(existsSync(assetsDir) ? SHELL : missingAssetsPage(assetsDir));
  }

  if (path.startsWith(ASSETS_PREFIX)) {
    return asset(opts.assetsDir ?? studioAssetsDir(), path.slice(ASSETS_PREFIX.length));
  }

  if (path === API_BOARD_PATH) {
    return json(boardSnapshot(board));
  }

  // 兩條唯讀端點都住在 `/api/` 底下，**不借用 `/i/`** —— 那個前綴的意思就是
  // 「寫入面」（上面的白名單字面上以它為判準），一條 GET 路徑掛上去就會連帶
  // 變成可 POST 的。ref 也與 `/i/<ref>` 一樣原樣交給 core：形狀檢查與路徑
  // 穿越的防線只有 `board` 那一份。
  if (path === API_BOARD_INFO_PATH) {
    return boardInfo(board);
  }

  if (path.startsWith(API_HISTORY_PREFIX)) {
    return issueHistory(board, path.slice(API_HISTORY_PREFIX.length));
  }

  if (path === HASH_PATH) {
    return { status: 200, headers: { 'content-type': TEXT }, body: boardHash(board) };
  }

  return notFound();
}
