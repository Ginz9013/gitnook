import type { BoardSnapshot, CommentView, IssueView } from '../server/handler.js';
import type { Status } from '../core/types.js';

/**
 * SPA 與 server 之間的讀取面。
 *
 * **這裡對 server 的 import 一律是 `import type`**，而且必須維持如此。
 * 型別在打包時整條被抹掉，所以 `src/server/**` 不會出現在 studio 的 bundle 裡，
 * 反向也一樣：`src/cli/run.ts` 的 import 鏈永遠碰不到 React（ADR-0008）。
 * 只要有人把其中一條改成值的 import，這條保證就沒了。
 */
export type { BoardSnapshot, CommentView, IssueView, Status };

const BOARD_URL = '/api/board';
const HASH_URL = '/hash';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal === undefined ? {} : { signal });
  if (!res.ok) throw new Error(`${url} 回了 ${res.status}`);
  return (await res.json()) as T;
}

/** 一次全量快照。ADR-0002：沒有快取也沒有增量 —— 全量掃描加摺疊就是實作。 */
export function fetchBoard(signal?: AbortSignal): Promise<BoardSnapshot> {
  return getJson<BoardSnapshot>(BOARD_URL, signal);
}

/**
 * 當前 board 的指紋。輪詢用它比對，值變了才去抓完整快照（票 05）——
 * 指紋是 64 字元，快照是整塊 board。
 */
export async function fetchHash(signal?: AbortSignal): Promise<string> {
  const res = await fetch(HASH_URL, signal === undefined ? {} : { signal });
  if (!res.ok) throw new Error(`${HASH_URL} 回了 ${res.status}`);
  return await res.text();
}
