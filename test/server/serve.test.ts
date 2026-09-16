import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createServer } from 'node:http';
import { openBoard } from '../../src/index.js';
import type { Board, CreateInput, IdSource, Issue } from '../../src/index.js';
import { serve, serveAutoPort, PortInUse, DEFAULT_PORT } from '../../src/server/serve.js';
import type { Studio } from '../../src/server/serve.js';

// ADR-0004：真實檔案系統、真實 socket。每個測試用例一個 mkdtemp 的 board。
let dir: string;
// 共用資源紀律：一律綁 port 0 由 OS 指派，不得硬編碼 port。
const open: Studio[] = [];

/**
 * 每個用例自己的假 `dist/studio/`。不依賴真的建置產物 —— packed-smoke 會在
 * 測試中途 `tsup --clean` 把 dist/ 清掉，靠它就是 flaky。
 */
let assets: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-serve-'));
  mkdirSync(join(dir, '.gitnook', 'issues'), { recursive: true });
  assets = mkdtempSync(join(tmpdir(), 'nook-serve-assets-'));
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
  rmSync(dir, { recursive: true, force: true });
  rmSync(assets, { recursive: true, force: true });
  // 穿越測試的誘餌落在 assets 的上一層，跟著一起收乾淨。
  rmSync(join(assets, '..', 'SECRET.js'), { force: true });
});

const fullId = (prefix: string): string => prefix.padEnd(26, '0');

function seeded(issueId: string): IdSource {
  let n = 0;
  return { ulid: () => (n++ === 0 ? issueId : issueId.slice(0, 8) + String(n).padStart(18, '0')) };
}

const board = (): Board => openBoard({ dir, actor: 'test' });

const createWith = (issueId: string, input: CreateInput): Issue =>
  openBoard({ dir, actor: 'test', ids: seeded(issueId) }).create(input);

