import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
import type { Board, CreateInput, IdSource, Issue } from '../../src/index.js';
import { openDecisionLog } from '../../src/core/decisionLog.js';
import type { DecisionLog } from '../../src/core/decisionTypes.js';
import { handleRequest } from '../../src/server/handler.js';
import type { DecisionBoardSnapshot, DecisionView, IssueView } from '../../src/server/handler.js';

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
const decisionLog = (): DecisionLog => openDecisionLog({ dir, actor: 'test' });

const createWith = (issueId: string, input: CreateInput): Issue =>
  openBoard({ dir, actor: 'test', ids: seeded(issueId) }).create(input);

const get = (url: string) =>
  handleRequest(board(), decisionLog(), { method: 'GET', url }, { assetsDir: assets });

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
        const res = handleRequest(board(), decisionLog(), { method, url });
        expect(res.status, `${method} ${url}`).toBe(405);
        // 405 必須告訴呼叫端還剩什麼方法可用（RFC 9110）。
        expect(res.headers['allow'], `${method} ${url}`).toBeDefined();
      }
    }

    for (const url of ['/', '/hash']) {
      const res = handleRequest(board(), decisionLog(), { method: 'POST', url });
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
          decisionLog(),
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

    expect(handleRequest(board(), decisionLog(), { method: 'PUT', url: '/i/01JBXA' }).headers['allow']).toBe(
      'POST',
    );
  });
});

/**
 * `POST /api/issues` 是白名單上第二條、也是唯一新增的可寫路徑。**它用
 * 完全相等比對，不是 startsWith** —— 前綴比對會讓 `/api/issues/foo` 這種根本
 * 不存在的路徑一併變成可寫，而「哪些路徑存在」不能決定「能不能寫」的那條性質
 * 正是靠白名單短而精確才守得住。
 */
describe('新增端點沒有讓 405 白名單鬆動', () => {
  const STILL_NOT_WRITABLE = [
    '/',
    '/hash',
    '/api/board',
    // 前綴像 `/api/issues`，但都不是它。
    '/api/issues/',
    '/api/issues/foo',
    '/api/issues/01JBXA',
    '/api/issuesss',
    '/api/issue',
  ];

  it('POST 到這些路徑仍然 405、Allow 仍然是 GET，且一張 Issue 都沒被造出來', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const before = board().list({ all: true });

    for (const url of STILL_NOT_WRITABLE) {
      const res = post(url, { title: 'should never land' });
      // 404 在這裡是錯的答案：那表示請求已經進到路由，也就是白名單放它過了。
      expect(res.status, `POST ${url}`).toBe(405);
      expect(res.headers['allow'], `POST ${url}`).toBe('GET');
    }

    expect(board().list({ all: true })).toEqual(before);
    expect(board().refs()).toHaveLength(1);
  });

  it('/api/issues 上的 PUT / DELETE / PATCH 是 405，Allow 說 POST', () => {
    for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      const res = handleRequest(board(), decisionLog(), {
        method,
        url: '/api/issues',
        body: JSON.stringify({ title: 'should never land' }),
      });
      expect(res.status, method).toBe(405);
      expect(res.headers['allow'], method).toBe('POST');
    }

    expect(board().refs()).toHaveLength(0);
  });

  /**
   * `/api/issues` 是一條**只收 POST** 的路徑，所以 GET 它是 405 而不是 404：
   * 那條路徑存在，只是不收這個方法，而 Allow 要說得出還剩什麼可用（RFC 9110）。
   *
   * 這跟 `/i/<ref>` 不同 —— 那條的 GET 曾經是伺服器渲染的詳情頁，票 01 移除之後
   * 回 404，而那個 404 是既有測試釘住的。
   */
  it('GET /api/issues → 405，Allow 說 POST，且沒有一份 board 資料漏出去', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    const res = get('/api/issues');

    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('POST');
    // 它不是一個讀取面：不得順手回一份清單。
    expect(res.body).not.toContain('Fix login redirect');
  });
});

