import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lazyDecisionLog } from '../core/decisionLog.js';
import type { Board } from '../core/types.js';
import { handleRequest } from './handler.js';
import type { HandlerOptions, StudioResponse } from './handler.js';

/**
 * 只綁 loopback。ADR-0007 之後 `--host` 不是「暫時沒做」而是**永遠不做** ——
 * studio 開放寫入之後，綁 127.0.0.1 從保守的預設值升格為**唯一的安全機制**。
 *
 * 兩個理由，各自都足以否決 `--host`：
 *
 * 1. **studio 沒有任何驗證。** 讓它出現在其他介面上，就是把整塊 board 的
 *    **寫入權**送給同一個網段 —— 唯讀時期漏的是內容，現在漏的是控制權。
 * 2. **actor 是跑 `nook studio` 的那個人。** 經由 studio 產生的每一個 op 都
 *    記在 `git config user.email` 推導出的同一個 actor 上。變成多人共用的
 *    服務會讓所有人的 op 記在同一個名字底下，摺疊時的決勝依據就此失效。
 *
 * 要跨機器看，用 SSH port forward —— 那條路徑上驗證的是 SSH，不是 nook。
 */
const HOST = '127.0.0.1';

/** 任意選定的高位 port，避開 3000 / 5173 / 8080 這類常見預設值。 */
export const DEFAULT_PORT = 4780;

export interface Studio {
  readonly url: string;
  close(): Promise<void>;
}

export interface ServeOptions {
  readonly port?: number;
  /**
   * 前端資產目錄，預設為套件自己的 `dist/studio/`。
   *
   * 存在的理由是測試：資產是磁碟上的檔案（ADR-0008），所以「服務得出來嗎」
   * 只能對著一個真的目錄問。有了它，測試就不必先跑一次 vite build ——
   * 也不會跟 packed-smoke 中途的 `tsup --clean` 撞在一起。
   */
  readonly assetsDir?: string;
  /**
   * 這個 studio 是不是被 `serveWorkspace()` 的 `/launch/<n>` 啟動的成員 ——
   * 原樣轉給 `HandlerOptions`，只影響 `/api/board-info` 的 `fromWorkspace`
   * 欄位。獨立呼叫 `serve()` 的呼叫端（`cmdStudio`）不傳，預設 `false`。
   */
  readonly fromWorkspace?: boolean;
}

export class PortInUse extends Error {
  constructor(readonly port: number) {
    super(`port ${port} is already in use (use --port to pick another one)`);
    this.name = 'PortInUse';
  }
}

/** 一個請求的主體，讀成 utf8 字串。 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * 一則未預期失敗留在終端機上的紀錄。
 *
 * **管道就是 `console.error`，不是注入進來的接收器。** ADR-0004：只有單一
 * adapter 的介面是掩體不是接縫，而這裡說不出第二個真實的使用者 —— 若在
 * `ServeOptions` 上多開一個接收器，實際會傳它的只有測試（`cmdStudio` 是
 * 唯一的生產呼叫端，它不會傳）。讀者本來就是跑 `nook studio` 的那個人，
 * 那個終端機就開在他面前，stderr 直接送到得了。
 *
 * **只記未預期的那些**，判準是 `status >= 500`。404（ref 找不到）、
 * 400（body 不合法）、405（方法不對）都是系統正常運作時的回應；把它們也
 * 記下來，等於讓前端每 2 秒一次的輪詢與每一次 `nook list` 都在洗版，
 * 而真正需要被看見的那一行就埋在裡面 —— 一個什麼都印的終端機沒有人讀。
 *
 * **只留下一行 message，沒有 stack 也沒有 error class —— 這是刻意的。**
 * 訊息取自回應主體而不是 Error 物件：`handleRequest` 是純函數，例外在它
 * 那一格變成值的時候就只剩下 message（見 handler.ts 的 `serverError`），
 * serve.ts 拿不到原本擲出的東西。對 BoardNotInitialized 這一類，這正好是
 * 對的 ——「先執行 nook init」說得出下一步，一份 stack 說不出；終端機上
 * 讀到的與瀏覽器那邊收到的也是同一句話。真的是內部 bug 的時候，這一行
 * 確實薄，而那個代價是知情之後接受的。
 *
 * 被否決的做法是讓 `handleRequest` 在回應之外另外把原本擲出的 Error 交出來，
 * 好讓這裡印得出 stack。**不划算，兩個理由：**
 *
 * 1. **要付的是 `handleRequest` 的純函數性質，而那份性質已經付過好幾次帳。**
 *    500 兜底不必綁 port 就測得到、rejection 路徑是在構造上不存在而不是靠
 *    try/catch 補起來的（見下面 createServer 裡那段）、`logUnexpected` 只靠
 *    狀態碼就成立，從頭到尾不必看見原始 Error。開一條「回應之外的第二個
 *    輸出」就是把回應以外的東西塞回那道接縫，上面三件事全部要重新論證。
 * 2. **studio 只綁 loopback（ADR-0007）。** 真出事的時候，使用者就坐在跑這個
 *    process 的那台機器前面，手上有那塊 board 與自己剛剛做過的操作 —— 重現
 *    步驟造得出來。stack 在這裡省下的是那一步，不是唯一的線索。換成一個看不
 *    到現場的遠端服務，這個結論才會反過來。
 */
function logUnexpected(method: string, url: string, out: StudioResponse): void {
  if (out.status < 500) return;
  console.error(`nook studio: ${out.status} ${method} ${url} —— ${out.body.trim()}`);
}