async function start(opts: { port?: number; assetsDir?: string } = {}): Promise<Studio> {
  const studio = await serve(board(), { port: 0, assetsDir: assets, ...opts });
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
    // 送出去的是 SPA 的殼 —— 看板的內容走 /api/board。
    expect(await res.text()).toContain('<div id="root"></div>');

    const snapshot = await (await fetch(`${studio.url}/api/board`)).json();
    expect(snapshot.issues.map((i: { title: string }) => i.title)).toEqual(['Fix login redirect']);

    await studio.close();
    await expect(fetch(`${studio.url}/`)).rejects.toThrow();

    // 關兩次不得拋出：CLI 會在 SIGINT 與正常結束兩條路徑上都呼叫它。
    await expect(studio.close()).resolves.toBeUndefined();
  });

  // 票 04：`lazyDecisionLog` 從這個檔案的私有函式升格成 `decisionLog.ts` 的共用
  // 匯出，serve.ts 改成匯入那份。這裡本來只有 issue 側的真實 HTTP 斷言
  // （上面那個用例），decision 側完全沒有透過 `serve()` 真的送過一次 HTTP
  // 請求——`handler.test.ts` 測的是 `handleRequest()` 直呼，繞過了
  // `serve()` 自己怎麼把 `lazyDecisionLog(board)` 接進 `handleRequest` 那一段
  // 接線。這裡補上，確認搬移沒有在接線層留下破洞。
  it('decision 側同樣走真實 HTTP：GET/POST /api/decisions', async () => {
    mkdirSync(join(dir, '.gitnook', 'decisions'), { recursive: true });
    const studio = await start();

    const empty = await (await fetch(`${studio.url}/api/decisions`)).json();
    expect(empty.decisions).toEqual([]);

    const created = await fetch(`${studio.url}/api/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Adopt trunk-based development' }),
    });
    expect(created.status).toBe(201);

    const snapshot = await (await fetch(`${studio.url}/api/decisions`)).json();
    expect(snapshot.decisions.map((d: { title: string }) => d.title)).toEqual(['Adopt trunk-based development']);
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

describe('serveAutoPort', () => {
  // 這裡是全套件裡唯一綁死 DEFAULT_PORT（而不是 port 0）的地方 —— 沒有別的
  // 辦法：要測的正是「預設 port 被佔用時的行為」，繞不開那個真實的號碼。
  // 若這台機器上剛好已經有一個真的 `nook studio` 佔著 4780，這裡的 start()
  // 會先失敗，訊息會清楚說是哪個 port —— 不是這個測試本身有問題。

  it('預設 port（DEFAULT_PORT）被占用時，自動往上找下一個空位', async () => {
    const blocker = await start({ port: DEFAULT_PORT });
    expect(Number(new URL(blocker.url).port)).toBe(DEFAULT_PORT);

    const studio = await serveAutoPort(board(), { assetsDir: assets });
    open.push(studio);

    expect(Number(new URL(studio.url).port)).toBe(DEFAULT_PORT + 1);
  });

  it('連續好幾個都被占用時，跳過它們找到真正空的那一個', async () => {
    open.push(await start({ port: DEFAULT_PORT }));
    open.push(await start({ port: DEFAULT_PORT + 1 }));
    open.push(await start({ port: DEFAULT_PORT + 2 }));

    const studio = await serveAutoPort(board(), { assetsDir: assets });
    open.push(studio);

    expect(Number(new URL(studio.url).port)).toBe(DEFAULT_PORT + 3);
  });

  it('沒有任何 port 被占用時，就是 DEFAULT_PORT 本身', async () => {
    const studio = await serveAutoPort(board(), { assetsDir: assets });
    open.push(studio);

    expect(Number(new URL(studio.url).port)).toBe(DEFAULT_PORT);
  });

  it('opts.port 是呼叫端自己指定的號碼時，撞到就直接失敗 —— 不自動跳號', async () => {
    const taken = Number(new URL((await start()).url).port);

    const err: unknown = await serveAutoPort(board(), { port: taken, assetsDir: assets }).then(
      (s) => {
        open.push(s);
        return new Error('預期要失敗，卻成功綁上了已被占用的 port');
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(PortInUse);
    expect((err as PortInUse).port).toBe(taken);
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

    // 資產目錄正上方的誘餌 .js —— `/assets/` 是這一版唯一真的讀檔的路徑。
    writeFileSync(join(assets, '..', 'SECRET.js'), 'LEAKED FROM OUTSIDE\n', 'utf8');

    for (const target of [
      '/i/../../../etc/passwd',
      '/i/../../OUTSIDE',
      '/i/..%2f..%2fetc%2fpasswd',
      '/assets/../../../etc/passwd',
      '/assets/../SECRET.js',
      '/assets/..%2fSECRET.js',
    ]) {
      const raw = await rawRequest(studio.url, `GET ${target} HTTP/1.1`);
      expect(raw, target).toMatch(/^HTTP\/1\.1 404 /);
      expect(raw, target).not.toContain('root:');
      expect(raw, target).not.toContain('LEAKED FROM OUTSIDE');
      expect(raw, target).not.toContain('Fix login redirect');
    }
  });

  it('寫入型方法在真實連線上被拒為 405 —— 唯一的例外是 POST /i/<ref>', async () => {
    const studio = await start();

    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await fetch(`${studio.url}/`, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow'), method).toBe('GET');
    }
  });

  it('POST /i/<ref> 在真實連線上把 op 寫進磁碟上的 .ndjson', async () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const studio = await start();
    const hashBefore = await (await fetch(`${studio.url}/hash`)).text();

    const res = await fetch(`${studio.url}/i/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'queued', comment: 'authorised' }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('queued');

    // 回應說寫成功了不算數 —— 磁碟上那一份 op-log 才是事實。
    const ops = readFileSync(join(dir, '.gitnook', 'issues', `${id}.ndjson`), 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(ops.filter((o) => o['op'] === 'set')).toMatchObject([{ k: 'status', v: 'queued' }]);
    expect(ops.at(-1)).toMatchObject({ op: 'comment', body: 'authorised', a: 'test' });

    // 輪詢看得見這次寫入（票 09 的性質）。
    expect(await (await fetch(`${studio.url}/hash`)).text()).not.toBe(hashBefore);
  });

  it('非法的 body 在真實連線上是 400，且不讓 server 掛掉', async () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const studio = await start();

    const bad = await fetch(`${studio.url}/i/${id}`, { method: 'POST', body: 'not json' });
    expect(bad.status).toBe(400);

    // server 還活著：下一個請求照樣被服務。
    expect((await fetch(`${studio.url}/hash`)).status).toBe(200);
  });
});