/** 一次寫入。body 是 `Change` 的 JSON —— 端點直接鏡射 `board.apply(ref, change)`。 */
const post = (url: string, body: unknown) =>
  handleRequest(
    board(),
    decisionLog(),
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


/**
 * 刪除**不新增任何端點**：`Change` 多了 `deleted`，既有的 `POST /i/<ref>` 就通了
 * （ADR-0009）。這裡釘的是那條既有路徑現在載得動 deleted，以及回印說得出結果。
 */
describe('POST /i/<ref> 的 deleted', () => {
  it('deleted: true → 200，且回印的 IssueView 說得出它已被刪除', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });

    const res = post(`/i/${id}`, { deleted: true });

    expect(res.status).toBe(200);
    const view = JSON.parse(res.body) as IssueView;
    expect(view.deleted).toBe(true);
    // 回應說寫成功了不算數，磁碟上有那一筆 set 才算。
    const ops = opsOnDisk(id);
    expect(ops.some((o) => o['op'] === 'set' && o['k'] === 'deleted' && o['v'] === true)).toBe(true);
  });

  /**
   * 寫入安全的唯一決定點在 `board.apply`（ADR-0009），端點只負責把它翻成一個
   * 說得出「不是找不到，是它曾經在」的狀態碼 —— 404 會讓 client 以為自己的
   * ref 打錯了。
   */
  it('對已刪的 Issue 再寫 → 410 Gone，內文說得出原因，且一個 op 都沒多寫', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    post(`/i/${id}`, { deleted: true });
    const before = opsOnDisk(id).length;

    const res = post(`/i/${id}`, { comment: 'x' });

    expect(res.status).toBe(410);
    expect(res.body).toContain('already deleted');
    // 500 的兜底會外洩堆疊；這條是被對應過的例外，不得走到那裡。
    expect(res.body).not.toContain('at Object');
    expect(opsOnDisk(id)).toHaveLength(before);
  });

  /**
   * 復原是一次普通的寫入，這正是選 LWW 而不是吸收語意換到的東西（ADR-0009）。
   * 端點因此不得自己先問一句「這張刪了嗎」就回 410 —— 那會把復原一起擋掉。
   */
  it('deleted: false 對已刪的 Issue → 200，回印說它回來了', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    post(`/i/${id}`, { deleted: true });

    const res = post(`/i/${id}`, { deleted: false });

    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as IssueView).deleted).toBe(false);
    // 復原之後它是一張普通的 Issue：寫得動，也回到 board 上。
    expect(post(`/i/${id}`, { comment: 'back' }).status).toBe(200);
    expect(board().list({ all: true }).map((i) => i.id)).toContain(id);
  });

  /**
   * `deleted` 跟其他每一格一樣要逐欄驗形狀，不是「交給 core 去擋」。
   * `"true"` 這個字串是 JS 裡最會騙人的一個值：真的讓它落進 op-log，摺疊出來
   * 的 deleted 會是 truthy，那張 Issue 就從 board 上安靜地消失了。
   */
  it('deleted 不是 boolean → 400，而且一個 op 都沒寫', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const before = opsOnDisk(id).length;

    for (const deleted of ['true', 1, 0, null, {}]) {
      const res = post(`/i/${id}`, { deleted });
      expect(res.status, JSON.stringify(deleted)).toBe(400);
    }

    expect(opsOnDisk(id)).toHaveLength(before);
    expect(board().list({ all: true }).map((i) => i.id)).toContain(id);
  });
});

/**
 * 新增是這一批唯一新增的端點。**刪除沒有端點**（走既有的 `POST /i/<ref>`），
 * 新增有，因為建立一張 Issue 的時候還沒有 ref 可以放進 URL。
 */
