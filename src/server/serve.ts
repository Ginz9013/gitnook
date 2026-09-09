import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Board } from '../core/types.js';
import { handleRequest } from './handler.js';
import type { HandlerOptions } from './handler.js';

/**
 * 只綁 loopback，且刻意不提供 --host。studio 是唯讀的會議投影用檢視器，
 * 沒有任何驗證 —— 讓它出現在其他介面上就是把整個 board 送給同一個網段。
 * 要跨機器看，用 SSH port forward。
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
}

export class PortInUse extends Error {
  constructor(readonly port: number) {
    super(`port ${port} 已被占用（用 --port 指定另一個 port）`);
    this.name = 'PortInUse';
  }
}

export function serve(board: Board, opts: ServeOptions = {}): Promise<Studio> {
  const port = opts.port ?? DEFAULT_PORT;
  // 只把有指定的欄位往下傳：exactOptionalPropertyTypes 之下，
  // `{ assetsDir: undefined }` 與「沒給」不是同一件事。
  const handlerOpts: HandlerOptions = opts.assetsDir === undefined ? {} : { assetsDir: opts.assetsDir };

  const server = createServer((req, res) => {
    const out = handleRequest(board, { method: req.method ?? 'GET', url: req.url ?? '/' }, handlerOpts);
    res.writeHead(out.status, out.headers);
    res.end(out.body);
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
