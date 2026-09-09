import { HttpError, MalformedResponseError, fetchBoard, fetchHash } from './api.js';
import type { IssueView } from './api.js';
import type { ClientAction } from './reconcile.js';

/**
 * 一次輪詢的結果：拿到答案（`'ok'`），或是一次失敗（`ConnectionFault`）。
 *
 * 為什麼失敗這一側是**值**而不是字面值：伺服器回 500 時，`handler.ts` 的
 * `serverError` 刻意在 body 裡送一則可行動的訊息（「不是一個 Nook board：
 * /path…」）。那句話是使用者手上唯一精確的證據，橫幅要引用它就得有地方帶它 ——
 * 字面值帶不動任何東西，橫幅於是只能改口說「最可能的原因」，也就是猜。
 *
 * 為什麼種類仍然走這條路進 `connectionReduce`，而不是在 `startPolling` 的
 * `catch` 裡分岔：`connectionReduce` 是這裡唯一有判斷的地方，也是唯一有測試的
 * 地方。「三次失敗才中斷」與「中斷的是哪一種」是同一個決定的兩半 —— 混著發生時
 * （連不上兩次、然後 500）該說哪一句，只有看得到整串結果的那個 reducer 答得出來。
 * 把種類留在接線裡等於讓它跟門檻各記一份「最近一次失敗」，那兩份遲早會分岔，
 * 而分岔的樣子是橫幅說錯話 —— 正是這張票要修的那個 bug 的第二版。訊息跟著種類
 * 一起走，理由相同：橫幅引用的那句話必須跟門檻算出來的那次失敗是同一次。
 */
export type PollOutcome = 'ok' | ConnectionFault;

/**
 * 中斷的種類 —— `'ok'` 以外的每一種結果：
 *
 * - `'failed'` —— 問了，什麼都沒回來（伺服器不在、網路斷了）。
 * - `'server-error'` —— 伺服器**答了**，答的是一個錯誤狀態碼。
 * - `'malformed'` —— 伺服器答了 200，但 body 不是承諾的形狀。
 *
 * 後兩種都是「它活著」，只是下一步不同：一個去看伺服器說了什麼，一個去看那個
 * port 上跑的到底是不是 nook studio。把 `'malformed'` 併進 `'failed'`（以前的
 * 行為）等於叫人去查一台正在回應的伺服器。
 *
 * `'failed'` 保留原名而不改叫 `'unreachable'`：它的意思從第一天起就是
 * 「問了，沒有得到答案」，一個字都沒有變。
 */
export type FaultKind = 'failed' | 'server-error' | 'malformed';

/**
 * 一次失敗：是哪一種，以及**伺服器就這件事說了什麼**。
 *
 * `detail` 是伺服器自己的話（`HttpError.detail`），不是這裡編出來的句子。
 * 沒有話可引用時是 `null` —— 連不上的時候本來就沒有人在說話，而橫幅在那個
 * 情況下要說的下一步（去看跑 `nook studio` 的終端機）並不需要引用誰。
 * 兩者分開，橫幅才不必從一句混合過的字串裡猜哪一半是伺服器講的。
 */
export interface ConnectionFault {
  readonly kind: FaultKind;
  readonly detail: string | null;
}

export interface ConnectionState {
  /** 連續失敗次數。成功一次就歸零。 */
  readonly failures: number;
  readonly disconnected: boolean;
  /**
   * **最近一次**失敗 —— 哪一種，以及伺服器就它說了什麼；成功一次就回到 null。
   *
   * 「最近一次說了算」是刻意的：連不上兩次之後收到一個 500，代表伺服器此刻
   * 是活的，橫幅就該說 500 那一句；反過來 500 兩次之後連不上，代表它剛剛死了。
   * 兩者都是「現在的狀況」，而最近的那一次結果就是關於現在最新的證據。
   *
   * 沒到門檻時它也記著，但沒人讀 —— 該不該說出口由 `connectionFault()` 決定。
   */
  readonly fault: ConnectionFault | null;
}

/** 開場假設連得上 —— 還沒問過就先說壞掉是錯的。 */
export const CONNECTED: ConnectionState = { failures: 0, disconnected: false, fault: null };

