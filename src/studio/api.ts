import type {
  BoardInfo,
  BoardSnapshot,
  CommentView,
  DecisionBoardSnapshot,
  DecisionView,
  IssueHistory,
  IssueView,
  WriteView,
} from '../server/handler.js';
import type { Change, Diagnostic, DiagnosticKind, Status } from '../core/types.js';
import type { Disposition } from '../core/decisionTypes.js';

/**
 * SPA 與 server 之間的那一面 —— 讀取與寫入都在這裡，**只有這裡**。
 *
 * **這裡對 server 與 core 的 import 一律是 `import type`**，而且必須維持如此。
 * 型別在打包時整條被抹掉，所以 `src/server/**` 不會出現在 studio 的 bundle 裡，
 * 反向也一樣：`src/cli/run.ts` 的 import 鏈永遠碰不到 React（ADR-0008）。
 * 只要有人把其中一條改成值的 import，這條保證就沒了。
 */
export type {
  BoardInfo,
  BoardSnapshot,
  Change,
  CommentView,
  DecisionBoardSnapshot,
  DecisionView,
  Diagnostic,
  DiagnosticKind,
  Disposition,
  IssueHistory,
  IssueView,
  Status,
  WriteView,
};

/**
 * 伺服器**答了**，但答的是一個錯誤狀態碼。
 *
 * 這個型別存在的唯一理由是讓呼叫端分得出兩件事：「連不上」（`fetch` 自己丟的
 * `TypeError`，沒有狀態碼可讀）與「連上了，但伺服器說不」。票 02 之前兩者在
 * `poll.ts` 的 `catch` 裡是同一個事件，於是 board 目錄被移走時，橫幅會說
 * 「伺服器沒有回應」——把讀的人送去查網路，而不是查 board。
 *
 * **`detail` 是伺服器在 body 裡實際說的那句話**，與 `message` 分開兩格。
 * `handler.ts` 的 `serverError` 刻意送一則可行動的訊息（「不是一個 Nook board：
 * /path…」），而中斷橫幅要引用的正是那一句 —— 它是使用者手上唯一精確的證據。
 * 混進 `message` 就得從 `${url} 回了 ${status}：` 這個前綴裡把它切回來，而
 * 切字串是猜；分成兩格則不必猜。空白 body = 沒有話可引用 = `null`，橫幅因此
 * 分得出「伺服器說了什麼」與「它只回了一個狀態碼」。
 *
 * `message` 維持原本的字串形狀，因為 `postChange` 的失敗橫幅直接顯示
 * `err.message`（`App.tsx`），那句話不變。
 */
export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    message: string,
    /** 伺服器在 body 裡說的那句話；沒有可引用的內容時是 null。 */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * 伺服器在 body 裡說的那句話 —— 空白的 body 沒有話可引用，回 null。
 *
 * 讀 body 自己失敗時同樣回 null，而不是讓那個例外逃出去：狀態碼已經證明伺服器
 * 答了，讓讀 body 的失敗取代 `HttpError` 會使橫幅倒退回「連不上」，也就是這一層
 * 存在的理由本身。
 */
async function said(res: Response): Promise<string | null> {
  const body = await res.text().catch(() => '');
  const text = body.trim();
  return text === '' ? null : text;
}

/**
 * 伺服器**答了 200**，但 body 不是承諾的那個形狀 —— `JSON.parse` 解不開。
 *
 * 具名，是因為 `poll.ts` 不准從例外的型別去猜這件事：`SyntaxError` 可能來自
 * 任何一層，而猜錯的下場是橫幅說「連不上」，把讀的人送去查一個活得好好的
 * 伺服器。知道「這是解析回應失敗」的地方只有這裡 —— 這一行 `catch` 兩側都是
 * 我們自己的程式碼，中間只有一次 `JSON.parse`，沒有第二個嫌疑犯。
 *
 * **不帶 body 的內容。** 這種狀況下的 body 通常是別的服務的 HTML 錯誤頁，
 * 貼進橫幅是噪音而不是線索；有可行動內容的那種 body 走的是 `HttpError.detail`。
 */
export class MalformedResponseError extends Error {
  constructor(readonly url: string) {
    super(`${url} returned 200, but the body is not JSON`);
    this.name = 'MalformedResponseError';
  }
}

