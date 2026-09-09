import { describe, it, expect } from 'vitest';
import {
  CONNECTED,
  classifyFailure,
  connectionFault,
  connectionReduce,
  sameFault,
} from '../../src/studio/poll.js';
import type { ConnectionFault, PollOutcome } from '../../src/studio/poll.js';
import { HttpError, MalformedResponseError } from '../../src/studio/api.js';

// 純函式，environment: 'node'。輪詢迴圈本身（fetch / setInterval / AbortController）
// 沒有自動化測試 —— 依 spec.md 的測試策略，不為了測它引入 jsdom 或假 Fetcher。
// 這裡測的是唯一有判斷的那一段：一串輪詢結果何時讓畫面說「連線中斷」。

const after = (...outcomes: PollOutcome[]) => outcomes.reduce(connectionReduce, CONNECTED);

// 失敗這一側是**值**而不是字面值 —— 它要帶著伺服器實際說的那句話。門檻與種類
// 釘的性質一個字都沒變，只是同一次失敗換了個寫法。
const unreachable = (): ConnectionFault => ({ kind: 'failed', detail: null });
const serverError = (detail: string | null = null): ConnectionFault => ({
  kind: 'server-error',
  detail,
});

describe('connectionReduce — 連線中斷的判定', () => {
  it('單次失敗不算中斷 —— 一次掉包不該閃一塊嚇人的橫幅', () => {
    expect(after(unreachable()).disconnected).toBe(false);
  });

  it('連續失敗到門檻（3 次 = 6 秒沒有回應）才進入中斷', () => {
    expect(after(unreachable(), unreachable()).disconnected).toBe(false);
    expect(after(unreachable(), unreachable(), unreachable()).disconnected).toBe(true);
  });

  it('恢復後清除中斷，而且失敗次數重新從零算起', () => {
    expect(after(unreachable(), unreachable(), unreachable(), 'ok').disconnected).toBe(false);
    // 中斷解除之後又壞兩次，離門檻還差一次 —— 舊的計數不得留下來累加。
    expect(
      after(unreachable(), unreachable(), unreachable(), 'ok', unreachable(), unreachable())
        .disconnected,
    ).toBe(false);
  });
});

describe('classifyFailure — 一次失敗是哪一種', () => {
  it('伺服器回了錯誤狀態碼 —— 它答了，所以不是連不上', () => {
    expect(classifyFailure(new HttpError('/hash', 500, '/hash 回了 500')).kind).toBe('server-error');
  });

  it('fetch 自己丟的錯沒有狀態碼可讀 —— 那才是沒有回應', () => {
    // 瀏覽器連不上時丟的是 TypeError('Failed to fetch')。
    expect(classifyFailure(new TypeError('Failed to fetch')).kind).toBe('failed');
  });
});

describe('connectionReduce — 中斷的是哪一種', () => {
  it('伺服器回錯誤同樣算失敗，門檻仍然是三次', () => {
    expect(after(serverError(), serverError()).disconnected).toBe(false);
    expect(after(serverError(), serverError(), serverError()).disconnected).toBe(true);
  });

  it('記下最近一次失敗是哪一種 —— 橫幅要說的就是這個', () => {
    expect(after(serverError(), serverError(), serverError()).fault?.kind).toBe('server-error');
    expect(after(unreachable(), unreachable(), unreachable()).fault?.kind).toBe('failed');
  });
});

describe('connectionFault — 橫幅該說哪一句', () => {
  it('沒到門檻就什麼都不說，即使剛剛失敗過', () => {
    expect(connectionFault(after(serverError(), serverError()))).toBe(null);
  });

  it('到了門檻，說出的是哪一種中斷', () => {
    expect(connectionFault(after(unreachable(), unreachable(), unreachable()))?.kind).toBe('failed');
    expect(connectionFault(after(serverError(), serverError(), serverError()))?.kind).toBe(
      'server-error',
    );
  });

  it('混著發生時由最近一次失敗決定 —— 它是關於「現在」最新的證據', () => {
    // 連不上兩次之後收到 500：伺服器此刻活著，說「沒有回應」會把人送去查網路。
    expect(connectionFault(after(unreachable(), unreachable(), serverError()))?.kind).toBe(
      'server-error',
    );
    // 反過來：500 兩次之後連不上，代表它剛剛死了。
    expect(connectionFault(after(serverError(), serverError(), unreachable()))?.kind).toBe('failed');
  });

  it('恢復之後不再說話，種類也跟著清掉', () => {
    expect(connectionFault(after(serverError(), serverError(), serverError(), 'ok'))).toBe(null);
  });
});