/**
 * 三次連續失敗才說「中斷」。輪詢間隔是 2000ms，因此門檻等於**伺服器沉默 6 秒**。
 *
 * 這個數字是兩邊都不能踩的折衷：唯讀時期的內嵌腳本可以靜默失敗，開放寫入之後
 * 伺服器不通代表使用者的變更正在掉，畫面必須說出來（ADR-0007）。但一次掉包、
 * 或使用者自己按了 ctrl-C 再重開 `nook studio`，都會製造一兩次失敗；為此閃一塊
 * 「連線中斷」再收回去，比不說還糟 —— 講狼來了的橫幅下次沒人看。
 * 6 秒足以吃掉單次重啟，又短到人還記得自己剛剛拖了哪張卡片。
 */
export function connectionReduce(state: ConnectionState, outcome: PollOutcome): ConnectionState {
  if (outcome !== 'ok') {
    // 兩種失敗共用同一個門檻。伺服器回 500 跟伺服器不回話，對使用者的意義
    // 是同一件事 —— 變更送不出去 —— 差別只在下一步該去查什麼，也就只在說法上。
    const failures = state.failures + 1;
    return { failures, disconnected: failures >= DISCONNECT_AFTER, fault: outcome };
  }
  // 一次成功就足以解除：伺服器答了，使用者的變更又送得出去了。進場要三次、
  // 離場只要一次是刻意的不對稱 —— 誤報中斷只是嚇人，漏報中斷會讓人繼續拖卡片。
  return CONNECTED;
}

const DISCONNECT_AFTER = 3;

/**
 * 這一刻橫幅該說哪一句：null = 什麼都不說。
 *
 * 門檻與種類在 `ConnectionState` 裡是兩格，但畫面只需要一個答案，而
 * 「還沒到門檻就不准說話」這條規則只能有一份 —— 放在這裡，接線就不必自己判斷，
 * `startPolling` 也就沒有第二個地方可以把它判錯。
 */
export function connectionFault(state: ConnectionState): ConnectionFault | null {
  return state.disconnected ? state.fault : null;
}

/**
 * 橫幅上掛著的那句話，還是現在這一句嗎 —— 兩次中斷相不相等。
 *
 * 純函式而不是接線裡的一個 `!==`：失敗這一側改成值之後，每一輪失敗都是一個
 * **新的物件**，身分比較於是永遠說「變了」，橫幅就會每 2 秒被重新設定一次
 * （React 的 `aria-live` 因此每 2 秒重播一次同一句話給讀螢幕的人聽）。相等的
 * 定義是「說的是不是同一件事」= 種類與那句話都一樣，而這件事有判斷、
 * 所以有測試 —— `startPolling` 不必自己比，也就沒有地方可以比錯。
 */
export function sameFault(a: ConnectionFault | null, b: ConnectionFault | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.detail === b.detail;
}

/**
 * 一個接到的例外是哪一種失敗，以及伺服器就它說了什麼。
 *
 * 純函式而不是 `catch` 裡的一行 `instanceof`：這是「伺服器到底有沒有回應」
 * 這個問題唯一的答題處，而答錯的代價就是橫幅說錯話。有狀態碼可讀（`HttpError`
 * 只在 `!res.ok` 時產生）= 伺服器答了，而且它在 body 裡說的那句話就掛在
 * `err.detail` 上，原封不動送出去給橫幅引用。其餘 —— 主要是 `fetch` 連不上時
 * 丟的 `TypeError` —— 一律當成沒有回應，那時沒有任何人說過話，`detail` 是 null。
 *
 * 「200 但 body 解不出 JSON」同樣是伺服器答了，而這裡**還是不從例外的型別去猜**
 * 那件事：一個裸的 `SyntaxError` 可能來自任何一層。認的是 `api.ts` 丟出來的
 * `MalformedResponseError` —— 那個名字只有解析回應失敗的那一行會用，所以認它
 * 不是猜。沒有具名錯誤可認的一切仍舊落在 `'failed'`：不知道就說不知道。
 */