/**
 * 這塊 body 是不是一份 `BoardSnapshot` —— 只看頂層。
 *
 * 存在的理由是 `getJson` 以前解得開就 `as T`：合法但形狀不對的 JSON
 * （`{"nope":1}`）會被放行，然後在某個離這裡很遠的地方炸成一個看起來無關的
 * TypeError。要擋的是「打錯 port，另一個 server 在那裡回了 JSON」。
 */
export function isBoardSnapshot(value: unknown): value is BoardSnapshot {
  // null 要先擋掉，不然讀 `.issues` 會丟 TypeError —— 而那個 TypeError 在
  // `poll.ts` 那裡沒有名字可認，會落進 `'failed'`，橫幅於是說「連不上」。
  if (value === null || typeof value !== 'object') return false;
  const body = value as { issues?: unknown; hash?: unknown };
  return Array.isArray(body.issues) && typeof body.hash === 'string';
}

/**
 * 這塊 body 是不是一份 `BoardInfo` —— 只看頂層，同 `isBoardSnapshot`。
 *
 * 存在的理由一樣：`getJson` 的 `isShape` 是必填，而它必填正是為了讓多一個端點
 * 的人在這裡回答「怎樣算是答對了」。
 */
export function isBoardInfo(value: unknown): value is BoardInfo {
  if (value === null || typeof value !== 'object') return false;
  const body = value as {
    root?: unknown;
    branch?: unknown;
    actor?: unknown;
    diagnostics?: unknown;
  };
  return (
    typeof body.root === 'string' &&
    // `null` 是正常的答案而不是壞掉的 body：不是 git repo、detached HEAD、
    // 還沒有第一次提交，三者都回 null（`handler.ts` 的 `currentBranch`）。
    (body.branch === null || typeof body.branch === 'string') &&
    typeof body.actor === 'string' &&
    Array.isArray(body.diagnostics)
  );
}

/**
 * 這塊 body 是不是一份 `IssueHistory` —— 只看頂層，同 `isBoardSnapshot`。
 *
 * **逐列驗型別是刻意不做的。** 那等於在 client 上放第二份 `WriteView` 的定義，
 * 而兩份定義遲早分岔：server 哪天多送一個欄位，畫面會說「那個 port 上跑的不是
 * nook studio」，而伺服器答得好好的。這裡要擋的只有「打錯 port，另一個 server
 * 在那裡回了 JSON」。
 */
export function isIssueHistory(value: unknown): value is IssueHistory {
  if (value === null || typeof value !== 'object') return false;
  return Array.isArray((value as { writes?: unknown }).writes);
}

/**
 * 這塊 body 是不是一份 `DecisionBoardSnapshot` —— 只看頂層，同 `isBoardSnapshot`。
 * 存在的理由一模一樣：擋的是「打錯 port，另一個 server 在那裡回了 JSON」。
 */
export function isDecisionBoardSnapshot(value: unknown): value is DecisionBoardSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const body = value as { decisions?: unknown; hash?: unknown };
  return Array.isArray(body.decisions) && typeof body.hash === 'string';
}

const BOARD_URL = '/api/board';
const BOARD_INFO_URL = '/api/board-info';
const HASH_URL = '/hash';
const ISSUE_PREFIX = '/i/';
const ISSUES_URL = '/api/issues';
const HISTORY_PREFIX = '/api/history/';
const DECISIONS_URL = '/api/decisions';
const DECISION_HASH_URL = '/decision-hash';

/**
 * `isShape` 是必填而不是選填：這個位置以前是 `as T`，而 `as T` 對編譯器來說
 * 就是「別問了」—— 解得開的任何東西都會被當成 T 交出去。寫成參數，之後多一個
 * 端點的人就得在這裡回答「怎樣算是答對了」，而不是預設不必答。
 */
async function getJson<T>(
  url: string,
  isShape: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, signal === undefined ? {} : { signal });
  if (!res.ok) throw new HttpError(url, res.status, `${url} returned ${res.status}`, await said(res));
  // `res.json()` 丟的是一個裸的 `SyntaxError`，而裸的例外在 `poll.ts` 那裡跟
  // 「連不上」長得一模一樣。自己解，才有辦法丟一個說得出「伺服器答了」的錯誤。
  const body = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MalformedResponseError(url);
  }
  // 解得開但形狀不對，丟的是**同一個** `MalformedResponseError`：對呼叫端來說
  // 兩者的正確反應一模一樣（去看那個 port 上跑的到底是不是 nook studio），
  // 第二種錯誤只會逼 `classifyFailure` 長出兩個分支去回答同一句話。
  if (!isShape(parsed)) throw new MalformedResponseError(url);
  return parsed;
}