describe('前端資產', () => {
  it('把 opts.assetsDir 底下的檔案服務在 /assets/ —— 在 request 當下才讀', async () => {
    writeFileSync(join(assets, 'studio.js'), 'const version = 1\n', 'utf8');
    const studio = await start();

    const first = await fetch(`${studio.url}/assets/studio.js`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(await first.text()).toBe('const version = 1\n');

    // server 沒有重啟，磁碟上的內容換了就該送新的：bundle 不是啟動時吸進
    // 記憶體的常數（ADR-0008 的冷啟約束）。
    writeFileSync(join(assets, 'studio.js'), 'const version = 2\n', 'utf8');
    expect(await (await fetch(`${studio.url}/assets/studio.js`)).text()).toBe('const version = 2\n');
  });
});

describe('未預期的例外不得帶掉整個 process', () => {
  it('board 在 server 起來之後被移走：回 500，而且下一個請求仍然有人接', async () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const studio = await start();

    // 先確認這條路徑本來是好的 —— 否則下面的 500 可能根本不是 board 造成的。
    expect((await fetch(`${studio.url}/api/board`)).status).toBe(200);

    // session 進行中 board 目錄被移走：下一次 board.list() 丟 BoardNotInitialized，
    // 而那個 throw 發生在 createServer callback 的 promise 續行裡。
    rmSync(join(dir, '.gitnook'), { recursive: true, force: true });

    expect((await fetch(`${studio.url}/api/board`)).status).toBe(500);

    // 這一行才是這張票的重點：狀態碼誰都答得出來，但 process 死了就沒有下一個回應。
    expect((await fetch(`${studio.url}/api/board`)).status).toBe(500);

    // 而且是「還在服務」而不是「還在但壞了」：board 回來就照常回答。
    mkdirSync(join(dir, '.gitnook', 'issues'), { recursive: true });
    expect((await fetch(`${studio.url}/hash`)).status).toBe(200);
  });
});

/**
 * 攔下全域的 `console.error`。serve.ts 的紀錄管道就是它本身（見該檔的註解），
 * 所以這裡被替身取代的是**那個管道**，不是 serve 內部的任何協作者 ——
 * 與 run.test.ts 攔 `process.stdout.write` 來測 processIo 的作法同一種。
 */
function captureConsoleError(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '));
  });
  return lines;
}

describe('未預期的 500 在終端機上留下痕跡', () => {
  let logged: string[];

  beforeEach(() => {
    logged = captureConsoleError();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('board 在 session 中途被移走：除了那份 500 回應，跑 studio 的終端機也看得到', async () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const studio = await start();

    // 正常的那一次先跑：它不該留下任何東西，否則下面數到的 1 不知道是誰寫的。
    expect((await fetch(`${studio.url}/api/board`)).status).toBe(200);
    expect(logged).toEqual([]);

    rmSync(join(dir, '.gitnook'), { recursive: true, force: true });
    expect((await fetch(`${studio.url}/api/board`)).status).toBe(500);

    expect(logged).toHaveLength(1);
    // 一則看得懂的紀錄 = 讀者認得出「哪一個請求」與「出了什麼事」。
    expect(logged[0]).toContain('500');
    expect(logged[0]).toContain('GET');
    expect(logged[0]).toContain('/api/board');
    // 訊息本身要在，而不是只有一句「有錯誤發生」—— 「先執行 nook init」才是可行動的。
    expect(logged[0]).toContain('nook init');
  });

  it('正常的 4xx 一則都不留 —— 一個每次輪詢都在噴東西的終端機等於沒有紀錄', async () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const studio = await start();

    const post = (ref: string, body: string): Promise<Response> =>
      fetch(`${studio.url}/i/${ref}`, { method: 'POST', body });

    // 404：這個 ref 沒有對應的 Issue。
    expect((await post(fullId('01JBXQ'), JSON.stringify({ status: 'queued' }))).status).toBe(404);
    // 400：body 根本不是 JSON。
    expect((await post(id, 'not json')).status).toBe(400);
    // 400：status 不是一個合法的 Status。
    expect((await post(id, JSON.stringify({ status: 'nope' }))).status).toBe(400);
    // 405：方法不對。
    expect((await fetch(`${studio.url}/`, { method: 'DELETE' })).status).toBe(405);
    // 404：路徑不存在。
    expect((await fetch(`${studio.url}/nope`)).status).toBe(404);

    // 以上每一則都是系統正常運作的回應。它們若也被記下來，真正該被看見的
    // 那一行就會被埋掉 —— 這是這張票最容易做錯的一半。
    expect(logged).toEqual([]);
  });
});
