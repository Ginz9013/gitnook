import { createHash } from 'node:crypto';
import type { Board } from '../core/types.js';
import { AmbiguousRef, RefNotFound } from '../core/types.js';
import { renderBoardHtml, renderIssueHtml } from '../render/html.js';
import type { HtmlOptions } from '../render/html.js';

/**
 * 純請求處理器。刻意不接觸 node:http —— 路由與回應在不綁 port 的情況下即可測試，
 * serve.ts 只負責把它接上 socket。
 */
export interface StudioRequest {
  readonly method: string;
  readonly url: string;
}

export interface StudioResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const ISSUE_PREFIX = '/i/';
const ALLOWED_METHOD = 'GET';
const HASH_PATH = '/hash';
const POLL_INTERVAL_MS = 2000;

function html(body: string): StudioResponse {
  return { status: 200, headers: { 'content-type': HTML }, body };
}

function notFound(message = 'not found'): StudioResponse {
  return { status: 404, headers: { 'content-type': TEXT }, body: `${message}\n` };
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
 * 輪詢重載。ADR-0002 的直接後果：沒有快取、沒有推播、也沒有 WebSocket ——
 * 每 2 秒問一次全量掃描出來的指紋，值變了就整頁重載。500 張 Issue 14ms，
 * 在這個資料規模下笨方法就是正確方法。
 *
 * seed 只會是 sha256 的十六進位字串，故可直接寫進 JS 字面量。
 */
export function pollingScript(seed: string): string {
  return [
    "const seen = '" + seed.replace(/[^0-9a-f]/g, '') + "';",
    'setInterval(async () => {',
    '  try {',
    "    const res = await fetch('/hash');",
    '    if (!res.ok) return;',
    '    if ((await res.text()) !== seen) location.reload();',
    '  } catch {',
    '    // server 收掉了或暫時不通：下一次再問，不要在畫面上留下任何東西。',
    '  }',
    `}, ${POLL_INTERVAL_MS});`,
  ].join('\n');
}

/**
 * 這一次渲染要內嵌的輪詢腳本。種子取自渲染當下的狀態，因此渲染與第一次輪詢
 * 之間發生的變更也會被看到。兩個檢視共用同一份 —— 兩邊各建一次，遲早會有
 * 一邊漏掉往後對輪詢的修改。
 */
function reloadScript(board: Board): HtmlOptions {
  return { inlineScript: pollingScript(boardHash(board)) };
}

export function handleRequest(board: Board, req: StudioRequest): StudioResponse {
  // Nook studio 是唯讀的。方法檢查放在路由之前 —— 「哪些路徑存在」不該
  // 決定「能不能寫」，白名單一個方法就沒有漏列某條寫入路徑的可能。
  if (req.method !== 'GET') {
    return {
      status: 405,
      headers: { 'content-type': TEXT, allow: ALLOWED_METHOD },
      body: `studio 是唯讀的；只接受 ${ALLOWED_METHOD}\n`,
    };
  }

  // 手動切掉 query string，不走 new URL() —— 後者會把 `..` 正規化掉，
  // 使路徑穿越在到達 ref 檢查之前就消失，而那個檢查正是這一層要證明的。
  const path = req.url.split('?')[0]!;

  if (path === '/') {
    // all: true 才拿得到 done 與 cancelled —— 看板上這兩欄是實際存在的欄位，
    // 用 list() 的預設過濾會讓它們永遠是空的。archived 由 renderBoardHtml 負責
    // 隱藏，過濾條件因此只有一份，不在這裡複製一遍。
    return html(renderBoardHtml(board.list({ all: true }), reloadScript(board)));
  }

  if (path === HASH_PATH) {
    return { status: 200, headers: { 'content-type': TEXT }, body: boardHash(board) };
  }

  if (path.startsWith(ISSUE_PREFIX)) {
    // ref 原樣交給 core —— 前綴解析、大小寫、以及形狀檢查都只有一份實作。
    // 解析不出來的 ref 是「這個 URL 沒有對應的東西」，不是伺服器錯誤。
    try {
      // 引數由左至右求值：解析不出來的 ref 在 board.get() 就丟出去了，
      // 404 因此不會白付一次 boardHash 的全量掃描。
      return html(
        renderIssueHtml(board.get(path.slice(ISSUE_PREFIX.length)), reloadScript(board)),
      );
    } catch (err) {
      if (err instanceof RefNotFound) return notFound();
      // 撞號的前綴同樣沒有唯一答案。訊息已含足以區分的候選，原樣轉給讀者 ——
      // 猜其中一張是最糟的選擇。
      if (err instanceof AmbiguousRef) return notFound(err.message);
      throw err;
    }
  }

  return notFound();
}