/** 一次全量快照。ADR-0002：沒有快取也沒有增量 —— 全量掃描加摺疊就是實作。 */
export function fetchBoard(signal?: AbortSignal): Promise<BoardSnapshot> {
  return getJson(BOARD_URL, isBoardSnapshot, signal);
}

/**
 * Decisions 視圖的一次全量快照 —— `GET /api/decisions`，同 `fetchBoard` 的
 * 節奏。**沒有 `all` 概念**：Decision 不像 Issue 有需要預設過濾掉的可見性
 * 欄位，這條端點本來就不隱藏任何一筆（`handler.ts` 的 `decisionSnapshot`）。
 */
export function fetchDecisions(signal?: AbortSignal): Promise<DecisionBoardSnapshot> {
  return getJson(DECISIONS_URL, isDecisionBoardSnapshot, signal);
}

/**
 * 這塊 board 在磁碟上的位置、分支與 Actor —— header 那一行 mono 小字的來源。
 *
 * **開場抓一次，不進輪詢迴圈。** 這個端點會 spawn 一個 `git rev-parse`
 * （`health.ts`），掛進每 2 秒一次的迴圈等於每 2 秒多一個子行程，換來的是一個
 * 幾乎不會變的答案。它與快照分開的理由就是這個（`handler.ts` 的 `boardInfo`）。
 */
export function fetchBoardInfo(signal?: AbortSignal): Promise<BoardInfo> {
  return getJson(BOARD_INFO_URL, isBoardInfo, signal);
}

/**
 * 當前 board 的指紋。輪詢用它比對，值變了才去抓完整快照（票 05）——
 * 指紋是 64 字元，快照是整塊 board。
 *
 * **這裡刻意沒有形狀檢查 —— 這是想過的，不是漏掉的。**
 *
 * `fetchBoard` 那邊解得開但形狀不對會丟 `MalformedResponseError`；這裡不會，
 * 因為**任何一段文字都是合法的 `/hash` 回應**。錯的 server 在那個 port 上回一頁
 * 200 的 HTML，這個函式只會把整頁 HTML 當成一個指紋收下，然後因為它跟上一個值
 * 不同而去抓 board —— 於是延遲最多**一個輪詢間隔（2 秒）**，`/api/board` 就會
 * 說出「那個 port 上跑的不是 nook studio」。票 04 的頂層形狀檢查落地之後，
 * 那一邊抓到它更是確定的事，不再只是「body 剛好解不開」的運氣。
 *
 * 補一個「像不像 64 個十六進位字元」的檢查換不到那 2 秒，代價卻是把 `boardHash`
 * 的實作細節（sha256、十六進位、小寫）釘進 client：server 哪天換掉摘要演算法或
 * 改成別的編碼，畫面會說「連線中斷」，而伺服器其實答得好好的 —— 一個猜出來的
 * 形狀擋掉了一個正確的回應。ADR-0004 警告的正是這種東西：看起來像多了一層防護，
 * 實際上是掩體。**指紋對 client 的意義只有一個 ——「跟上次一樣嗎」**，
 * 而那件事不需要知道它長什麼樣。
 */
export async function fetchHash(signal?: AbortSignal): Promise<string> {
  const res = await fetch(HASH_URL, signal === undefined ? {} : { signal });
  if (!res.ok) {
    throw new HttpError(HASH_URL, res.status, `${HASH_URL} returned ${res.status}`, await said(res));
  }
  return await res.text();
}

/**
 * 當前 Decision Log 的指紋 —— `GET /decision-hash`，同 `fetchHash` 的形狀
 * （裸文字，不是 JSON）。同一個理由：這裡刻意沒有形狀檢查，任何一段文字都是
 * 合法的回應，錯的 server 會在下一次 `fetchDecisions` 被抓到。
 */
export async function fetchDecisionHash(signal?: AbortSignal): Promise<string> {
  const res = await fetch(DECISION_HASH_URL, signal === undefined ? {} : { signal });
  if (!res.ok) {
    throw new HttpError(
      DECISION_HASH_URL,
      res.status,
      `${DECISION_HASH_URL} returned ${res.status}`,
      await said(res),
    );
  }
  return await res.text();
}

