import { describe, it, expect } from 'vitest';
import { CONNECTED, connectionReduce } from '../../src/studio/poll.js';
import type { PollOutcome } from '../../src/studio/poll.js';

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
