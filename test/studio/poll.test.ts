import { describe, it, expect } from 'vitest';
import {
  CONNECTED,
  classifyFailure,
  connectionFault,
  connectionReduce,
} from '../../src/studio/poll.js';
import type { PollOutcome } from '../../src/studio/poll.js';
import { HttpError } from '../../src/studio/api.js';

// 純函式，environment: 'node'。輪詢迴圈本身（fetch / setInterval / AbortController）
// 沒有自動化測試 —— 依 spec.md 的測試策略，不為了測它引入 jsdom 或假 Fetcher。
// 這裡測的是唯一有判斷的那一段：一串輪詢結果何時讓畫面說「連線中斷」。

const after = (...outcomes: PollOutcome[]) => outcomes.reduce(connectionReduce, CONNECTED);

describe('connectionReduce — 連線中斷的判定', () => {
  it('單次失敗不算中斷 —— 一次掉包不該閃一塊嚇人的橫幅', () => {
    expect(after('failed').disconnected).toBe(false);
  });

  it('連續失敗到門檻（3 次 = 6 秒沒有回應）才進入中斷', () => {
    expect(after('failed', 'failed').disconnected).toBe(false);
    expect(after('failed', 'failed', 'failed').disconnected).toBe(true);
  });

  it('恢復後清除中斷，而且失敗次數重新從零算起', () => {
    expect(after('failed', 'failed', 'failed', 'ok').disconnected).toBe(false);
    // 中斷解除之後又壞兩次，離門檻還差一次 —— 舊的計數不得留下來累加。
    expect(after('failed', 'failed', 'failed', 'ok', 'failed', 'failed').disconnected).toBe(false);
  });
});

describe('classifyFailure — 一次失敗是哪一種', () => {
  it('伺服器回了錯誤狀態碼 —— 它答了，所以不是連不上', () => {
    expect(classifyFailure(new HttpError('/hash', 500, '/hash 回了 500'))).toBe('server-error');
  });

  it('fetch 自己丟的錯沒有狀態碼可讀 —— 那才是沒有回應', () => {
    // 瀏覽器連不上時丟的是 TypeError('Failed to fetch')。
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('failed');
  });
});

describe('connectionReduce — 中斷的是哪一種', () => {
  it('伺服器回錯誤同樣算失敗，門檻仍然是三次', () => {
    expect(after('server-error', 'server-error').disconnected).toBe(false);
    expect(after('server-error', 'server-error', 'server-error').disconnected).toBe(true);
  });

  it('記下最近一次失敗是哪一種 —— 橫幅要說的就是這個', () => {
    expect(after('server-error', 'server-error', 'server-error').fault).toBe('server-error');
    expect(after('failed', 'failed', 'failed').fault).toBe('failed');
  });
});

describe('connectionFault — 橫幅該說哪一句', () => {
  it('沒到門檻就什麼都不說，即使剛剛失敗過', () => {
    expect(connectionFault(after('server-error', 'server-error'))).toBe(null);
  });

  it('到了門檻，說出的是哪一種中斷', () => {
    expect(connectionFault(after('failed', 'failed', 'failed'))).toBe('failed');
    expect(connectionFault(after('server-error', 'server-error', 'server-error'))).toBe(
      'server-error',
    );
  });

  it('混著發生時由最近一次失敗決定 —— 它是關於「現在」最新的證據', () => {
    // 連不上兩次之後收到 500：伺服器此刻活著，說「沒有回應」會把人送去查網路。
    expect(connectionFault(after('failed', 'failed', 'server-error'))).toBe('server-error');
    // 反過來：500 兩次之後連不上，代表它剛剛死了。
    expect(connectionFault(after('server-error', 'server-error', 'failed'))).toBe('failed');
  });

  it('恢復之後不再說話，種類也跟著清掉', () => {
    expect(connectionFault(after('server-error', 'server-error', 'server-error', 'ok'))).toBe(null);
  });
});
