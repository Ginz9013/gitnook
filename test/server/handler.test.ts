import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
import type { Board, CreateInput, IdSource, Issue } from '../../src/index.js';
import { handleRequest } from '../../src/server/handler.js';

// ADR-0004：無 storage 接縫、無 in-memory fake。每個測試用例一個 mkdtemp 的真實 board。
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-handler-'));
  mkdirSync(join(dir, '.issues', 'issues'), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 測試用的完整 ULID：不足 26 碼補 0，字元皆屬 Crockford base32。 */
const fullId = (prefix: string): string => prefix.padEnd(26, '0');

/** 第一次 ulid() 是 Issue 的識別碼，其後每次都是一個 Op 的識別碼。 */
function seeded(issueId: string): IdSource {
  let n = 0;
  return { ulid: () => (n++ === 0 ? issueId : issueId.slice(0, 8) + String(n).padStart(18, '0')) };
}

const board = (): Board => openBoard({ dir, actor: 'test' });

const createWith = (issueId: string, input: CreateInput): Issue =>
  openBoard({ dir, actor: 'test', ids: seeded(issueId) }).create(input);

const get = (url: string) => handleRequest(board(), { method: 'GET', url });

describe('GET /', () => {
  it('回傳看板 HTML，200', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect', status: 'queued' });

    const res = get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('<!doctype html>');
    // 八欄看板，且該票落在自己的欄位裡。
    expect(res.body).toContain('data-status="queued"');
    expect(res.body).toContain('Fix login redirect');
  });
});

