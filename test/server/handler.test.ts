import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
import type { Board, CreateInput, IdSource, Issue } from '../../src/index.js';
import { handleRequest } from '../../src/server/handler.js';
import type { IssueView } from '../../src/server/handler.js';

// ADR-0004：無 storage 接縫、無 in-memory fake。每個測試用例一個 mkdtemp 的真實 board。
let dir: string;
/**
 * 每個用例自己的假 `dist/studio/`。測試**不得**依賴真的建置產物：
 * 那會讓整份測試檔要先跑一次 vite build 才動得了，而且 packed-smoke 會在
 * 測試中途 `tsup --clean` 把 dist/ 整個清掉，變成 flaky。
 */
let assets: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-handler-'));
  mkdirSync(join(dir, '.issues', 'issues'), { recursive: true });
  assets = mkdtempSync(join(tmpdir(), 'nook-assets-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(assets, { recursive: true, force: true });
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

const get = (url: string) => handleRequest(board(), { method: 'GET', url }, { assetsDir: assets });

describe('GET /', () => {
  it('回傳 SPA 殼，200', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect', status: 'queued' });

    const res = get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('<!doctype html>');
    // React 掛載點與打包後的資產。殼本身不含任何看板結構。
    expect(res.body).toContain('<div id="root"></div>');
    expect(res.body).toContain('src="/assets/studio.js"');
    expect(res.body).toContain('href="/assets/studio.css"');
  });

  it('殼不含 board 的內容 —— 資料一律走 /api/board', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect', status: 'queued' });

    const body = get('/').body;

    expect(body).not.toContain('Fix login redirect');
    expect(body).not.toContain('data-status="queued"');
  });

  it('沒有任何內嵌腳本 —— 輪詢改由 SPA 自己做（票 05）', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    // 內嵌 <script> 的內容一律為空：唯一的 script 元素是指向 /assets 的 src。
    for (const inline of scripts(get('/').body)) {
      expect(inline.trim()).toBe('');
    }
  });
});

describe('GET /i/<ref>', () => {
  /**
   * 伺服器渲染的詳情頁沒了 —— 讀取一律走 /api/board，一張 Issue 的細節由
   * drawer 在 client 端顯示（票 07）。`/i/<ref>` 這條路徑本身保留給票 03 的
   * 寫入端點（POST），但它不是一個讀取面。
   */
  it('不再有伺服器渲染的詳情頁，一律 404', () => {
    createWith(fullId('01JBXA'), {
      title: 'Union merge spike',
      description: 'keeps **both** sides',
    });

    for (const url of [`/i/${fullId('01JBXA')}`, '/i/01JBXA', '/i/01jbxa']) {
      const res = get(url);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('Union merge spike');
    }
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

/**
 * ADR-0007 解除了票 09「無任何寫入路徑」的契約：studio 可以寫了。**白名單是
 * 收窄而不是移除** —— 唯一多出來的是 `POST /i/<ref>`，其餘一切照舊 405。
 */
describe('方法白名單收窄而非移除', () => {
  it('PUT / DELETE / PATCH 一律 405，POST 只在非 /i/<ref> 的路徑上 405，且不改動 board', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const before = board().list({ all: true });

    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      for (const url of ['/', '/i/01JBXA', '/hash']) {
        const res = handleRequest(board(), { method, url });
        expect(res.status, `${method} ${url}`).toBe(405);
        // 405 必須告訴呼叫端還剩什麼方法可用（RFC 9110）。
        expect(res.headers['allow'], `${method} ${url}`).toBeDefined();
      }
    }

    for (const url of ['/', '/hash']) {
      const res = handleRequest(board(), { method: 'POST', url });
      expect(res.status, `POST ${url}`).toBe(405);
      expect(res.headers['allow'], `POST ${url}`).toBe('GET');
    }

    expect(board().list({ all: true })).toEqual(before);
  });
});

describe('「哪些路徑存在」不能決定「能不能寫」', () => {
  /**
   * 這是票 09 那條防線的全部價值，ADR-0007 之後仍然成立：方法檢查在路由**之前**。
   * 換個講法 —— 一條路徑不會因為不存在就變得可寫。若順序倒過來，未來任何一條
   * 新路徑都得自己記得拒絕寫入，漏掉一條就是一個寫入漏洞。
   */
  const NOT_WRITABLE = [
    '/',
    '/hash',
    '/api/board',
    '/assets/studio.js',
    '/assets/nope.js',
    // 這幾條 GET 起來是 404 —— 不存在，但同樣不可寫。
    '/nope',
    '/i',
    '/favicon.ico',
    '/api/board/extra',
  ];

  it('POST 到任何非 /i/<ref> 的路徑都是 405，即使那條路徑根本不存在', () => {
    fakeAssets({ 'studio.js': 'x\n' });
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const before = board().list({ all: true });

    for (const url of NOT_WRITABLE) {
      const res = post(url, { comment: 'should never land' });
      // 404 在這裡是錯的答案：那等於讓「路徑存在與否」回答了「能不能寫」。
      expect(res.status, `POST ${url}`).toBe(405);
      expect(res.headers['allow'], `POST ${url}`).toBe('GET');
    }

    expect(board().list({ all: true })).toEqual(before);
  });

  it('PUT / DELETE / PATCH 在每一條路徑上都是 405，/i/<ref> 也不例外', () => {
    fakeAssets({ 'studio.js': 'x\n' });
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const before = board().list({ all: true });

    for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      for (const url of [...NOT_WRITABLE, `/i/${id}`, '/i/01JBXA']) {
        const res = handleRequest(
          board(),
          { method, url, body: JSON.stringify({ comment: 'should never land' }) },
          { assetsDir: assets },
        );
        expect(res.status, `${method} ${url}`).toBe(405);
      }
    }

    expect(board().list({ all: true })).toEqual(before);
  });

  it('/i/<ref> 的 Allow 說的是 POST —— 伺服器渲染的詳情頁在票 01 就沒了', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    expect(handleRequest(board(), { method: 'PUT', url: '/i/01JBXA' }).headers['allow']).toBe('POST');
  });
});