describe('POST /api/issues', () => {
  it('建立一張 Issue：201 + IssueView，而且下一次 /api/board 就有它', () => {
    const res = post('/api/issues', { title: 'Fix login redirect' });

    // 201 而不是 200：這次請求造出了一個之前不存在的資源（RFC 9110）。
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/^application\/json/);

    const view = JSON.parse(res.body) as IssueView;
    expect(view.title).toBe('Fix login redirect');
    // server 產生 ULID —— client 沒有 id 可以先畫，這正是新增不做樂觀更新的原因。
    expect(view.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(view.status).toBe('backlog');
    expect(view.deleted).toBe(false);

    // 回應說建立成功了不算數，下一次全量讀取看得到它才算。
    const issues = JSON.parse(get('/api/board').body).issues as IssueView[];
    expect(issues.map((i) => i.id)).toContain(view.id);
    expect(board().get(view.id).title).toBe('Fix login redirect');
  });

  /**
   * 表單只填標題（沒有標題的卡片在板上是一張看不懂的白卡），所以標題是
   * 這個端點唯一的必填欄位，而且空白不算 —— append-only 之下造出來的空卡片
   * 沒有辦法刪掉重來，只能再寫一次 op 蓋掉。
   */
  it('沒有 title、title 不是字串、或 trim 後是空的 → 400，且不造出任何 Issue', () => {
    const rejected: unknown[] = [{}, { title: '' }, { title: '   ' }, { title: '\n\t' }, { title: 1 }, { title: null }, { title: ['x'] }];

    for (const body of rejected) {
      const res = post('/api/issues', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    // 一張都不該存在 —— 半成品的 Issue 檔比一個錯誤訊息貴得多。
    expect(board().refs()).toHaveLength(0);
  });

  /**
   * 收 `status` 的理由：看板每一欄的欄頂各有一個 `+`，而那個 `+` 唯一比 CLI
   * 好的地方就是「按哪一欄就開在哪一欄」。一個按了 review 卻掉進 backlog 的
   * 按鈕比沒有按鈕糟。`board.create()` 本來就收 status —— 這裡不是新增能力，
   * 是不要在端點上把它擋掉。
   */
  it('status 一起送 → 201，且那張真的開在那一欄', () => {
    const res = post('/api/issues', { title: 'Fix login redirect', status: 'review' });

    expect(res.status).toBe(201);
    const view = JSON.parse(res.body) as IssueView;
    expect(view.status).toBe('review');
    expect(board().get(view.id).status).toBe('review');
  });

  /**
   * 不合法的 status 是請求的問題，不是伺服器的問題 —— 沿用 `POST /i/<ref>` 上
   * 既有的 InvalidStatus → 400，而不是讓它掉進 500 的兜底。
   */
  it('status 不合法 → 400，不是 500，且不造出任何 Issue', () => {
    // 不存在的值、對應到多個 Status 的前綴（backlog / blocked）、空字串、非字串。
    for (const status of ['nope', 'b', '', 5, null, ['review']]) {
      const res = post('/api/issues', { title: 'Fix login redirect', status });
      expect(res.status, JSON.stringify(status)).toBe(400);
      expect(res.body, JSON.stringify(status)).not.toContain('at Object');
    }

    // 驗證先於任何寫入：被拒絕的輸入不得留下一個半成品的檔案。
    expect(board().refs()).toHaveLength(0);
  });

  /**
   * 沿用寫入面既有的「不認得的欄位一律拒絕」（票 03）：append-only 之下沒有
   * 「被拒絕的寫入」可以事後翻查，一個被靜靜吃掉的欄位換來的是 201 加上一張
   * 少了東西的 Issue —— 那是最難查的一種失敗。
   *
   * `description` 與 `labels` 刻意不收：表單只填標題，端點不該提供沒有呼叫端
   * 的東西。它們因此跟打錯的欄位名走同一條路。
   */
  it('title / status 以外的鍵 → 400，且不造出任何 Issue', () => {
    const rejected: unknown[] = [
      { title: 'x', description: 'd' },
      { title: 'x', labels: ['bug'] },
      { title: 'x', archived: true },
      { title: 'x', deleted: true },
      { title: 'x', id: fullId('01JBXA') },
      // 打錯的欄位名：靜靜地少一格，比一次 400 難查得多。
      { title: 'x', statuss: 'review' },
    ];

    for (const body of rejected) {
      const res = post('/api/issues', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    expect(board().refs()).toHaveLength(0);
  });

  it('body 不是 JSON 物件 → 400，不是 500', () => {
    for (const body of ['', '{', 'not json', 'null', '42', '"x"', '["x"]']) {
      const res = post('/api/issues', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    expect(board().refs()).toHaveLength(0);
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

/**
 * board 成員資格的唯一決定點是 `board.list()`（ADR-0009），快照因此不必自己
 * 再濾一次。這條測試釘的是「這條讀取路徑真的走那個決定點」—— 繞過 list()
 * 直接讀檔的症狀是一張刪掉的 Issue 又出現在畫面上：安靜、局部、不會讓
 * 別的測試變紅。
 */
describe('/api/board 不含已刪的 Issue', () => {
  it('刪掉的那張從快照上消失，但它的檔案還在，短 Ref 也不因此縮短', () => {
    const kept = fullId('01JBXAB');
    const removed = fullId('01JBXAC');
    createWith(kept, { title: 'Union merge spike' });
    createWith(removed, { title: 'Fix login redirect' });

    post(`/i/${removed}`, { deleted: true });

    const issues = JSON.parse(get('/api/board').body).issues as IssueView[];
    expect(issues.map((i) => i.id)).toEqual([kept]);
    expect(issues.map((i) => i.title)).not.toContain('Fix login redirect');

    // 永不 unlink（ADR-0009）：檔案還在，refs() 因此仍然是兩張，短 Ref 要 7 碼。
    expect(existsSync(join(dir, '.issues', 'issues', `${removed}.ndjson`))).toBe(true);
    expect(issues[0]!.shortId).toBe('01JBXAB');
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
  handleRequest(board(), decisionLog(), { method: 'GET', url }, { assetsDir });

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

    const res = handleRequest(alive, decisionLog(), { method: 'GET', url: '/api/board' }, { assetsDir: assets });

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    // 讀者就是跑 nook studio 的那個人（同 missingAssetsPage 的模型）：
    // 只說「內部錯誤」等於要他自己去猜看板為什麼整個空了。
    expect(res.body).toContain('not a Nook board');
  });

  it('500 的內文不得外洩堆疊追蹤', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    const alive = board();
    rmSync(join(dir, '.issues'), { recursive: true, force: true });

    const res = handleRequest(alive, decisionLog(), { method: 'GET', url: '/api/board' }, { assetsDir: assets });

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
    const invalid = handleRequest(alive, decisionLog(), { method: 'POST', url: `/i/${id}`, body: '{"status":"nope"}' });
    expect(invalid.status).toBe(400);

    rmSync(join(dir, '.issues'), { recursive: true, force: true });

    // board 消失不是「找不到這張 issue」（404），也不是請求的錯（400）。
    const gone = handleRequest(alive, decisionLog(), { method: 'POST', url: `/i/${id}`, body: '{"status":"queued"}' });
    expect(gone.status).toBe(500);
    expect(gone.body).toContain('not a Nook board');
  });
});

/**
 * `GET /api/board-info` —— 開場抓一次的那份東西。**刻意不在 `/api/board` 裡**：
 * `board.health()` 會 spawn 一個 `git rev-parse`（health.ts:167），掛進快照等於
 * 每次全量讀取都多一個子行程，而快照在 ACK 落空時還會被重抓。
 */
const boardInfo = () =>
  handleRequest(board(), decisionLog(), { method: 'GET', url: '/api/board-info' }, { assetsDir: assets });

describe('GET /api/board-info', () => {
  it('回傳這塊 board 的絕對路徑', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    const res = boardInfo();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    // 同時開兩個 repo 的 studio 時，這是畫面上唯一分得出來的東西。
    expect((JSON.parse(res.body) as { root: string }).root).toBe(dir);
  });
});

/** board-info 的 JSON，已解讀。 */
const info = () =>
  JSON.parse(boardInfo().body) as { root: string; branch: string | null; actor: string };

const git = (args: string[], cwd: string = dir): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
};

/**
 * 把 dir 變成一塊有一次提交的 git repo。分支名由呼叫端指定 —— 預設分支名
 * 是機器上的 git 設定說了算，寫死 `main` 會讓這份測試在別人的機器上壞掉。
 */
function gitRepo(branch: string): void {
  git(['init', '-q']);
  git(['config', 'user.email', 'nook-b1@example.com']);
  git(['config', 'user.name', 'Nook B1']);
  git(['checkout', '-q', '-b', branch]);
  git(['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'first']);
}

describe('/api/board-info 的 branch', () => {
  it('回傳目前的分支', () => {
    gitRepo('studio-gui-v2');

    expect(info().branch).toBe('studio-gui-v2');
  });
});

/**
 * `branch` 說不出來的兩種情形都回 `null`，**都不是 500**。nook 不強制在 git repo
 * 裡跑（`doctor` 只是回報 `NotAGitRepo`），所以「這裡沒有分支」是一個正常的答案，
 * 不是伺服器故障。
 */
describe('/api/board-info 的 branch 說不出來的時候', () => {
  it('不是 git repo → 200 且 branch 是 null', () => {
    const res = boardInfo();

    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as { branch: string | null }).branch).toBeNull();
  });

  it('detached HEAD → null —— 那個 `HEAD` 不是分支名', () => {
    gitRepo('studio-gui-v2');
    git(['checkout', '-q', '--detach']);

    expect(info().branch).toBeNull();
  });
});

/**
 * `diagnostics` 就是 `board.health()` 的產物，原樣送出去 —— header 靠它把
 * 「零衝突保證不在了」講給使用者聽（票 B4）。**這裡不做第二份判斷**：
 * 哪些東西算 Diagnostic 只有 `diagnose()` 一份定義。
 */
describe('/api/board-info 的 diagnostics', () => {
  const kinds = () =>
    (JSON.parse(boardInfo().body) as { diagnostics: { kind: string }[] }).diagnostics;

  it('.gitattributes 缺 merge=union 時含 MissingMergeDriver', () => {
    expect(kinds()).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'MissingMergeDriver' })]),
    );
  });

  it('保證在的時候就不再回報它 —— 不是寫死的一條訊息', () => {
    writeFileSync(join(dir, '.gitattributes'), '.issues/issues/*.ndjson merge=union\n', 'utf8');

    expect(kinds().map((d) => d.kind)).not.toContain('MissingMergeDriver');
  });
});

/**
 * `actor` 必須是 op-log 上實際記著的那一個 —— 經由 studio 產生的每一個 op 都
 * 落在它身上（ADR-0007），而畫面上目前完全看不到它。比對的對象因此是磁碟上
 * 那一行 op 的 `a`，不是測試自己重算一遍雜湊。
 */
describe('/api/board-info 的 actor', () => {
  it('與 op-log 上記的是同一個', () => {
    gitRepo('studio-gui-v2');
    // 刻意不傳 actor：讓 core 自己從 git config user.email 推導（ADR-0002）。
    const issue = openBoard({ dir, ids: seeded(fullId('01JBXA')) }).create({ title: 'Fix login' });

    expect(info().actor).toBe(opsOnDisk(issue.id)[0]!['a']);
  });
});

/**
 * `root` 講的必須是**這個 `Board` 的**根目錄，不是 handler 自己另外問來的一個
 * 目錄。尋根是向上找，所以從子目錄開的 board 兩者不同 —— 一個由呼叫端傳進來
 * 的目錄在那裡會指到別的地方去，而畫面上那一行看起來完全正常（票 B8）。
 */
describe('/api/board-info 的 root 就是這個 Board 的根', () => {
  it('board 從子目錄開起來時，回的仍然是含 .issues/ 的那一層', () => {
    gitRepo('studio-gui-v2');
    const deep = join(dir, 'src', 'deep');
    mkdirSync(deep, { recursive: true });
    const fromDeep = openBoard({ dir: deep, actor: 'test' });

    const res = handleRequest(fromDeep, decisionLog(), { method: 'GET', url: '/api/board-info' }, { assetsDir: assets });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { root: string; branch: string | null };
    expect(body.root).toBe(dir);
    expect(body.root).not.toBe(deep);
    // branch 與 actor 都對 root 算，四個欄位因此必然描述同一個目錄 ——
    // 指錯了 root 的話，這裡報的會是別的 repo 的分支。
    expect(body.branch).toBe('studio-gui-v2');
  });
});

/** 一張 Issue 的變更歷史。drawer 底部那塊折疊區塊的資料來源（票 B7）。 */
const history = (ref: string) =>
  handleRequest(board(), decisionLog(), { method: 'GET', url: `/api/history/${ref}` }, { assetsDir: assets });

interface WriteView {
  field: string;
  value: string | boolean;
  actor: string;
  t: number;
}

const writes = (ref: string): WriteView[] =>
  (JSON.parse(history(ref).body) as { writes: WriteView[] }).writes;

/**
 * `GET /api/history/<ref>` —— 對 LWW 欄位的每一次寫入，含是誰寫的與 Lamport 時刻。
 *
 * 存在的理由與 `nook history` 一樣：`description` 是 LWW，兩個 Actor 並行編輯時
 * 摺疊只留一份，**敗方的文字仍然完整躺在 op-log 裡**。這條端點就是把它撈回來的路。
 */
describe('GET /api/history/<ref>', () => {
  it('列出對 LWW 欄位的每一次寫入，含 actor 與 t', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect', status: 'todo' });
    post('/i/01JBXA', { description: 'first draft' });
    post('/i/01JBXA', { description: 'second draft' });
    post('/i/01JBXA', { title: 'Fix the login redirect' });
    post('/i/01JBXA', { archived: true });

    const res = history('01JBXA');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    // 順序沿用 opLog 的全序（board.ts:113），這裡不另寫一份比較器。
    // 被蓋掉的 `first draft` 在，而 create op 寫下的標題也在 —— 它就是 title
    // 的第一次寫入（票 B9），所以落在 t 最小的位置。
    expect(writes('01JBXA')).toEqual([
      { field: 'title', value: 'Fix login redirect', actor: 'test', t: 1 },
      { field: 'status', value: 'todo', actor: 'test', t: 2 },
      { field: 'description', value: 'first draft', actor: 'test', t: 3 },
      { field: 'description', value: 'second draft', actor: 'test', t: 4 },
      { field: 'title', value: 'Fix the login redirect', actor: 'test', t: 5 },
      { field: 'archived', value: true, actor: 'test', t: 6 },
    ]);
  });

  it('不含 comment 與 label —— 它們不是 LWW 欄位，撈不回舊值的問題不在它們身上', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });
    post('/i/01JBXA', { comment: 'looks wrong', labels: { add: ['bug'] } });

    // 只剩 create 折出來的那一筆 title：comment 與 label.add 都不在。
    expect(writes('01JBXA')).toEqual([
      { field: 'title', value: 'Fix login redirect', actor: 'test', t: 1 },
    ]);
  });
});