describe('GET /i/<ref>', () => {
  it('回傳該 Issue 的詳情 HTML，200', () => {
    createWith(fullId('01JBXA'), {
      title: 'Union merge spike',
      status: 'blocked',
      description: 'keeps **both** sides',
    });

    const res = get(`/i/${fullId('01JBXA')}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toMatch(/<h1[^>]*>Union merge spike<\/h1>/);
    expect(res.body).toContain('<strong>both</strong>');
    // 票 08 的契約：詳情頁連回看板。
    expect(res.body).toContain('href="/"');
  });
});

describe('GET /i/<ref> 的 ref 解析', () => {
  it('接受無歧義前綴 —— 票 08 的卡片就是連到短 ID', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    createWith(fullId('01JBXB'), { title: 'Write the skill doc' });

    const res = get('/i/01JBXA');

    expect(res.status).toBe(200);
    expect(res.body).toContain('Fix login redirect');
    expect(res.body).not.toContain('Write the skill doc');
  });

  it('ref 大小寫不敏感（CONTEXT.md 的 Ref 定義）', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    expect(get('/i/01jbxa').status).toBe(200);
    expect(get('/i/01jbxa').body).toContain('Fix login redirect');
  });
});

describe('未知路徑', () => {
  it('回傳 404', () => {
    // `/i/`（空 ref）屬於「ref 解析失敗」那一組，見下一個 describe。
    for (const url of ['/nope', '/i', '/hash/extra', '/favicon.ico', '//']) {
      const res = get(url);
      expect(res.status, url).toBe(404);
    }
  });
});

describe('無法解析的 ref', () => {
  it('不存在的 ref 回傳 404 而非 500，且不外洩例外', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    // 合法形狀但無對應、空 ref。任何一個都不得讓處理器拋出例外。
    for (const url of ['/i/ZZZZZZ', `/i/${fullId('01JBXC')}`, '/i/']) {
      const res = get(url);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('Fix login redirect');
    }
  });
});

describe('有歧義的 ref', () => {
  it('撞號的前綴回傳 404，並在內文給出足以區分的候選', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    createWith(fullId('01JBXA1'), { title: 'Write the skill doc' });

    const res = get('/i/01JBXA');

    // 猜其中一張都是錯的答案；處理器同樣不得讓例外變成 500。
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('Fix login redirect');
    expect(res.body).not.toContain('Write the skill doc');
    expect(res.body).toContain('01JBXA0');
    expect(res.body).toContain('01JBXA1');
  });
});

describe('路徑穿越', () => {
  /**
   * `/i/<ref>` 把 URL 片段直接餵進 board.get()，而 ref 最終會被接進檔案路徑。
   * core 以 isValidRef() 只接受 Crockford base32 擋下這件事，但路由層不得假設
   * core 永遠會擋 —— 這裡把「穿越請求只會得到 404」釘死在 HTTP 這一層。
   *
   * 注意：本測試刻意不經過 new URL()。WHATWG 的解析器會把 `..` 正規化掉，
   * 讓穿越在到達 ref 檢查之前就消失，測試會因此變成空的。
   */
  const TRAVERSALS = [
    '/i/../../../etc/passwd',
    '/i/..%2F..%2F..%2Fetc%2Fpasswd',
    '/i/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/i/....//....//etc/passwd',
    '/i//etc/passwd',
    '/i/..%5c..%5cwindows%5cwin.ini',
    '/i/../../CONTEXT.md',
    '/i/../../package.json',
  ];

  it('穿越用的 ref 一律 404，既不 500 也不回傳檔案內容', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    for (const url of TRAVERSALS) {
      const res = get(url);
      expect(res.status, url).toBe(404);
      // /etc/passwd 的第一個帳號、以及本 repo 檔案的可辨識片段。
      expect(res.body, url).not.toContain('root:');
      expect(res.body, url).not.toContain('gitnook');
      expect(res.body, url).not.toContain('Op-log');
    }
  });

  /**
   * 上面那些 payload 只證明「這些 URL 不會有事」。真正曾經存在的漏洞更窄：
   * ref 會被大寫化並補上 .ndjson，所以能讀到的是 board 之外的 *.ndjson。
   * 在 board 目錄上方放一個貨真價實的誘餌檔，才是會隨守衛消失而變紅的測試。
   */
  it('board 目錄之外的 .ndjson 讀不到 —— 這才是曾經存在的那條穿越路徑', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    // .issues/issues/../../OUTSIDE.ndjson 即 <dir>/OUTSIDE.ndjson。
    writeFileSync(
      join(dir, 'OUTSIDE.ndjson'),
      JSON.stringify({ id: fullId('01JBXZ'), t: 1, a: 'attacker', op: 'create', title: 'LEAKED FROM OUTSIDE' }) + '\n',
      'utf8',
    );

    for (const url of ['/i/../../OUTSIDE', '/i/../../outside']) {
      const res = get(url);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('LEAKED FROM OUTSIDE');
    }
  });
});

describe('無任何寫入路徑', () => {
  it('POST / PUT / DELETE 一律 405，且不改動 board', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const before = board().list({ all: true });

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const url of ['/', '/i/01JBXA', '/hash']) {
        const res = handleRequest(board(), { method, url });
        expect(res.status, `${method} ${url}`).toBe(405);
        // 405 必須告訴呼叫端還剩什麼方法可用（RFC 9110）。
        expect(res.headers['allow'], `${method} ${url}`).toBe('GET');
      }
    }

    expect(board().list({ all: true })).toEqual(before);
  });
});

describe('GET /hash', () => {
  it('回傳當前 board 狀態的雜湊，200，text/plain', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    const res = get('/hash');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    // 一個不透明但穩定的字串。內容不得外洩到 body 裡。
    expect(res.body).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body).not.toContain('Fix login redirect');
    // 同一個 board 重複詢問必須得到同一個值，否則每 2 秒都會重載。
    expect(get('/hash').body).toBe(res.body);
  });
});

describe('/hash 對 board 變更敏感', () => {
  /** 輪詢重載的全部價值都在這裡：board 變了，值就必須變。 */
  it('每一種會改變畫面的變更都讓 /hash 換值', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    let previous = get('/hash').body;

    const b = board();
    const mutations: [string, () => void][] = [
      ['新增一張 Issue', () => void createWith(fullId('01JBXB'), { title: 'Write the skill doc' })],
      ['改 status', () => void b.apply('01JBXA', { status: 'queued' })],
      ['改 title', () => void b.apply('01JBXA', { title: 'Fix the login redirect' })],
      ['改 description', () => void b.apply('01JBXA', { description: 'safari 才會重現' })],
      ['加 label', () => void b.apply('01JBXA', { labels: { add: ['bug'] } })],
      ['移除 label', () => void b.apply('01JBXA', { labels: { remove: ['bug'] } })],
      ['新增 comment', () => void b.apply('01JBXA', { comment: 'reproduced on 2.50.1' })],
      ['封存', () => void b.apply('01JBXA', { archived: true })],
    ];

    // 比對的對象是「變更前那一刻」而不是「所有看過的值」。雜湊是狀態的函數，
    // 加了 label 又移除會讓 Issue 回到一模一樣的狀態 —— 那時值本來就該回到原值，
    // 而畫面確實不需要重載。
    for (const [what, mutate] of mutations) {
      mutate();
      const after = get('/hash').body;
      expect(after, `${what} 之後 /hash 沒有換值`).not.toBe(previous);
      previous = after;
    }
  });
});

/** 頁面上所有 <script> 元素的內容。 */
function scripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
}

interface PollRun {
  readonly fetched: string[];
  readonly reloads: number;
  readonly intervalMs: number | undefined;
}

/**
 * 把輪詢腳本當成 JS 真的跑起來，而不是對它的文字下斷言。
 * fetch / setInterval / location 都由這裡提供，因此「值改變才重載」是被
 * 觀察到的行為，不是從原始碼推測出來的。
 */
async function runPollingScript(script: string, responses: string[]): Promise<PollRun> {
  const fetched: string[] = [];
  let reloads = 0;
  let tick: (() => unknown) | undefined;
  let intervalMs: number | undefined;
  const queue = [...responses];

  const context = vm.createContext({
    fetch: (url: string) => {
      fetched.push(url);
      return Promise.resolve({ ok: true, text: () => Promise.resolve(queue.shift() ?? '') });
    },
    setInterval: (fn: () => unknown, ms: number) => {
      tick = fn;
      intervalMs = ms;
      return 1;
    },
    location: {
      reload: () => {
        reloads += 1;
      },
    },
  });

  vm.runInContext(script, context);
  if (tick === undefined) throw new Error('腳本沒有註冊任何輪詢');
  for (let i = 0; i < responses.length; i++) await tick();

  return { fetched, reloads, intervalMs };
}

describe('輪詢重載腳本', () => {
  it('看板頁與詳情頁各內嵌一段腳本，且它是該頁唯一的 JS', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    // spec.md 的 AC 是「nook studio … 每 2 秒輪詢 /hash 變更即重載」。看板是
    // 開會的投影面，詳情是討論一張 Issue 時停留的地方 —— 只有一邊會更新，
    // 另一邊就是一個看起來還活著的舊畫面。
    expect(scripts(get('/').body)).toHaveLength(1);
    expect(scripts(get(`/i/${fullId('01JBXA')}`).body)).toHaveLength(1);
  });

  it('每 2 秒 fetch /hash；值沒變不重載，值一變就 location.reload()', async () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const script = scripts(get('/').body)[0]!;
    const current = get('/hash').body;

    // 三次回覆都是「與頁面渲染當下相同」的值 —— 不得重載。
    const quiet = await runPollingScript(script, [current, current, current]);
    expect(quiet.intervalMs).toBe(2000);
    expect(quiet.fetched).toEqual(['/hash', '/hash', '/hash']);
    expect(quiet.reloads).toBe(0);

    // 第二次回覆換了值 —— 必須重載。
    const changed = await runPollingScript(script, [current, 'a'.repeat(64)]);
    expect(changed.reloads).toBe(1);
  });

  it('詳情頁的腳本同樣每 2 秒問一次 /hash，值一變就重載', async () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const script = scripts(get(`/i/${fullId('01JBXA')}`).body)[0]!;
    const current = get('/hash').body;

    const quiet = await runPollingScript(script, [current, current]);
    expect(quiet.intervalMs).toBe(2000);
    expect(quiet.fetched).toEqual(['/hash', '/hash']);
    expect(quiet.reloads).toBe(0);

    // 種子取自渲染當下的狀態，所以「這一張沒變、但 board 變了」同樣要重載：
    // /hash 涵蓋整塊 board，而畫面上的短 ID 長度就會隨別張 Issue 改變。
    board().apply(fullId('01JBXA'), { status: 'queued' });
    const changed = await runPollingScript(script, [get('/hash').body]);
    expect(changed.reloads).toBe(1);
  });

  it('board 真的變了之後，/hash 給出的新值會讓已載入的頁面重載', async () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const script = scripts(get('/').body)[0]!;

    board().apply('01JBXA', { status: 'queued' });

    const run = await runPollingScript(script, [get('/hash').body]);
    expect(run.reloads).toBe(1);
  });
});

describe('看板的可見性', () => {
  /**
   * 八欄裡有 done 與 cancelled 兩欄。list() 的預設過濾會把它們藏起來 ——
   * 那是 CLI 的預設檢視該有的行為，不是看板的：看板上那兩欄會因此永遠是空的。
   * archived 才是看板要藏的東西（ADR-0003：可見性與工作結果正交）。
   */
  it('done 與 cancelled 出現在看板上，archived 不出現', () => {
    createWith(fullId('01JBXA'), { title: 'Choose NDJSON layout', status: 'done' });
    createWith(fullId('01JBXB'), { title: 'Build a TUI', status: 'cancelled' });
    createWith(fullId('01JBXC'), { title: 'Reducer convergence', status: 'in_progress' });
    createWith(fullId('01JBXD'), { title: 'Archived, must not appear', status: 'done' });
    board().apply('01JBXD', { archived: true });

    const body = get('/').body;

    expect(body).toContain('Choose NDJSON layout');
    expect(body).toContain('Build a TUI');
    expect(body).toContain('Reducer convergence');
    expect(body).not.toContain('Archived, must not appear');
  });
});