/** 一次寫入。body 是 `Change` 的 JSON —— 端點直接鏡射 `board.apply(ref, change)`。 */
const post = (url: string, body: unknown) =>
  handleRequest(
    board(),
    { method: 'POST', url, body: typeof body === 'string' ? body : JSON.stringify(body) },
    { assetsDir: assets },
  );

/** 磁碟上那一份 op-log 的每一行。回應說寫成功了不算數，檔案裡有才算。 */
const opsOnDisk = (id: string): Record<string, unknown>[] =>
  readFileSync(join(dir, '.issues', 'issues', `${id}.ndjson`), 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('POST /i/<ref>', () => {
  /**
   * 回印的那一張也是一個顯示用的 Ref，所以也要對整塊 board 算 —— 只拿手上
   * 這一張去算會回下限 6，而那 6 碼在同一個時間窗口裡對應到好幾張（ADR-0006）。
   */
  it('回印的 shortId 對整塊 board 算，不是對回印的那一張算', () => {
    createWith(fullId('01JBXAQ'), { title: 'Fix login redirect' });
    createWith(fullId('01JBXAR'), { title: 'Add dark mode' });

    const view = JSON.parse(post(`/i/${fullId('01JBXAQ')}`, { status: 'todo' }).body) as IssueView;

    // 兩張只在第 7 碼分開，所以 6 碼不夠。
    expect(view.shortId).toBe('01JBXAQ');
    expect(board().get(view.shortId).id).toBe(fullId('01JBXAQ'));
  });

  it('搬移 status：回 200 + IssueView，且 op 真的 append 到 .ndjson', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const beforeOps = opsOnDisk(id).length;

    const res = post(`/i/${id}`, { status: 'queued' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);

    const view = JSON.parse(res.body) as IssueView;
    expect(view.id).toBe(id);
    expect(view.status).toBe('queued');
    // IssueView，不是 Issue：預渲染的安全 HTML 一併回來，drawer 才不必再問一次。
    expect(view.descriptionHtml).toBeTypeOf('string');

    // 回應可能是任何東西編出來的 —— 檔案才是事實。
    const ops = opsOnDisk(id);
    expect(ops).toHaveLength(beforeOps + 1);
    expect(ops.at(-1)).toMatchObject({ op: 'set', k: 'status', v: 'queued', a: 'test' });
  });

  it('接受無歧義前綴，且大小寫不敏感 —— ref 原樣交給 core', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });

    expect(post('/i/01jbxa', { status: 'todo' }).status).toBe(200);

    expect(opsOnDisk(id).at(-1)).toMatchObject({ op: 'set', k: 'status', v: 'todo' });
  });
});