/**
 * 票 B9：`create` op **就是** `title` 的第一次寫入。CLI 在 A12（`df7c80e`）就這樣
 * 折了，這條端點沒跟上，於是 studio 的變更歷史面板對一張沒改過的 Issue 說
 * 「欄位還沒有被改過」，而且每一張 Issue 的原始標題都不在面板裡 —— 那正是誤刪
 * 之後最先要找的那一列。
 */
describe('GET /api/history/<ref> 與 create op 寫下的標題', () => {
  it('一張只被 create 過的 Issue —— writes 含那筆 title，不是空陣列', () => {
    createWith(fullId('01JBXA'), { title: '從沒改過的那一張' });

    const res = history('01JBXA');

    expect(res.status).toBe(200);
    expect(writes('01JBXA')).toEqual([
      { field: 'title', value: '從沒改過的那一張', actor: 'test', t: 1 },
    ]);
  });

  it('create 之後改過標題 —— 第一筆是 create 那次（t 較小），第二筆才是改寫', () => {
    createWith(fullId('01JBXA'), { title: '原本的標題' });
    post('/i/01JBXA', { title: '改過的標題' });

    const titles = writes('01JBXA');

    // 折出來的那一筆不是附在後面，而是照 opLog 的全序落在它自己的位置上。
    expect(titles).toEqual([
      { field: 'title', value: '原本的標題', actor: 'test', t: 1 },
      { field: 'title', value: '改過的標題', actor: 'test', t: 2 },
    ]);
    expect(titles[0]!.t).toBeLessThan(titles[1]!.t);
  });
});

