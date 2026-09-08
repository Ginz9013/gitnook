import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createServer } from 'node:http';
import { openBoard } from '../../src/index.js';
import type { Board, CreateInput, IdSource, Issue } from '../../src/index.js';
import { serve, PortInUse, DEFAULT_PORT } from '../../src/server/serve.js';
import type { Studio } from '../../src/server/serve.js';

// ADR-0004：真實檔案系統、真實 socket。每個測試用例一個 mkdtemp 的 board。
let dir: string;
// 共用資源紀律：一律綁 port 0 由 OS 指派，不得硬編碼 port。
const open: Studio[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-serve-'));
  mkdirSync(join(dir, '.issues', 'issues'), { recursive: true });
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
  rmSync(dir, { recursive: true, force: true });
});

const fullId = (prefix: string): string => prefix.padEnd(26, '0');

function seeded(issueId: string): IdSource {
  let n = 0;
  return { ulid: () => (n++ === 0 ? issueId : issueId.slice(0, 8) + String(n).padStart(18, '0')) };
}

const board = (): Board => openBoard({ dir, actor: 'test' });

const createWith = (issueId: string, input: CreateInput): Issue =>
  openBoard({ dir, actor: 'test', ids: seeded(issueId) }).create(input);

async function start(opts: { port?: number } = {}): Promise<Studio> {
  const studio = await serve(board(), { port: 0, ...opts });
  open.push(studio);
  return studio;
}

describe('serve', () => {
  it('回傳 { url, close }，url 可用，close() 之後連線被拒', async () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    const studio = await start();

    expect(studio.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const res = await fetch(`${studio.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await res.text()).toContain('Fix login redirect');

    await studio.close();
    await expect(fetch(`${studio.url}/`)).rejects.toThrow();

    // 關兩次不得拋出：CLI 會在 SIGINT 與正常結束兩條路徑上都呼叫它。
    await expect(studio.close()).resolves.toBeUndefined();
  });
});

type Reach = 'open' | 'refused';

/** 對某個位址開一條 TCP 連線，只回報「接得上」或「被拒」。 */
function probe(host: string, port: number): Promise<Reach> {
  return new Promise<Reach>((resolve, reject) => {
    const socket = connect({ host, port });
    const finish = (r: Reach): void => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => finish('open'));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH') return finish('refused');
      socket.destroy();
      reject(err);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`probe ${host}:${port} 逾時 —— 無法分辨是被拒還是被丟棄`));
    });
  });
}

/** 本機第一個非 loopback 的 IPv4 位址。 */
function externalIPv4(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return undefined;
}

/** 綁 0.0.0.0 的對照組：證明探測本身在這台機器上真的能連到外部介面。 */
function listenOnAllInterfaces(): Promise<{ port: number; close: () => void }> {
  const control = createServer((_req, res) => res.end('control'));
  return new Promise((resolve) => {
    control.listen({ host: '0.0.0.0', port: 0 }, () => {
      const { port } = control.address() as { port: number };
      resolve({ port, close: () => control.close() });
    });
  });
}

describe('只綁 127.0.0.1', () => {
  it('IPv6 loopback（::1）連不上 —— 綁的是 127.0.0.1，不是「本機」', async () => {
    const studio = await start();
    const port = Number(new URL(studio.url).port);

    expect(await probe('127.0.0.1', port)).toBe('open');
    expect(await probe('::1', port)).toBe('refused');
  });

  it('本機的對外 IPv4 介面上連不上', async () => {
    const ip = externalIPv4();
    if (ip === undefined) {
      throw new Error('這台機器沒有非 loopback 的 IPv4 介面，本測試無法分辨任何事');
    }

    const studio = await start();
    const port = Number(new URL(studio.url).port);

    // 對照組先跑：如果連綁 0.0.0.0 的 server 都連不到，那下面那條斷言
    // 只是在證明環境把封包擋掉了，什麼也沒證明。
    const control = await listenOnAllInterfaces();
    try {
      expect(await probe(ip, control.port), `對照組 ${ip}:${control.port} 連不上`).toBe('open');
      expect(await probe(ip, port)).toBe('refused');
    } finally {
      control.close();
    }
  });
});

describe('port', () => {
  it('opts.port 覆寫預設值', async () => {
    const studio = await start({ port: 0 });

    // 測試一律綁 port 0 由 OS 指派 —— 覆寫若沒生效，這裡會是 DEFAULT_PORT。
    expect(Number(new URL(studio.url).port)).not.toBe(DEFAULT_PORT);
    expect(Number(new URL(studio.url).port)).toBeGreaterThan(0);
  });

  it('port 被佔用時給出清楚的錯誤，而不是把系統錯誤原樣丟出來', async () => {
    const taken = Number(new URL((await start()).url).port);

    const err: unknown = await serve(board(), { port: taken }).then(
      (s) => {
        open.push(s);
        return new Error('預期要失敗，卻成功綁上了已被占用的 port');
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(PortInUse);
    const message = (err as Error).message;
    // 使用者看得懂，而且知道下一步該做什麼。
    expect(message).toContain(String(taken));
    expect(message).toContain('--port');
    // 不把 errno 與系統呼叫細節推到使用者臉上。
    expect(message).not.toContain('EADDRINUSE');
    expect(message).not.toContain('listen');
  });
});

/**
 * 直接寫 HTTP 到 socket 上。fetch 與瀏覽器都會在送出之前把 `..` 正規化掉，
 * 因此只有原始 request line 才問得出「server 面對未正規化的路徑會怎樣」。
 */
function rawRequest(url: string, requestLine: string): Promise<string> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(port) });
    let out = '';
    socket.setTimeout(2000);
    socket.on('data', (chunk) => (out += chunk.toString('utf8')));
    socket.on('end', () => resolve(out));
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('raw request 逾時'));
    });
    socket.write(`${requestLine}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  });
}

describe('線上（wire）行為', () => {
  it('未經正規化的穿越路徑在真實連線上同樣是 404，不是 500 也不是檔案內容', async () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    // board 目錄上方的誘餌 .ndjson —— 曾經真的讀得到的就是這條路徑。
    writeFileSync(
      join(dir, 'OUTSIDE.ndjson'),
      JSON.stringify({ id: fullId('01JBXZ'), t: 1, a: 'attacker', op: 'create', title: 'LEAKED FROM OUTSIDE' }) + '\n',
      'utf8',
    );
    const studio = await start();

    for (const target of [
      '/i/../../../etc/passwd',
      '/i/../../OUTSIDE',
      '/i/..%2f..%2fetc%2fpasswd',
    ]) {
      const raw = await rawRequest(studio.url, `GET ${target} HTTP/1.1`);
      expect(raw, target).toMatch(/^HTTP\/1\.1 404 /);
      expect(raw, target).not.toContain('root:');
      expect(raw, target).not.toContain('LEAKED FROM OUTSIDE');
      expect(raw, target).not.toContain('Fix login redirect');
    }
  });

  it('寫入型方法在真實連線上被拒為 405', async () => {
    const studio = await start();

    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await fetch(`${studio.url}/`, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow'), method).toBe('GET');
    }
  });
});