describe('POST /i/<ref> 涵蓋 Change 的全部意圖', () => {
  it('欄位編輯：title / description / archived 各自成為一個 set op', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });

    const view = JSON.parse(
      post(`/i/${id}`, {
        title: 'Fix the login redirect',
        description: 'safari 才會重現',
        archived: true,
      }).body,
    ) as IssueView;

    expect(view).toMatchObject({
      title: 'Fix the login redirect',
      description: 'safari 才會重現',
      archived: true,
    });
    // 預渲染的 HTML 跟著新的原文走，不是回舊值。
    expect(view.descriptionHtml).toBe('<p>safari 才會重現</p>');

    const ops = opsOnDisk(id);
    expect(ops.filter((o) => o['op'] === 'set')).toMatchObject([
      { k: 'title', v: 'Fix the login redirect' },
      { k: 'description', v: 'safari 才會重現' },
      { k: 'archived', v: true },
    ]);
  });

  it('留言：append 一個 comment op，且回應帶預渲染的 bodyHtml', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });

    const view = JSON.parse(post(`/i/${id}`, { comment: 'reproduced on `2.50.1`' }).body) as IssueView;

    expect(view.comments).toHaveLength(1);
    expect(view.comments[0]).toMatchObject({
      actor: 'test',
      body: 'reproduced on `2.50.1`',
      bodyHtml: '<p>reproduced on <code>2.50.1</code></p>',
    });

    expect(opsOnDisk(id).at(-1)).toMatchObject({ op: 'comment', body: 'reproduced on `2.50.1`' });
  });

  it('label 增減：add 與 remove 各自寫成 OR-Set 的 op', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect', labels: ['p1'] });

    expect([...(JSON.parse(post(`/i/${id}`, { labels: { add: ['bug'] } }).body) as IssueView).labels].sort()).toEqual(
      ['bug', 'p1'],
    );
    expect(opsOnDisk(id).at(-1)).toMatchObject({ op: 'label.add', v: 'bug' });

    expect((JSON.parse(post(`/i/${id}`, { labels: { remove: ['p1'] } }).body) as IssueView).labels).toEqual(['bug']);
    // rm 帶著它觀察到的 add tag —— add-wins 全靠 seen（ops.ts）。
    expect(opsOnDisk(id).at(-1)).toMatchObject({ op: 'label.rm', v: 'p1' });
    expect((opsOnDisk(id).at(-1)!['seen'] as string[]).length).toBe(1);
  });

  it('blocked 與其他 Status 一視同仁 —— 端點不附加任何額外條件（ADR-0003）', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });

    // 在 server 端加一條 CLI 沒有的規則會讓兩個介面分歧（ADR-0007 的分工）。
    const res = post(`/i/${id}`, { status: 'blocked' });

    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as IssueView).status).toBe('blocked');
  });

  it('寫入之後 /hash 換值 —— 票 09 的輪詢性質不得被寫入面破壞', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const before = get('/hash').body;

    post(`/i/${id}`, { status: 'queued' });

    expect(get('/hash').body).not.toBe(before);
  });
});

