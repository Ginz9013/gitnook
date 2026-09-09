import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Board, Change, Issue, Status } from '../core/types.js';
import { AmbiguousRef, InvalidStatus, RefNotFound } from '../core/types.js';
import { renderMarkdown } from '../render/html.js';

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
const ASSETS_PREFIX = '/assets/';
const ISSUE_PREFIX = '/i/';

function html(body: string): StudioResponse {
  return { status: 200, headers: { 'content-type': HTML }, body };
}

function json(payload: unknown): StudioResponse {
  return { status: 200, headers: { 'content-type': JSON_TYPE }, body: JSON.stringify(payload) };
}

function notFound(message = 'not found'): StudioResponse {
  return { status: 404, headers: { 'content-type': TEXT }, body: `${message}\n` };
}

function badRequest(message: string): StudioResponse {
  return { status: 400, headers: { 'content-type': TEXT }, body: `${message}\n` };
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

/** 這一頁只插入一個本機路徑，但逸出仍然發生在插入標籤之前（同 html.ts 的模型）。 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
  readonly title: string;
  readonly status: Status;
  readonly labels: readonly string[];
  readonly archived: boolean;
  /** 原文，供編輯用。 */
  readonly description: string;
  /** renderMarkdown 的產物，已安全。 */
  readonly descriptionHtml: string;
  readonly comments: readonly CommentView[];
}

function toIssueView(issue: Issue): IssueView {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    labels: issue.labels,
    archived: issue.archived,
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
  return { issues: board.list({ all: true }).map(toIssueView), hash: boardHash(board) };
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
 * 特別是 `blocked` **不在這裡強制配留言**：CLI 是提醒而非拒絕，server 多一條
 * CLI 沒有的規則只會讓兩個介面分歧。
 *
 * ref 原樣交給 core：前綴解析、大小寫正規化與路徑穿越檢查只有一份實作，
 * 就是 `board` 自己那一份。
 */
function applyChange(board: Board, ref: string, body: string): StudioResponse {
  const change = parseChange(body);
  if (change === undefined) return badRequest('body 必須是一份 Change 的 JSON 物件');

  try {
    return json(toIssueView(board.apply(ref, change)));
  } catch (err) {
    // 解析不出來的 Ref 是「這個 URL 沒有對應的東西」，不是伺服器錯誤 ——
    // 沿用讀取面既有的對應。有歧義時把候選原樣送出去：猜一張來寫是
    // append-only 之下最貴的錯，事後只能再寫一筆蓋回去。
    if (err instanceof RefNotFound || err instanceof AmbiguousRef) return notFound(err.message);
    // 呼叫端送了一個不是 Status 的值 —— 這是請求的問題，不是找不到東西。
    if (err instanceof InvalidStatus) return badRequest(err.message);
    throw err;
  }
}

export function handleRequest(
  board: Board,
  req: StudioRequest,
  opts: HandlerOptions = {},
): StudioResponse {
  // 手動切掉 query string，不走 new URL() —— 後者會把 `..` 正規化掉，
  // 使路徑穿越在到達 /assets/ 的守衛之前就消失，而那個守衛正是這一層要證明的。
  const path = req.url.split('?')[0]!;

  // ADR-0007 解除了「無任何寫入路徑」的契約，但白名單是**收窄而非移除**：
  // 多出來的只有 `POST /i/<ref>`。方法檢查仍然放在路由之前 —— 「哪些路徑
  // 存在」不該決定「能不能寫」，所以 POST 到一個不存在的路徑是 405 而不是
  // 404：不存在的路徑不會因為不存在就變得可寫。
  const writable = path.startsWith(ISSUE_PREFIX);
  if (req.method !== 'GET' && !(req.method === 'POST' && writable)) {
    // Allow 講的是這個資源支援什麼（RFC 9110），所以兩條路徑答案不同：
    // `/i/<ref>` 只收 POST（伺服器渲染的詳情頁在票 01 就沒了），其餘只收 GET。
    const allow = writable ? 'POST' : 'GET';
    return {
      status: 405,
      headers: { 'content-type': TEXT, allow },
      body: `${path} 只接受 ${allow}\n`,
    };
  }

  if (req.method === 'POST') {
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

  if (path === HASH_PATH) {
    return { status: 200, headers: { 'content-type': TEXT }, body: boardHash(board) };
  }

  return notFound();
}
