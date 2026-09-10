import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Workspace, WorkspaceMember } from '../core/types.js';
import { serve } from './serve.js';
import type { ServeOptions, Studio } from './serve.js';

/**
 * 同 `serve.ts`：只綁 loopback，理由完全相同（ADR-0007）—— landing page
 * 本身雖然唯讀，但它是每個子 studio（可寫）的入口，沒有理由開一個更寬的洞。
 */
const HOST = '127.0.0.1';

/** 一個成員連結的 HTML，含它的絕對路徑與 `/launch/<n>`。 */
function memberRow(n: number, member: WorkspaceMember): string {
  const path = escapeHtml(member.path);
  return `<li><a href="/launch/${n}">${path}</a></li>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * landing page 本體 —— 手寫 HTML，不是 studio 的 React bundle（ticket 04 的
 * 設計取捨：landing 只需要列連結，換一套前端框架換不回什麼）。
 */
function renderLanding(workspace: Workspace): string {
  const rows = workspace.members.map((member, n) => memberRow(n, member)).join('\n');
  const body =
    workspace.members.length === 0
      ? '<p>沒有偵測到任何 Board。</p>'
      : `<ul>\n${rows}\n</ul>`;
  return `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>nook workspace</title></head>
<body>
<h1>nook workspace</h1>
${body}
</body>
</html>`;
}

/**
 * `serveWorkspace(workspace, opts?)` —— 一個小型 landing HTTP server：
 * `GET /` 列出全部成員（路徑 + 連結）；`GET /launch/<n>` 第一次被點時才呼叫
 * 既有、未經修改的 `serve(members[n].board)`（各自獨立 ephemeral port），
 * 然後 302 redirect 過去；重複點擊重用已啟動的那一個，不重複開 port。
 *
 * **為什麼不用 path-prefix 掛載**：studio 前端的 fetch 是寫死的 root-relative
 * path（`/api/board`、`/i/<ref>`），把多個 Board 掛在同一個 origin 的不同
 * 路徑下會讓所有子看板撞同一組 API path —— 每個成員各自一個 port 是唯一不必
 * 改前端就能做到的形狀。
 *
 * `opts.port` 只用在 landing server 自己；`opts.assetsDir`（若有）原樣轉給
 * 每一個子 `serve()` —— 同一份前端資產目錄，理由同 `serve.ts` 的 `assetsDir`
 * （測試用，不必真的跑一次 vite build）。
 *
 * `close()` 一併關掉 landing server 與所有已經啟動過的子 studio —— 包含
 * 呼叫當下仍在啟動中的那些，不會漏掉正在進行中的 `/launch/<n>`。
 */
export function serveWorkspace(workspace: Workspace, opts: ServeOptions = {}): Promise<Studio> {
  const port = opts.port ?? 0;
  // 子 studio 一律用系統指派的 ephemeral port（design contract：`--port` 只
  // 指定 landing server 自己的 port）——彼此不衝突，也不會撞 landing 自己
  // 選定的那個 port。
  const childOpts: ServeOptions = opts.assetsDir === undefined ? { port: 0 } : { port: 0, assetsDir: opts.assetsDir };

  // n → 已啟動（或正在啟動）的子 studio。記的是 Promise 本身，不是等到之後
  // 才存進去 —— 兩個幾乎同時打進來的 /launch/<n> 都要看到同一個 in-flight
  // 的呼叫，否則第二個請求會在第一個 serve() 還沒 resolve 之前又呼叫一次。
  const launched = new Map<number, Promise<Studio>>();

  function launch(n: number, member: WorkspaceMember): Promise<Studio> {
    const existing = launched.get(n);
    if (existing !== undefined) return existing;
    const started = serve(member.board, childOpts);
    launched.set(n, started);
    return started;
  }

  const server = createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    if (method !== 'GET') {
      res.writeHead(405, { allow: 'GET' });
      res.end();
      return;
    }

    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderLanding(workspace));
      return;
    }

    const match = /^\/launch\/(\d+)$/.exec(url);
    if (match !== null) {
      const n = Number(match[1]);
      const member = workspace.members[n];
      if (member === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('沒有這個成員');
        return;
      }
      void launch(n, member).then(
        (studio) => {
          res.writeHead(302, { location: studio.url });
          res.end();
        },
        (err: unknown) => {
          // `serve()` 不是全函數（同 handleRequest 的差異）：它的 listen 可能因
          // EMFILE/EACCES 這類與 port 衝突無關的理由被拒絕（`port: 0` 只排除了
          // EADDRINUSE 這一種）。這裡若不接住，就是一個沒人接的 rejection——
          // 當場整個 landing process 死掉，連帶拖走所有已經啟動的子 studio。
          const message = err instanceof Error ? err.message : String(err);
          console.error(`nook workspace studio: 啟動成員 ${member.path} 的 studio 失敗 —— ${message}`);
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`啟動這個成員的 studio 失敗：${message}`);
        },
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  return new Promise<Studio>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: HOST, port }, () => {
      server.removeListener('error', reject);
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://${HOST}:${address.port}`,
        close: async () => {
          // 已經啟動（或正在啟動）的子 studio 全部一併關掉 —— 包含仍在
          // 進行中的那些，close() 的呼叫端不必自己知道哪些成員被點過。
          const children = await Promise.all(launched.values());
          await Promise.all(children.map((child) => child.close()));

          if (!server.listening) return;
          server.closeAllConnections();
          await new Promise<void>((done, fail) => {
            server.close((err) => (err === undefined || err === null ? done() : fail(err)));
          });
        },
      });
    });
  });
}