describe('POST /i/<ref> 的錯誤對應', () => {
  it('RefNotFound → 404，不是 500，也不外洩例外', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    for (const url of [`/i/${fullId('01JBXC')}`, '/i/ZZZZZZ', '/i/']) {
      const res = post(url, { status: 'queued' });
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('Fix login redirect');
      expect(res.body, url).not.toContain('at Object');
    }
  });

  /**
   * 票 01 移除了伺服器渲染的 `GET /i/<ref>`，連帶把「有歧義的 ref」那個
   * describe 一起刪掉。這條性質在寫入面上更重要：猜錯一張 Issue 的寫入是
   * append-only 的，事後只能再寫一筆蓋回去 —— 所以絕不猜測。
   */
  it('AmbiguousRef → 404，且內文含足以區分的候選', () => {
    createWith(fullId('01JBXAB'), { title: 'Fix login redirect' });
    createWith(fullId('01JBXAC'), { title: 'Union merge spike' });

    const res = post('/i/01JBXA', { status: 'queued' });

    expect(res.status).toBe(404);
    // 「足以區分」的長度：6 碼兩張一模一樣，所以候選必須印到第 7 碼。
    expect(res.body).toContain('01JBXAB');
    expect(res.body).toContain('01JBXAC');
    // 兩張都不得被寫到 —— 有歧義時什麼都不做，而不是挑一張。
    for (const id of [fullId('01JBXAB'), fullId('01JBXAC')]) {
      expect(opsOnDisk(id).some((o) => o['op'] === 'set')).toBe(false);
    }
  });

  it('InvalidStatus → 400', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const before = opsOnDisk(id).length;

    // 不存在的值，以及對應到多個 Status 的前綴（backlog / blocked）。
    for (const status of ['shipped', 'b', '']) {
      const res = post(`/i/${id}`, { status });
      expect(res.status, status).toBe(400);
    }

    // 驗證先於任何寫入：被拒絕的 Change 不得留下半個 Op。
    expect(opsOnDisk(id)).toHaveLength(before);
  });

  it('body 不是合法 JSON → 400，不是 500', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const before = opsOnDisk(id).length;

    for (const body of ['', '{', 'not json', '{"status":}']) {
      const res = post(`/i/${id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    expect(opsOnDisk(id)).toHaveLength(before);
  });

  it('body 是合法 JSON 但不是 Change 的形狀 → 400', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const before = opsOnDisk(id).length;

    const notChanges: unknown[] = [
      null,
      42,
      'queued',
      ['queued'],
      { title: 5 },
      { archived: 'yes' },
      { labels: 'bug' },
      { labels: { add: 'bug' } },
      { labels: { add: [1] } },
      { comment: { body: 'hi' } },
      // 打錯的欄位名靜靜地什麼都不做，是最糟的失敗模式：append-only 之下
      // 沒有「被拒絕的寫入」可以事後翻查，畫面只會顯示「我按了但沒動」。
      { statuss: 'queued' },
    ];

    for (const body of notChanges) {
      const res = post(`/i/${id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    expect(opsOnDisk(id)).toHaveLength(before);
  });

  it('穿越用的 ref 在寫入面上同樣是 404，且不在 board 外面造出檔案', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    for (const url of ['/i/../../OUTSIDE', '/i/../../../etc/passwd', '/i/..%2f..%2fOUTSIDE']) {
      const res = post(url, { comment: 'LEAKED' });
      expect(res.status, url).toBe(404);
    }

    expect(existsSync(join(dir, 'OUTSIDE.ndjson'))).toBe(false);
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

describe('GET /api/board', () => {
  it('回傳 { issues, hash } 的 JSON，200', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect', status: 'queued' });

    const res = get('/api/board');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);

    const payload = JSON.parse(res.body) as { issues: unknown[]; hash: string };
    // hash 與 /hash 是同一個值 —— SPA 拿到快照的同時就知道自己看的是哪一版，
    // 否則輪詢的第一次比對會憑空重抓一次。
    expect(payload.hash).toBe(get('/hash').body);
    expect(payload.issues).toHaveLength(1);
  });
});

describe('/api/board 的 IssueView', () => {
  it('帶齊 client 排版所需的欄位，且 description 是原文（供編輯用）', () => {
    createWith(fullId('01JBXA'), {
      title: 'Union merge spike',
      status: 'blocked',
      description: 'keeps **both** sides',
      labels: ['bug', 'p1'],
    });
    board().apply(fullId('01JBXA'), { comment: 'reproduced on **2.50.1**' });

    const [issue] = JSON.parse(get('/api/board').body).issues as IssueView[];

    expect(issue).toMatchObject({
      // 完整識別碼，不是短 Ref：短幾碼才無歧義是整批的性質，client 手上有整批。
      id: fullId('01JBXA'),
      title: 'Union merge spike',
      status: 'blocked',
      labels: ['bug', 'p1'],
      archived: false,
      description: 'keeps **both** sides',
    });
    expect(issue!.comments).toHaveLength(1);
    expect(issue!.comments[0]).toMatchObject({ actor: 'test', body: 'reproduced on **2.50.1**' });
    expect(issue!.comments[0]!.t).toBeTypeOf('number');
    expect(issue!.comments[0]!.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('archived 的 Issue 也在快照裡 —— 可見性由 client 決定（ADR-0003）', () => {
    createWith(fullId('01JBXA'), { title: 'Choose NDJSON layout', status: 'done' });
    createWith(fullId('01JBXB'), { title: 'Archived but present' });
    board().apply(fullId('01JBXB'), { archived: true });

    const issues = (JSON.parse(get('/api/board').body).issues as IssueView[]);

    // done 與 cancelled 是看板上的兩欄；archived 是正交的可見性欄位。
    expect(issues.map((i) => i.title).sort()).toEqual(['Archived but present', 'Choose NDJSON layout']);
    expect(issues.find((i) => i.title === 'Archived but present')!.archived).toBe(true);
  });

  /**
   * ADR-0006：短 Ref 只在它被印出來的那一刻成立，而使用者接著要拿它當 Ref 用。
   * ULID 前 6 碼每 17.5 分鐘才變一次，所以同一個窗口裡建立的 Issue 必然共用前綴 ——
   * 長度必須對整塊 board 算一次，不是每張自己跟自己算。
   */
  it('shortId 對整塊 board 算一次 —— 前綴相同的兩張不會撞號', () => {
    createWith(fullId('01JBXAQ'), { title: 'Fix login redirect' });
    createWith(fullId('01JBXAR'), { title: 'Add dark mode' });
    // 自己一張算只需要 6 碼，但它跟前兩張同批，所以也得跟著長。
    createWith(fullId('01JBXB'), { title: 'Choose NDJSON layout' });

    const issues = JSON.parse(get('/api/board').body).issues as IssueView[];
    const byId = new Map(issues.map((i) => [i.id, i]));
    const a = byId.get(fullId('01JBXAQ'))!;
    const b = byId.get(fullId('01JBXAR'))!;

    expect(a.shortId).not.toBe(b.shortId);
    // 長度是整份快照的性質，不是單張的：三張一樣長。
    expect(new Set(issues.map((i) => i.shortId.length))).toEqual(new Set([7]));
    // 印出來的東西必須真的是那張 Issue 的前綴，而不是另外編的。
    expect(a.id.startsWith(a.shortId)).toBe(true);
    expect(b.id.startsWith(b.shortId)).toBe(true);
    // 而且它要真的解析得回同一張 —— 這才是短 ID 的用途。
    expect(board().get(a.shortId).id).toBe(a.id);
    expect(board().get(b.shortId).id).toBe(b.id);
  });
});

describe('/api/board 的預渲染 HTML', () => {
  /**
   * 安全性由 server 保證，不靠前端紀律（ADR-0008）：client 拿到的字串已經走過
   * html.ts 的「先逸出、再構造」，因此 dangerouslySetInnerHTML 是安全的。
   * 這裡不重新測 markdown 的全部語法 —— 那是 test/render/html.test.ts 的事。
   * 這裡要釘的是「走的真的是那一份 renderer」。
   */
  it('descriptionHtml 與 bodyHtml 是 markdown 渲染後的安全 HTML', () => {
    createWith(fullId('01JBXA'), {
      title: 'Union merge spike',
      description: 'keeps **both** sides',
    });
    board().apply(fullId('01JBXA'), { comment: 'reproduced on `2.50.1`' });

    const [issue] = JSON.parse(get('/api/board').body).issues as IssueView[];

    expect(issue!.descriptionHtml).toBe('<p>keeps <strong>both</strong> sides</p>');
    expect(issue!.comments[0]!.bodyHtml).toBe('<p>reproduced on <code>2.50.1</code></p>');
  });

  it('raw HTML 進不去 —— 逸出發生在任何標記產生之前', () => {
    createWith(fullId('01JBXA'), {
      title: 'xss',
      description: '<img src=x onerror=alert(1)>',
    });
    board().apply(fullId('01JBXA'), { comment: '<script>alert(2)</script>' });

    const [issue] = JSON.parse(get('/api/board').body).issues as IssueView[];

    expect(issue!.descriptionHtml).not.toContain('<img');
    expect(issue!.descriptionHtml).toContain('&lt;img');
    expect(issue!.comments[0]!.bodyHtml).not.toContain('<script');
    expect(issue!.comments[0]!.bodyHtml).toContain('&lt;script');
  });
});

/**
 * 假的 `dist/studio/`。刻意不依賴真的建置產物：測試不該要求先跑一次 vite，
 * 而且「讀得到什麼」正是這一層要證明的事，交給建置就沒得證明了。
 */
function fakeAssets(files: Readonly<Record<string, string>>): string {
  for (const [name, body] of Object.entries(files)) writeFileSync(join(assets, name), body, 'utf8');
  return assets;
}

const getAsset = (url: string, assetsDir: string) =>
  handleRequest(board(), { method: 'GET', url }, { assetsDir });

describe('GET /assets/<file>', () => {
  it('服務 dist/studio/ 底下的檔案，帶對的 content-type', () => {
    const assetsDir = fakeAssets({
      'studio.js': 'console.log("hi")\n',
      'studio.css': ':root{--x:1}\n',
    });

    const js = getAsset('/assets/studio.js', assetsDir);
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/^text\/javascript/);
    expect(js.body).toBe('console.log("hi")\n');

    const css = getAsset('/assets/studio.css', assetsDir);
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/^text\/css/);
    expect(css.body).toBe(':root{--x:1}\n');
  });

  /**
   * ADR-0008 的硬約束：bundle 是磁碟上的靜態檔，**在 request 當下才讀**。
   * 一旦它被當成模組或字串 import 進來，每一次 `nook list` 都要多 parse
   * 400KB，冷啟閘門就沒了。改掉磁碟上的檔案、下一次請求就該看到新內容 ——
   * 這是「沒有在啟動時被吸進記憶體」唯一測得出來的證據。
   */
  it('每次請求都重新讀磁碟，不是啟動時載入的常數', () => {
    const assetsDir = fakeAssets({ 'studio.js': 'const version = 1\n' });

    expect(getAsset('/assets/studio.js', assetsDir).body).toBe('const version = 1\n');

    writeFileSync(join(assetsDir, 'studio.js'), 'const version = 2\n', 'utf8');

    expect(getAsset('/assets/studio.js', assetsDir).body).toBe('const version = 2\n');
  });

  it('不存在的資產是 404，不是例外', () => {
    const assetsDir = fakeAssets({ 'studio.js': 'x\n' });

    const res = getAsset('/assets/nope.js', assetsDir);

    expect(res.status).toBe(404);
  });
});

describe('/assets/ 的路徑穿越', () => {
  /**
   * `/assets/` 是這一版唯一把 URL 片段接進檔案路徑並真的讀檔的地方，因此
   * 舊的 `/i/<ref>` 穿越測試那份嚴格度整個搬到這裡來。
   *
   * 同樣刻意不經過 new URL()：WHATWG 的解析器會把 `..` 正規化掉，讓穿越在
   * 到達守衛之前就消失，測試會因此變成空的。
   */
  const TRAVERSALS = [
    '/assets/../../../etc/passwd',
    '/assets/..%2F..%2F..%2Fetc%2Fpasswd',
    '/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/assets/....//....//etc/passwd',
    '/assets//etc/passwd',
    '/assets/..%5c..%5cwindows%5cwin.ini',
    '/assets/../../CONTEXT.md',
    '/assets/../../package.json',
    '/assets/sub/studio.js',
  ];

  it('穿越用的檔名一律 404，既不 500 也不回傳檔案內容', () => {
    const assetsDir = fakeAssets({ 'studio.js': 'x\n' });

    for (const url of TRAVERSALS) {
      const res = getAsset(url, assetsDir);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('root:');
      expect(res.body, url).not.toContain('gitnook');
      expect(res.body, url).not.toContain('Op-log');
    }
  });

  /**
   * 上面那些 payload 只證明「這些 URL 不會有事」。在資產目錄的正上方放一個
   * 貨真價實、副檔名還在白名單上的誘餌，才是會隨守衛消失而變紅的測試。
   */
  it('資產目錄之外的 .js 讀不到 —— 有誘餌才證明得了守衛還在', () => {
    const assetsDir = fakeAssets({ 'studio.js': 'x\n' });
    writeFileSync(join(assetsDir, '..', 'SECRET.js'), 'LEAKED FROM OUTSIDE\n', 'utf8');

    try {
      for (const url of ['/assets/../SECRET.js', '/assets/..%2FSECRET.js', '/assets/%2e%2e/SECRET.js']) {
        const res = getAsset(url, assetsDir);
        expect(res.status, url).toBe(404);
        expect(res.body, url).not.toContain('LEAKED FROM OUTSIDE');
      }
    } finally {
      rmSync(join(assetsDir, '..', 'SECRET.js'), { force: true });
    }
  });

  it('壞掉的百分號跳脫是 404，不是例外', () => {
    const assetsDir = fakeAssets({ 'studio.js': 'x\n' });

    expect(getAsset('/assets/%E0%A4%A.js', assetsDir).status).toBe(404);
  });
});

describe('dist/studio/ 不存在時', () => {
  /**
   * 只有從原始碼跑而忘了建置的人會撞到這個 —— 出貨的 tarball 裡 dist/studio/
   * 一定在。給的是一頁看得懂的說明，不是空白畫面，也不是堆疊追蹤。
   *
   * 刻意仍然回 200：這是給一個人看的頁面，不是 API；而且 `/` 的狀態碼是
   * `nook studio` 活著與否的訊號，不該隨建置狀態改變。
   */
  it('GET / 給出說得出下一步的訊息頁，而不是空白的殼', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'nook-noassets-')), 'studio');

    const res = getAsset('/', missing);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('npm run build');
    expect(res.body).toContain(missing);
    // 殼載不起來，就不要送出一份會 404 的 <script>。
    expect(res.body).not.toContain('/assets/studio.js');
  });

  it('資產在的時候送的是殼，不是訊息頁', () => {
    const assetsDir = fakeAssets({ 'studio.js': 'x\n' });

    const res = getAsset('/', assetsDir);

    expect(res.body).toContain('<div id="root"></div>');
    expect(res.body).not.toContain('npm run build');
  });
});