/** 沿用 `applyChange` 既有的那張對應表：解析不出 ref 是 404，不是 500。 */
describe('GET /api/history/<ref> 的錯誤對應', () => {
  it('RefNotFound → 404，不外洩例外也不外洩內容', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    for (const ref of [fullId('01JBXC'), 'ZZZZZZ', '../../etc/passwd']) {
      const res = history(ref);
      expect(res.status, ref).toBe(404);
      expect(res.body, ref).not.toContain('Fix login redirect');
      expect(res.body, ref).not.toContain('at Object');
    }
  });

  it('AmbiguousRef → 404，且內文含足以區分的候選', () => {
    createWith(fullId('01JBXAB'), { title: 'Fix login redirect' });
    createWith(fullId('01JBXAC'), { title: 'Union merge spike' });

    const res = history('01JBXA');

    expect(res.status).toBe(404);
    // 「足以區分」的長度：6 碼兩張一模一樣，所以候選必須印到第 7 碼。
    expect(res.body).toContain('01JBXAB');
    expect(res.body).toContain('01JBXAC');
  });
});

/**
 * **已刪的 Issue 的歷史照樣讀得到，而且是 200。** 寫入面對它是 410（那張
 * 不再接受寫入），但讀取面不是 —— `opLog` 對已刪的 Issue 照常（ADR-0009），
 * 而那正是誤刪的救生索：drawer 的刪除確認框就是這樣答應使用者的。
 */
