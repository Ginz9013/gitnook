import type { BoardSnapshot, CommentView, IssueView } from '../server/handler.js';
import type { Change, Status } from '../core/types.js';

/**
 * SPA 與 server 之間的那一面 —— 讀取與寫入都在這裡，**只有這裡**。
 *
 * **這裡對 server 與 core 的 import 一律是 `import type`**，而且必須維持如此。
 * 型別在打包時整條被抹掉，所以 `src/server/**` 不會出現在 studio 的 bundle 裡，
 * 反向也一樣：`src/cli/run.ts` 的 import 鏈永遠碰不到 React（ADR-0008）。
 * 只要有人把其中一條改成值的 import，這條保證就沒了。
 */
export type { BoardSnapshot, Change, CommentView, IssueView, Status };

/**
 * 伺服器**答了**，但答的是一個錯誤狀態碼。
 *
 * 這個型別存在的唯一理由是讓呼叫端分得出兩件事：「連不上」（`fetch` 自己丟的
 * `TypeError`，沒有狀態碼可讀）與「連上了，但伺服器說不」。票 02 之前兩者在
 * `poll.ts` 的 `catch` 裡是同一個事件，於是 board 目錄被移走時，橫幅會說
 * 「伺服器沒有回應」——把讀的人送去查網路，而不是查 board。
 *
 * `status` 是**唯一**多出來的資訊，其餘（url、message）維持原本的字串形狀，
 * 因為 `postChange` 的失敗橫幅直接顯示 `err.message`（`App.tsx`），那句話不變。
 */
export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const BOARD_URL = '/api/board';
const HASH_URL = '/hash';
const ISSUE_PREFIX = '/i/';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal === undefined ? {} : { signal });
  if (!res.ok) throw new HttpError(url, res.status, `${url} 回了 ${res.status}`);
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
  if (!res.ok) throw new HttpError(HASH_URL, res.status, `${HASH_URL} 回了 ${res.status}`);
  return await res.text();
}

/**
 * 一次寫入 —— `POST /i/<ref>`（票 03）。body 是一份 `Change`，回應是套用後的
 * 整張 `IssueView`。端點直接鏡射 `board.apply(ref, change)`，所以這裡不發明
 * 任何新詞彙，也不做任何包裝。
 *
 * **拖曳與 drawer 共用這一份。** 兩處各寫一次 fetch 慣例（header、錯誤訊息、
 * 回應形狀）遲早會分歧，而分歧的那一半是靜默的：`POST` 送錯 content-type 只
 * 會換來一個 400，看起來像是使用者的資料有問題。
 *
 * **只送 `Change` 定義的鍵。** 票 03 對不認得的欄位回 400 而不是忽略：
 * append-only 之下沒有「被拒絕的寫入」可以事後翻查，一個打錯的欄位名若被
 * 靜靜吃掉，呼叫端看到的是 200 加上一張沒有變化的 Issue。
 */
export async function postChange(ref: string, change: Change): Promise<IssueView> {
  // ref 是 server 給的 ULID（只有 [0-9A-Z]），編碼對它是恆等變換；寫出來是
  // 為了讓「路徑片段就是路徑片段」這件事不必靠 id 的字元集來成立。
  const url = `${ISSUE_PREFIX}${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change),
  });
  if (!res.ok) throw new HttpError(url, res.status, `${url} 回了 ${res.status}：${await res.text()}`);
  return (await res.json()) as IssueView;
}