/**
 * 一張 Issue 上每一次對 LWW 欄位的寫入 —— `GET /api/history/<ref>`。
 *
 * **只在有人展開歷史區塊時才叫**，不在開 drawer 時（票 B7）：多數人不會展開它，
 * 而每開一次 drawer 就多讀一次 op-log 是替不會發生的事付錢。
 *
 * **已刪的 Issue 照樣讀得到，而且是 200**（`handler.ts` 的 `issueHistory`）——
 * 那正是誤刪的救生索，drawer 的刪除確認框就是這樣答應使用者的。
 */
export function fetchHistory(ref: string, signal?: AbortSignal): Promise<IssueHistory> {
  // 同 `postChange`：ref 是 ULID，編碼對它是恆等變換；寫出來是為了讓
  // 「路徑片段就是路徑片段」不必靠 id 的字元集來成立。
  return getJson(`${HISTORY_PREFIX}${encodeURIComponent(ref)}`, isIssueHistory, signal);
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
  return await postJson(`${ISSUE_PREFIX}${encodeURIComponent(ref)}`, change);
}

/**
 * 一次新增 —— `POST /api/issues`。**新增是唯一不走 `POST /i/<ref>` 的寫入**，
 * 理由就寫在簽章裡：建立的那一刻還沒有 ref 可以放進 URL。
 *
 * **`status` 省略時就不送那個鍵**，而不是自己填一個 `'backlog'`。預設值是
 * `board.create()` 的決定（core 那一份），這裡填一個等於把它抄成第二份 ——
 * 兩份預設值哪天分岔了，畫面與 `nook new` 會把同一個「不指定」開到不同的欄裡。
 * 看板欄頂的 `+` 給的是那一欄的 Status，header 那顆什麼都不給。
 *
 * **只送 `title` 與 `status`。** 端點對不認得的欄位回 400 而不是忽略
 * （`handler.ts` 的 `CREATE_FIELDS`），同 `postChange` 的規則。
 */
export async function createIssue(title: string, status?: Status): Promise<IssueView> {
  return await postJson(ISSUES_URL, status === undefined ? { title } : { title, status });
}

/**
 * 一次新增 —— `POST /api/decisions`。同 `createIssue` 的理由：建立的那一刻
 * 還沒有 ref 可以放進 URL。
 *
 * **`body`／`disposition` 省略時就不送那個鍵**，不是自己填一個預設值 ——
 * 同 `createIssue` 對 `status` 的既有規則：預設值是 `decisionLog.create()`
 * 的決定（core 那一份），這裡填一個等於把它抄成第二份，兩份預設值哪天分岔了，
 * 畫面與 `nook decision new` 會把同一個「不指定」開到不同的 disposition。
 *
 * **只送 `title`／`body`／`disposition`。** 端點對不認得的欄位回 400 而不是
 * 忽略（`handler.ts` 的 `DECISION_CREATE_FIELDS`），同 `createIssue` 的規則。
 */
export async function createDecision(
  title: string,
  body?: string,
  disposition?: Disposition,
): Promise<DecisionView> {
  return await postJson(DECISIONS_URL, {
    title,
    ...(body === undefined ? {} : { body }),
    ...(disposition === undefined ? {} : { disposition }),
  });
}

/**
 * 一次 JSON 寫入。**兩個寫入端點共用這一份，這是刻意的。**
 *
 * 拆出來的理由與 `postChange` 當初被拖曳與 drawer 共用是同一個：兩處各寫一次
 * fetch 慣例（method、content-type、錯誤訊息的形狀、回應怎麼解）遲早會分歧，
 * 而分歧的那一半是靜默的 —— 少一個 content-type 只換來一個 400，看起來像是
 * 使用者的資料有問題。錯誤訊息尤其：`App.tsx` 的失敗橫幅直接顯示 `err.message`，
 * 新增與編輯失敗時那句話應該長得一樣。
 *
 * 回應**不做形狀檢查**，與 `getJson` 不同：`getJson` 擋的是「打錯 port，另一個
 * server 在那裡回了 JSON」，而那件事在開場第一次 `/api/board` 就會被抓到；
 * 走到這裡表示已經有一份合法的快照，寫入的對象是同一個 server。
 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // body 只讀得到一次，所以先取出來 —— 這句話同時進 `message`（寫入失敗的
    // 橫幅直接顯示它，一個字不變）與 `detail`。
    const text = await res.text();
    const detail = text.trim();
    throw new HttpError(
      url,
      res.status,
      `${url} returned ${res.status}: ${text}`,
      detail === '' ? null : detail,
    );
  }
  return (await res.json()) as T;
}