describe('GET /api/history/<已刪的 ref>', () => {
  it('照樣讀得到，200，且含那一筆刪除本身', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect', status: 'todo' });
    post('/i/01JBXA', { description: 'the losing draft' });
    expect(post('/i/01JBXA', { deleted: true }).status).toBe(200);
    // board 已經當它不存在，連 all: true 都看不到它 —— 歷史仍然在。
    expect(board().list({ all: true })).toHaveLength(0);

    const res = history('01JBXA');

    expect(res.status).toBe(200);
    expect(writes('01JBXA')).toEqual([
      { field: 'title', value: 'Fix login redirect', actor: 'test', t: 1 },
      { field: 'status', value: 'todo', actor: 'test', t: 2 },
      { field: 'description', value: 'the losing draft', actor: 'test', t: 3 },
      { field: 'deleted', value: true, actor: 'test', t: 4 },
    ]);
    // 救生索要撈得回來的是「它叫什麼」與「它是什麼時候被刪的」—— 兩者都要在。
    // 少了 title 那一列，刪除確認框指著這條端點時說的那句話就是假的。
    expect(writes('01JBXA').map((w) => w.field)).toContain('title');
    expect(writes('01JBXA').map((w) => w.field)).toContain('deleted');
  });
});

/**
 * **兩條新端點都住在 `/api/` 底下，不是 `/i/`。** `/i/` 這個前綴的意思就是
 * 「寫入面」—— 405 白名單的判準字面上是 `path.startsWith(ISSUE_PREFIX)`，
 * 讀取路徑一旦借用它，就等於讓一條 GET 路徑變成可 POST 的。
 */
describe('唯讀端點沒有讓 405 白名單鬆動', () => {
  const READ_ONLY = ['/api/board-info', '/api/history/01JBXA', '/api/history/x', '/api/history/'];

  it('POST 到這兩條路徑是 405、Allow 說 GET，且一個 op 都沒落下', () => {
    const id = fullId('01JBXA');
    createWith(id, { title: 'Fix login redirect' });
    const before = opsOnDisk(id).length;

    for (const url of READ_ONLY) {
      const res = post(url, { title: 'should never land' });
      // 404 在這裡是錯的答案：那表示請求已經進到路由，也就是白名單放它過了。
      expect(res.status, `POST ${url}`).toBe(405);
      expect(res.headers['allow'], `POST ${url}`).toBe('GET');
    }

    expect(opsOnDisk(id)).toHaveLength(before);
    expect(board().refs()).toHaveLength(1);
  });

  it('PUT / DELETE / PATCH 也是 405，Allow 說 GET', () => {
    for (const url of READ_ONLY) {
      for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
        const res = handleRequest(board(), decisionLog(), { method, url }, { assetsDir: assets });
        expect(res.status, `${method} ${url}`).toBe(405);
        expect(res.headers['allow'], `${method} ${url}`).toBe('GET');
      }
    }
  });
});

/**
 * 沒有 ref 就沒有歷史可言 —— 404，而不是一份空的 `writes`。空清單說的是
 * 「這張 Issue 沒有被寫過」，那是一個**關於某張 Issue 的答案**；而呼叫端
 * 根本沒有指定是哪一張。同 `nook history` 少了 ref 時的拒絕。
 */
describe('GET /api/history/ 沒有 ref', () => {
  it('404，不外洩任何 board 內容', () => {
    createWith(fullId('01JBXA'), { title: 'Fix login redirect' });

    for (const url of ['/api/history/', '/api/history']) {
      const res = get(url);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('writes');
      expect(res.body, url).not.toContain('Fix login redirect');
    }
  });
});

