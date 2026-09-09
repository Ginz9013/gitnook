import { fetchBoard, fetchHash } from './api.js';
import type { ClientAction } from './reconcile.js';

/** 一次輪詢的結果：拿到答案，或伺服器沒回應。 */
export type PollOutcome = 'ok' | 'failed';

export interface ConnectionState {
  /** 連續失敗次數。成功一次就歸零。 */
  readonly failures: number;
  readonly disconnected: boolean;
}

/** 開場假設連得上 —— 還沒問過就先說壞掉是錯的。 */
export const CONNECTED: ConnectionState = { failures: 0, disconnected: false };

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
  if (outcome === 'failed') {
    const failures = state.failures + 1;
    return { failures, disconnected: failures >= DISCONNECT_AFTER };
  }
  // 一次成功就足以解除：伺服器答了，使用者的變更又送得出去了。進場要三次、
  // 離場只要一次是刻意的不對稱 —— 誤報中斷只是嚇人，漏報中斷會讓人繼續拖卡片。
  return CONNECTED;
}

const DISCONNECT_AFTER = 3;

/** 輪詢間隔。票 09 的契約，不變。 */
export const POLL_INTERVAL_MS = 2000;

export interface PollOptions {
  /** 開場那份快照的 hash —— 有它，第一次輪詢才不會白抓一次整塊 board。 */
  readonly hash: string;
  /** 新快照交給調和 reducer。畫面該不該跟著動由它決定，不由這裡決定（票 02）。 */
  readonly dispatch: (action: ClientAction) => void;
  /** 只在「中斷」與否翻面時呼叫一次，不是每次輪詢都叫。 */
  readonly onConnectionChange: (disconnected: boolean) => void;
}

/**
 * 輪詢迴圈。回傳的函式停掉它（給 `useEffect` 的 cleanup 用）。
 *
 * 這一段沒有自動化測試 —— 有判斷的部分都在上面的 `connectionReduce` 裡，這裡剩下
 * 的是接線：問 hash、變了才抓 board、把快照丟給 reducer。整頁重載不在這裡，也不該
 * 在任何地方（ADR-0007：它與拖曳、開著的 drawer、捲動位置全都不相容）。
 */
export function startPolling(options: PollOptions): () => void {
  const abort = new AbortController();
  let hash = options.hash;
  let connection = CONNECTED;
  let busy = false;

  const record = (outcome: PollOutcome): void => {
    const before = connection.disconnected;
    connection = connectionReduce(connection, outcome);
    if (connection.disconnected !== before) options.onConnectionChange(connection.disconnected);
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
    } catch {
      // 停掉輪詢時的 abort 不是伺服器的錯，不算一次失敗。
      if (!abort.signal.aborted) record('failed');
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