describe('一次失敗帶著伺服器實際說的那句話', () => {
  it('500 的 body 一路走到 connectionFault —— 橫幅要引用的就是它', () => {
    // handler.ts 的 serverError 刻意送一則可行動的訊息；它是使用者手上唯一
    // 精確的證據，橫幅猜「最可能的原因」等於把它丟掉。
    const said = '不是一個 Nook board：/tmp/gone';
    const outcome = classifyFailure(new HttpError('/hash', 500, '/hash 回了 500', said));
    expect(connectionFault(after(outcome, outcome, outcome))).toEqual({
      kind: 'server-error',
      detail: said,
    });
  });

  it('連不上時沒有話可引用 —— detail 是 null，不是一句編出來的話', () => {
    const outcome = classifyFailure(new TypeError('Failed to fetch'));
    expect(outcome).toEqual({ kind: 'failed', detail: null });
  });
});

describe('sameFault — 橫幅上掛著的那句話還是現在這一句嗎', () => {
  it('連得上就是連得上 —— 兩個 null 不是一次變化', () => {
    expect(sameFault(null, null)).toBe(true);
  });

  it('同一種失敗、同一句話 = 沒有變化，橫幅不必動', () => {
    // 中斷期間每 2 秒失敗一次，每一次都是一個新的物件。用 `!==` 比會讓橫幅
    // 每一輪都被重新設定一次，那是輪詢在對 React 說「有新東西」而其實沒有。
    const said = '不是一個 Nook board：/tmp/gone';
    expect(sameFault(serverError(said), serverError(said))).toBe(true);
  });

  it('種類變了就是變了 —— 連不上之後開始收到 500', () => {
    expect(sameFault(serverError(), unreachable())).toBe(false);
  });

  it('伺服器換了一句話說 —— 橫幅上掛著的那句已經過期', () => {
    expect(sameFault(serverError('board 目錄不見了'), serverError('磁碟滿了'))).toBe(false);
  });

  it('中斷與連得上永遠不是同一件事', () => {
    expect(sameFault(null, unreachable())).toBe(false);
    expect(sameFault(unreachable(), null)).toBe(false);
  });
});

describe('答了，但 body 不是承諾的形狀', () => {
  const malformed = (): ConnectionFault => ({ kind: 'malformed', detail: null });

  it('200 但 JSON 解不開 —— 伺服器答了，所以不算連不上', () => {
    // 把它算成「連不上」會把讀的人送去查一個活得好好的伺服器；真正的下一步是
    // 去看那個 port 上跑的到底是不是 nook studio。
    expect(classifyFailure(new MalformedResponseError('/api/board')).kind).toBe('malformed');
  });

  it('沒有話可引用 —— 那種 body 通常是別人的 HTML 錯誤頁，不是線索', () => {
    expect(classifyFailure(new MalformedResponseError('/api/board')).detail).toBe(null);
  });

  it('門檻對它一視同仁：連續三次才中斷，一次成功就解除', () => {
    expect(after(malformed(), malformed()).disconnected).toBe(false);
    expect(after(malformed(), malformed(), malformed()).disconnected).toBe(true);
    expect(after(malformed(), malformed(), malformed(), 'ok').disconnected).toBe(false);
  });

  it('最近一次說了算：解不開之後收到 500，該說的是 500 那一句', () => {
    expect(connectionFault(after(malformed(), malformed(), serverError('壞了')))).toEqual({
      kind: 'server-error',
      detail: '壞了',
    });
  });
});