/**
 * 票 01：Studio 開始知道 Decision 存在。第一片是唯讀 —— 兩條 GET 端點，
 * 鏡射 Issue 的 `/api/board`／`/hash`。
 *
 * **每個用例自己 `mkdir .decisions/decisions`，不是共用的 `beforeEach`** ——
 * 這個目錄一存在，既有的 `board.health()` 就會連帶檢查 Decision 那份
 * merge=union 保證（`diagnose()` 已泛化成掃描已知實體清單），把它放進全域
 * `beforeEach` 會讓 `/api/board-info 的 diagnostics` 那組既有測試多一條
 * 不相干的 `MissingMergeDriver`。
 */
function initDecisionLog(): void {
  mkdirSync(join(dir, '.decisions', 'decisions'), { recursive: true });
}

const createDecisionWith = (decisionId: string, title: string, over: { body?: string; disposition?: string } = {}) => {
  initDecisionLog();
  return openDecisionLog({ dir, actor: 'test', ids: seeded(decisionId) }).create({ title, ...over });
};

describe('GET /api/decisions', () => {
  it('回傳 DecisionBoardSnapshot：decisions 陣列與 hash', () => {
    createDecisionWith(fullId('01JDEC1'), 'Adopt trunk-based development');

    const res = get('/api/decisions');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);

    const snapshot = JSON.parse(res.body) as DecisionBoardSnapshot;
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.decisions[0]).toMatchObject({
      id: fullId('01JDEC1'),
      title: 'Adopt trunk-based development',
      disposition: 'proposed',
      body: '',
    });
    // bodyHtml 是預渲染的安全 HTML，同 IssueView.descriptionHtml 的既有規則。
    expect(snapshot.decisions[0]!.bodyHtml).toBeTypeOf('string');
    expect(snapshot.hash).toBeTypeOf('string');
  });

  it('一個 Decision 都沒有時回空陣列，不炸開', () => {
    initDecisionLog();

    const res = get('/api/decisions');

    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as DecisionBoardSnapshot).decisions).toEqual([]);
  });

  it('shortId 對整塊 decision log 算，同 IssueView 既有的 displayLength 規則', () => {
    createDecisionWith(fullId('01JDECQ'), 'Adopt trunk-based development');
    createDecisionWith(fullId('01JDECR'), 'Use conventional commits');

    const snapshot = JSON.parse(get('/api/decisions').body) as DecisionBoardSnapshot;
    const view = snapshot.decisions.find((d) => d.id === fullId('01JDECQ'));

    // 兩筆只在第 7 碼分開，所以 6 碼不夠 —— shortId 因此對整塊 log 算。
    expect(view!.shortId).toBe('01JDECQ');
  });

  it('supersededBy／legacyRef 沒被寫過時整格不存在，不是空字串', () => {
    createDecisionWith(fullId('01JDEC1'), 'Adopt trunk-based development');

    const [view] = JSON.parse(get('/api/decisions').body).decisions as Record<string, unknown>[];

    expect(Object.hasOwn(view!, 'supersededBy')).toBe(false);
    expect(Object.hasOwn(view!, 'legacyRef')).toBe(false);
  });

  // 票 01 這裡曾經斷言 POST /api/decisions 是 405（那一批沒有寫入端點）。
  // 這一批（票 02）把這條路徑加進白名單，新增行為的測試搬到下面的
  // `describe('POST /api/decisions')`。
});

/**
 * 新增是這一批（票 02）唯一新增的 Decision 寫入端點 —— 同 `POST /api/issues`
 * 的理由：建立的時候還沒有 ref 可以放進 URL，`POST /d/<ref>` 因此不可能承接它
 * （那是票 03 的範圍）。
 */