/**
 * `serveAutoPort()` 最多往上跳幾個 port 就放棄，改成直接把最後一次的
 * `PortInUse` 丟出去。20 個涵蓋得了「筆電上同時開好幾個 `nook studio`」這種
 * 真實情境；到了這個數字還在撞，通常是別的問題（忘記關掉的殭屍 process 一路
 * 佔滿一整段高位 port），繼續往上找只是把同一句錯誤往後拖延。
 */
const MAX_AUTO_PORT_ATTEMPTS = 20;

/**
 * 跟 `serve()` 一樣，唯一差別：`opts.port` 沒給時，預設 port 被占用就往上
 * +1 再試，而不是直接以 `PortInUse` 失敗。
 *
 * 同一台機器上開多個 `nook studio`（不同 board、不同終端機分頁）是常見情境
 * —— 沒有理由要求使用者手動試出下一個空位。只在「呼叫端沒指定 `opts.port`」
 * 時才跳號：`opts.port` 一旦是明講出來的號碼，代表背後有特定用途（寫死在
 * 另一支工具設定裡、或是腳本依賴這個固定號碼），撞到了就該直接失敗讓使用者
 * 知道 —— 自動跳號在那種情境下是把選擇權拿走，不是幫忙。
 */
export async function serveAutoPort(board: Board, opts: ServeOptions = {}): Promise<Studio> {
  if (opts.port !== undefined) return serve(board, opts);

  const start = DEFAULT_PORT;
  for (let i = 0; i < MAX_AUTO_PORT_ATTEMPTS; i++) {
    try {
      return await serve(board, { ...opts, port: start + i });
    } catch (err) {
      const isLastAttempt = i === MAX_AUTO_PORT_ATTEMPTS - 1;
      if (!(err instanceof PortInUse) || isLastAttempt) throw err;
    }
  }
  /* c8 ignore next -- 迴圈每一輪都以 return 或 throw 收尾，這行不可達 */
  throw new Error('unreachable');
}

export function serve(board: Board, opts: ServeOptions = {}): Promise<Studio> {
  const port = opts.port ?? DEFAULT_PORT;
  // 只把有指定的欄位往下傳：exactOptionalPropertyTypes 之下，
  // `{ assetsDir: undefined }` 與「沒給」不是同一件事。
  const handlerOpts: HandlerOptions = {
    ...(opts.assetsDir === undefined ? {} : { assetsDir: opts.assetsDir }),
    ...(opts.fromWorkspace === undefined ? {} : { fromWorkspace: opts.fromWorkspace }),
  };
  // 惰性建構（見 `decisionLog.ts` 的 `lazyDecisionLog`）：`board.root()` 要求
  // 那個目錄已經是一塊初始化過的 board，而 `nook studio` 允許在 `nook init`
  // 之前就開起來 —— `GET /` 的殼本來就不碰 board，SPA 上場之後 `/api/board`
  // 才會答一句「不是一個 Nook board」，讀的人因此看得到下一步（`App.tsx` 的
  // `LoadFailure`）。若在這裡搶先問 `board.root()`，`serve()` 回傳的 Promise
  // 會在使用者看到那句話之前就直接 reject，連 `studio.url` 都印不出來。
  const decisionLog = lazyDecisionLog(board);

  const server = createServer((req, res) => {
    // 主體一律先讀完再交給 handler：handleRequest 是純函數（不接觸 node:http），
    // 所以串流不能穿過那道接縫。非 POST 的請求沒有主體，'end' 下一個 tick 就到。
    //
    // **這裡刻意沒有 try/catch，而且不要加一個。** 下面那個成功續行跑在後來的
    // 一個 tick 上，包在這個 callback 外圍的 try/catch 接不到它拋的任何東西 ——
    // 那會變成 unhandled rejection，也就是整個 process 當場結束（例如 session
    // 進行中 board 目錄被移走，下一個請求丟 BoardNotInitialized）。真正的保證
    // 來自 handleRequest 是全函數：它對任何輸入都回傳一份 StudioResponse，
    // 未預期的例外在它自己那一格就變成 500。要改那條保證，改 handler.ts。
    void readBody(req).then(
      (body) => {
        const method = req.method ?? 'GET';
        const url = req.url ?? '/';
        const out = handleRequest(board, decisionLog, { method, url, body }, handlerOpts);
        // 記錄在回應之前，而且在同一個續行裡：拿到 500 的那一方（瀏覽器上的
        // 斷線橫幅）會叫讀者去看終端機，那則紀錄不能比它晚到。
        logUnexpected(method, url, out);
        res.writeHead(out.status, out.headers);
        res.end(out.body);
      },
      () => {
        // 請求還沒送完連線就斷了 —— 已經沒有人在等這個回應。
        res.destroy();
      },
    );
  });

  return new Promise<Studio>((resolve, reject) => {
    const onListenError = (err: NodeJS.ErrnoException): void => {
      // 這是使用者唯一會實際撞到的失敗，而且他當下要的是「換一個 port」，
      // 不是一份 stack trace。其餘的原樣丟出去 —— 猜不出來的事就不要猜。
      reject(err.code === 'EADDRINUSE' ? new PortInUse(port) : err);
    };

    server.once('error', onListenError);
    server.listen({ host: HOST, port }, () => {
      server.removeListener('error', onListenError);
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://${HOST}:${address.port}`,
        close: () =>
          new Promise<void>((done, fail) => {
            // 關兩次是正常的：SIGINT 與正常結束兩條路徑都會呼叫。
            if (!server.listening) return done();
            // keep-alive 的連線會讓 close() 一直等下去 —— 先斷開它們，
            // 否則「乾淨關閉」在測試裡就是掛住。
            server.closeAllConnections();
            server.close((err) => (err === undefined || err === null ? done() : fail(err)));
          }),
      });
    });
  });
}
