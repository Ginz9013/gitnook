import { describe, it, expect } from 'vitest';
import type { Board, DecisionLog, DecisionOp, Op } from '../src/index.js';

describe('src/index.ts 的公開匯出', () => {
  it('只有 Board 的入口、初始化／診斷／服務、以及使用者接得到的錯誤型別', async () => {
    const api: Record<string, unknown> = await import('../src/index.js');

    expect(Object.keys(api).sort()).toEqual(
      [
        // 深模組本體的入口 —— spec.md 說的那個接縫。
        'openBoard',
        // Decision 版的入口 —— 一上公開面就是相容承諾，同 openBoard
        // （decision-module 票 01）。
        'openDecisionLog',
        // 跨 Board 的唯讀彙整入口 —— 一上公開面就是相容承諾，同 openBoard。
        'openWorkspace',
        // 沒有它就沒有 board 可以開。
        'initBoard',
        // doctor 的兩半：README 承諾 board.health() 就是 nook doctor 報的東西，
        // 而 repair 是「可修復」這個診斷唯一的兌現途徑。
        'diagnose',
        'repair',
        // 唯讀檢視器。handleRequest 是它的內部零件，不是公開面。
        'serve',
        // workspace 版的唯讀檢視器 —— landing page，點了才啟動子 serve()，
        // 一上公開面就是相容承諾，同 serve。
        'serveWorkspace',
        // 八個固定 Status 是領域模型的一部分，呼叫端要據以分欄或驗證輸入。
        'STATUSES',
        // 錯誤型別：呼叫端要 instanceof 才能分辨「使用者修得好」與「回報 bug」。
        'BoardNotInitialized',
        'RefNotFound',
        'AmbiguousRef',
        'InvalidStatus',
        // board.apply() 對一張已刪的 Issue 丟的就是它 —— 同一家族的其餘四個都在
        // 這裡，少它一個，呼叫端就只能去比對 err.name 或訊息字串。
        'IssueDeleted',
        'ConflictingGitAttributes',
        'NestedBoard',
        // initBoard 的另外兩個出口。init --private 撞到一塊已共享的 board、或
        // 撞到「這裡沒有 git」時丟的就是它們 —— 同上，呼叫端要 instanceof 得到
        // 才分得出「使用者改個指令就好」與「回報一個 bug」。
        'AlreadySharedBoard',
        'NoGitDir',
        'PortInUse',
        // Decision 的固定值域，同 STATUSES 的理由（decision-module 票 01）。
        'DISPOSITIONS',
        // Decision 側的錯誤型別 —— 同上面 Issue 那一組，openDecisionLog 是
        // 公開的，它會丟的東西呼叫端必須 instanceof 得到。
        'DecisionLogNotInitialized',
        'DecisionNotFound',
        'AmbiguousDecisionRef',
        'InvalidDisposition',
      ].sort(),
    );
  });
});

/**
 * 型別匯出在執行期看不見，因此這一條由 `npx tsc --noEmit` 守住。
 *
 * `Board.opLog()` 一旦上了公開面，Op 的形狀就已經是相容承諾了 —— 不匯出
 * 名字並不會少欠一分，只會讓呼叫端包不住它（同 ServeOptions 的理由：
 * 簽章要能被呼叫端命名，否則它等於只能被呼叫、不能被包裝）。
 */
describe('Op-log 的回傳型別', () => {
  it('opLog 的回傳值命名得出來', () => {
    const nameable: (board: Board) => readonly Op[] = (board) => board.opLog('01JBX7A9Q3');

    expect(typeof nameable).toBe('function');
  });

  /** Decision 版同上，理由相同（decision-module 票 01）。 */
  it('DecisionLog.opLog 的回傳值也命名得出來', () => {
    const nameable: (log: DecisionLog) => readonly DecisionOp[] = (log) => log.opLog('01JBX7A9Q3');

    expect(typeof nameable).toBe('function');
  });
});