describe('POST /api/decisions', () => {
  it('建立一筆 Decision：201 + DecisionView，而且下一次 /api/decisions 就有它', () => {
    initDecisionLog();
    const res = post('/api/decisions', { title: 'Adopt trunk-based development' });

    // 201 而不是 200：這次請求造出了一個之前不存在的資源（RFC 9110）。
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/^application\/json/);

    const view = JSON.parse(res.body) as DecisionView;
    expect(view.title).toBe('Adopt trunk-based development');
    // server 產生 ULID —— client 沒有 id 可以先畫，同 Issue 的新增規則。
    expect(view.id).toMatch(/^[0-9A-Z]{26}$/);
    // disposition 沒送 → core 的預設值 `proposed`（`decisionLog.create()` 的決定，
    // 不是這個端點自己填的）。
    expect(view.disposition).toBe('proposed');
    expect(view.body).toBe('');

    // 回應說建立成功了不算數，下一次全量讀取看得到它才算。
    const decisions = JSON.parse(get('/api/decisions').body).decisions as DecisionView[];
    expect(decisions.map((d) => d.id)).toContain(view.id);
    expect(decisionLog().get(view.id).title).toBe('Adopt trunk-based development');
  });

  it('沒有 title、title 不是字串、或 trim 後是空的 → 400，且不造出任何 Decision', () => {
    initDecisionLog();
    const rejected: unknown[] = [{}, { title: '' }, { title: '   ' }, { title: '\n\t' }, { title: 1 }, { title: null }, { title: ['x'] }];

    for (const body of rejected) {
      const res = post('/api/decisions', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    // 一筆都不該存在 —— 半成品的 Decision 檔比一個錯誤訊息貴得多。
    expect(decisionLog().refs()).toHaveLength(0);
  });

  it('body／disposition 一起送 → 201，且那筆真的帶著它們', () => {
    initDecisionLog();
    const res = post('/api/decisions', {
      title: 'Adopt trunk-based development',
      body: 'Because long-lived branches rot.',
      disposition: 'accepted',
    });

    expect(res.status).toBe(201);
    const view = JSON.parse(res.body) as DecisionView;
    expect(view.body).toBe('Because long-lived branches rot.');
    expect(view.disposition).toBe('accepted');
    expect(decisionLog().get(view.id).disposition).toBe('accepted');
  });

  it('disposition 不合法 → 400，不是 500，且不造出任何 Decision', () => {
    initDecisionLog();
    // 不存在的值、對應到多個 Disposition 的前綴（accepted/superseded 都沒有
    // 撞號的前綴，這裡改用一個對不到任何值的前綴）、空字串、非字串。
    for (const disposition of ['nope', '', 5, null, ['accepted']]) {
      const res = post('/api/decisions', { title: 'Adopt trunk-based development', disposition });
      expect(res.status, JSON.stringify(disposition)).toBe(400);
      expect(res.body, JSON.stringify(disposition)).not.toContain('at Object');
    }

    expect(decisionLog().refs()).toHaveLength(0);
  });

  /**
   * 沿用寫入面既有的「不認得的欄位一律拒絕」（同 `POST /api/issues` 的
   * `CREATE_FIELDS`）：`supersededBy`／`legacyRef` 刻意不收 —— 表單只填標題，
   * 端點不該提供沒有呼叫端的能力。
   */
  it('title / body / disposition 以外的鍵 → 400，且不造出任何 Decision', () => {
    initDecisionLog();
    const rejected: unknown[] = [
      { title: 'x', supersededBy: '01JBXA' },
      { title: 'x', legacyRef: 'ADR-0001' },
      { title: 'x', id: fullId('01JDEC1') },
      // 打錯的欄位名：靜靜地少一格，比一次 400 難查得多。
      { title: 'x', dispositon: 'accepted' },
    ];

    for (const body of rejected) {
      const res = post('/api/decisions', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    expect(decisionLog().refs()).toHaveLength(0);
  });

  it('body 不是 JSON 物件 → 400，不是 500', () => {
    initDecisionLog();
    for (const body of ['', '{', 'not json', 'null', '42', '"x"', '["x"]']) {
      const res = post('/api/decisions', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    expect(decisionLog().refs()).toHaveLength(0);
  });

  /**
   * `/api/decisions` 跟 `/api/issues` 不同 —— **兩個方法都合法**（GET 讀快照、
   * POST 新增），所以既不是 issues 那種「GET 也是 405」的純寫入路徑，也不是
   * 一般唯讀端點那種「只有 GET」。Allow 因此要同時列出兩者（RFC 9110：
   * Allow 講的是這個資源支援什麼），而不是照搬 `/api/issues` 那份「只有 POST」。
   */
  it('PUT / DELETE / PATCH 是 405，Allow 同時列出 GET 與 POST', () => {
    for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      const res = handleRequest(board(), decisionLog(), { method, url: '/api/decisions' });
      expect(res.status, method).toBe(405);
      expect(res.headers['allow'], method).toBe('GET, POST');
    }
  });
});

describe('GET /decision-hash', () => {
  it('回傳裸文字指紋，同 /hash 的形狀（不是 JSON）', () => {
    createDecisionWith(fullId('01JDEC1'), 'Adopt trunk-based development');

    const res = get('/decision-hash');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toBe(decisionHashOf());
  });

  it('新增一筆之後指紋跟著換', () => {
    initDecisionLog();
    const before = get('/decision-hash').body;

    createDecisionWith(fullId('01JDEC1'), 'Adopt trunk-based development');

    expect(get('/decision-hash').body).not.toBe(before);
  });

  it('POST /decision-hash 是 405，Allow 說 GET', () => {
    // 同上：405 白名單先擋下，這則請求連不到 decisionLog。
    const res = post('/decision-hash', {});

    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('GET');
  });
});

/** `/decision-hash` 的期望值：對 `decisionLog.list({})` 的雜湊，直接算一次來比對。 */
function decisionHashOf(): string {
  return createHashOfDecisions(decisionLog().list({}));
}

function createHashOfDecisions(decisions: unknown): string {
  return createHash('sha256').update(JSON.stringify(decisions)).digest('hex');
}