export function classifyFailure(err: unknown): ConnectionFault {
  if (err instanceof HttpError) return { kind: 'server-error', detail: err.detail };
  if (err instanceof MalformedResponseError) return { kind: 'malformed', detail: null };
  return { kind: 'failed', detail: null };
}

/** 輪詢間隔。票 09 的契約，不變。 */
export const POLL_INTERVAL_MS = 2000;

export interface PollOptions {
  /** 開場那份快照的 hash —— 有它，第一次輪詢才不會白抓一次整塊 board。 */
  readonly hash: string;
  /**
   * 新快照交給調和 reducer。畫面該不該跟著動由它決定，不由這裡決定（票 02）。
   *
   * 型別參數釘的是 `IssueView` 而不是 reducer 預設的 `ReconcileIssue`：這裡
   * 派出去的快照就是 `fetchBoard()` 的產物，兩者是同一個形狀。寫成較寬的那個
   * 會讓呼叫端（它的 state 帶著 `descriptionHtml`）在逆變位置上接不住。
   */
  readonly dispatch: (action: ClientAction<IssueView>) => void;
  /**
   * 中斷狀態變了才呼叫一次，不是每次輪詢都叫。null = 連得上。
   *
   * 送的是**那次失敗本身**而不是一個 boolean：橫幅要說的話差在種類與伺服器
   * 講的那句上，而「中斷了嗎」是 `fault !== null`，兩者不可能對不上。中斷期間
   * 內容改變（連不上之後開始收到 500，或伺服器換了一句話說）同樣是一次變化 ——
   * 那時橫幅上掛著的正是該換掉的那句。
   */
  readonly onConnectionChange: (fault: ConnectionFault | null) => void;
}

/**
 * 輪詢迴圈。回傳的函式停掉它（給 `useEffect` 的 cleanup 用）。
 *
 * 這一段沒有自動化測試 —— 有判斷的部分都在上面的 `connectionReduce`、
 * `classifyFailure` 與 `connectionFault` 裡（三個都是純函式，都有測試），這裡剩下
 * 的是接線：問 hash、變了才抓 board、把快照丟給 reducer。整頁重載不在這裡，也不該
 * 在任何地方（ADR-0007：它與拖曳、開著的 drawer、捲動位置全都不相容）。
 */
export function startPolling(options: PollOptions): () => void {
  const abort = new AbortController();
  let hash = options.hash;
  let connection = CONNECTED;
  let busy = false;

  const record = (outcome: PollOutcome): void => {
    const before = connectionFault(connection);
    connection = connectionReduce(connection, outcome);
    const now = connectionFault(connection);
    // 相等與否由 `sameFault` 說了算 —— 每一輪失敗都是一個新的物件，身分比較
    // 會把「同一句話再說一次」當成一次變化。
    if (!sameFault(now, before)) options.onConnectionChange(now);
  };

  const tick = async (): Promise<void> => {
    // 上一輪還沒回來就跳過：不堆積請求，也不讓同一段沉默被數成好幾次失敗。
    // 代價是「連線吊著不回」不會累積失敗次數；loopback 上伺服器不在就是立刻
    // ECONNREFUSED，吊住的情況不存在。
    if (busy) return;
    busy = true;
    try {
      const latest = await fetchHash(abort.signal);
      if (latest !== hash) {
        // 指紋是 64 字元，快照是整塊 board —— 值沒變就不抓（ADR-0002：沒有增量，
        // 要嘛全量要嘛不要）。`/hash` 涵蓋 all: true，archived 與 done 的變動同樣算數。
        const snapshot = await fetchBoard(abort.signal);
        hash = latest;
        options.dispatch({ type: 'POLL', issues: snapshot.issues });
      }
      record('ok');
    } catch (err) {
      // 停掉輪詢時的 abort 不是伺服器的錯，不算一次失敗。
      // 其餘的交給 `classifyFailure` 分：伺服器答了錯誤狀態碼，跟伺服器根本
      // 沒答，在這裡是兩件事 —— 說成同一件會讓橫幅把人送去查網路而不是查 board。
      if (!abort.signal.aborted) record(classifyFailure(err));
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    abort.abort();
  };
}
