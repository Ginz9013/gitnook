import { describe, it, expect } from 'vitest';

describe('src/index.ts 的公開匯出', () => {
  it('只有 Board 的入口、初始化／診斷／服務、以及使用者接得到的錯誤型別', async () => {
    const api: Record<string, unknown> = await import('../src/index.js');

    expect(Object.keys(api).sort()).toEqual(
      [
        // 深模組本體的入口 —— spec.md 說的那個接縫。
        'openBoard',
        // 沒有它就沒有 board 可以開。
        'initBoard',
        // doctor 的兩半：README 承諾 board.health() 就是 nook doctor 報的東西，
        // 而 repair 是「可修復」這個診斷唯一的兌現途徑。
        'diagnose',
        'repair',
        // 唯讀檢視器。handleRequest 是它的內部零件，不是公開面。
        'serve',
        // 八個固定 Status 是領域模型的一部分，呼叫端要據以分欄或驗證輸入。
        'STATUSES',
        // 錯誤型別：呼叫端要 instanceof 才能分辨「使用者修得好」與「回報 bug」。
        'BoardNotInitialized',
        'RefNotFound',
        'AmbiguousRef',
        'InvalidStatus',
        'ConflictingGitAttributes',
        'NestedBoard',
        'PortInUse',
      ].sort(),
    );
  });
});