describe('未預期的例外', () => {
  it('board 在中途消失：回 500 而不是往上拋，內文說得出發生什麼事', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const alive = board();
    // 先確認這塊 board 本來是好的 —— 否則下面的 500 證明不了是「中途消失」。
    expect(alive.list({ all: true })).toHaveLength(1);

    rmSync(join(dir, '.issues'), { recursive: true, force: true });

    const res = handleRequest(alive, { method: 'GET', url: '/api/board' }, { assetsDir: assets });

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    // 讀者就是跑 nook studio 的那個人（同 missingAssetsPage 的模型）：
    // 只說「內部錯誤」等於要他自己去猜看板為什麼整個空了。
    expect(res.body).toContain('不是一個 Nook board');
  });

  it('500 的內文不得外洩堆疊追蹤', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const alive = board();
    rmSync(join(dir, '.issues'), { recursive: true, force: true });

    const res = handleRequest(alive, { method: 'GET', url: '/api/board' }, { assetsDir: assets });

    expect(res.status).toBe(500);
    expect(res.body).not.toMatch(/\n\s*at /);
    expect(res.body).not.toContain('board.ts');
    expect(res.body).not.toContain('handler.ts');
    expect(res.body).not.toContain('node:internal');
  });

  it('寫入面同樣兜底，而且不搶既有的對應：500 只給沒被對應到的例外', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const alive = board();

    // 對應得到的仍然照舊 —— 兜底不得把 400 吃成 500。
    const invalid = handleRequest(alive, { method: 'POST', url: `/i/${id}`, body: '{"status":"nope"}' });
    expect(invalid.status).toBe(400);

    rmSync(join(dir, '.issues'), { recursive: true, force: true });

    // board 消失不是「找不到這張 issue」（404），也不是請求的錯（400）。
    const gone = handleRequest(alive, { method: 'POST', url: `/i/${id}`, body: '{"status":"queued"}' });
    expect(gone.status).toBe(500);
    expect(gone.body).toContain('不是一個 Nook board');
  });
});
