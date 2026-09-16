import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { openWorkspace } from '../../src/core/workspace.js';
import { serveWorkspace } from '../../src/server/serveWorkspace.js';
import type { Studio } from '../../src/server/serve.js';

// ADR-0004：真實 HTTP server、真實 fetch、真實 port —— 沿用 test/server/serve.test.ts 的手法。
let root: string;
// 共用資源紀律：一律綁 port 0，並在 afterEach 確實 close()。
const open: Studio[] = [];

/** 每個用例自己的假 `dist/studio/` —— 不依賴真的建置產物（同 serve.test.ts）。 */
let assets: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nook-serve-workspace-'));
  assets = mkdtempSync(join(tmpdir(), 'nook-serve-workspace-assets-'));
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
  rmSync(root, { recursive: true, force: true });
  rmSync(assets, { recursive: true, force: true });
});

function member(...parts: string[]): string {
  const dir = join(root, ...parts);
  mkdirSync(join(dir, '.gitnook', 'issues'), { recursive: true });
  return dir;
}

async function start(opts: { port?: number } = {}): Promise<Studio> {
  const workspace = openWorkspace({ dir: root });
  const studio = await serveWorkspace(workspace, { port: 0, assetsDir: assets, ...opts });
  open.push(studio);
  return studio;
}

describe('serveWorkspace — landing 頁列出全部成員', () => {
  it('GET / 列出全部偵測到的成員路徑與連結', async () => {
    member('pkgs', 'a');
    member('pkgs', 'b');

    const studio = await start();
    const res = await fetch(`${studio.url}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain(join(root, 'pkgs', 'a'));
    expect(html).toContain(join(root, 'pkgs', 'b'));
    expect(html).toContain('/launch/0');
    expect(html).toContain('/launch/1');
  });

  it('空 workspace 時印出「沒有偵測到任何 Board」一類的訊息，而不是空白頁或錯誤', async () => {
    const studio = await start();
    const res = await fetch(`${studio.url}/`);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('No boards detected');
  });
});

describe('serveWorkspace — /launch/<n> 啟動既有 serve() 並轉址', () => {
  it('第一次點擊 302 轉址到一個真的可用的 serve() studio', async () => {
    member('pkgs', 'a');
    const studio = await start();

    const res = await fetch(`${studio.url}/launch/0`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // 落地之後是一個正常運作的 serve() studio —— 讀寫都走既有 handler.ts。
    const board = await (await fetch(`${location}/api/board`)).json();
    expect(board.issues).toEqual([]);
  });

  it('落地的子 studio 在 /api/board-info 上回報自己是 workspace 成員', async () => {
    member('pkgs', 'a');
    const studio = await start();

    const res = await fetch(`${studio.url}/launch/0`, { redirect: 'manual' });
    const location = res.headers.get('location');
    const info = (await (await fetch(`${location}/api/board-info`)).json()) as { fromWorkspace: boolean };

    expect(info.fromWorkspace).toBe(true);
  });

  it('兩次點同一個成員的連結，落在同一個 port 上 —— 不重複啟動第二個 serve() 實例', async () => {
    member('pkgs', 'a');
    const studio = await start();

    const first = await fetch(`${studio.url}/launch/0`, { redirect: 'manual' });
    const second = await fetch(`${studio.url}/launch/0`, { redirect: 'manual' });

    expect(second.headers.get('location')).toBe(first.headers.get('location'));
  });

  it('close() 之後 landing server 與已啟動的子 studio 的 port 都真的釋放', async () => {
    member('pkgs', 'a');
    const studio = await start();
    const res = await fetch(`${studio.url}/launch/0`, { redirect: 'manual' });
    const childUrl = res.headers.get('location')!;
    const landingPort = Number(new URL(studio.url).port);
    const childPort = Number(new URL(childUrl).port);

    await studio.close();

    await expect(fetch(`${studio.url}/`)).rejects.toThrow();
    await expect(fetch(`${childUrl}/`)).rejects.toThrow();

    // 下一次 listen 同一個 port 不撞 EADDRINUSE —— 兩個 port 都真的釋放了。
    for (const port of [landingPort, childPort]) {
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen({ host: '127.0.0.1', port }, resolve);
      });
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    }
  });
});
