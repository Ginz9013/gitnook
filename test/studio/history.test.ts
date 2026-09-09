import { describe, it, expect } from 'vitest';

import { historyRows } from '../../src/studio/drawer/history.js';
import { isIssueHistory } from '../../src/studio/api.js';
import type { WriteView } from '../../src/studio/api.js';

// 純函式，environment: 'node'。不 import React、不碰 DOM。
//
// 票 B7 本身**沒有自動化測試** —— 變更歷史面板是版面，而 spec.md 的測試策略是
// 「React 組件不寫測試」。這個檔案裝的是那張票裡可判定的規則：一列要顯示什麼、
// 以及由新到舊的那個方向。同 B2 把 `shortenPath` 推進 `board/path.ts`。

const write = (over: Partial<WriteView>): WriteView => ({
  field: 'title',
  value: 'x',
  actor: 'kouhei',
  t: 1,
  ...over,
});

describe('historyRows —— 由新到舊，反轉而不重排', () => {
  // `board.opLog()` 交出來的是 `orderOps` 的全序（由舊到新），而全序只有一份
  // （reduce.ts）。畫面要的是最近一次寫入在最上面，所以這裡只反轉方向 ——
  // 在這裡放第二個比較器就是第二個真相，那正是 commit 463343d 那個 bug。
  it('把 server 給的順序整條反過來', () => {
    const rows = historyRows([
      write({ field: 'title', value: '第一版標題', t: 1 }),
      write({ field: 'status', value: 'doing', t: 2 }),
      write({ field: 'title', value: '改過的標題', t: 3 }),
    ]);

    expect(rows.map((r) => r.t)).toEqual([3, 2, 1]);
    expect(rows.map((r) => r.text)).toEqual(['改過的標題', 'doing', '第一版標題']);
  });

  it('欄位、actor 與 t 原樣帶過來', () => {
    const rows = historyRows([write({ field: 'status', value: 'blocked', actor: 'agent', t: 7 })]);

    expect(rows[0]).toMatchObject({ field: 'status', actor: 'agent', t: 7 });
  });
});

describe('historyRows —— boolean 的值也要寫成看得見的字', () => {
  // `archived` 與 `deleted` 的值是 boolean，而 React 把 `false` 渲染成
  // **什麼都沒有**。誤刪的救生索上最重要的那一列（`deleted true`）與復原的那一列
  // （`deleted false`）因此會變成一列空白 —— 看起來像那次寫入沒有值。
  it('true 與 false 都變成字串', () => {
    const rows = historyRows([
      write({ field: 'deleted', value: true, t: 4 }),
      write({ field: 'deleted', value: false, t: 5 }),
    ]);

    expect(rows.map((r) => r.text)).toEqual(['false', 'true']);
  });
});

describe('historyRows —— 太長的值收起來，但收起來的那一份不是全部', () => {
  // description 的舊值可能是整篇 markdown。一列歷史攤開整篇會把「出事才來看」的
  // 面板變成主角，所以收起來的那一份要有上限，而 `preview !== text` 就是組件
  // 判斷「這一列要不要給展開鍵」的依據 —— 不必再數一次字。
  it('超過上限時截斷並補刪節號', () => {
    const long = 'a'.repeat(200);
    const rows = historyRows([write({ field: 'description', value: long })]);

    expect(rows[0]?.preview).toBe(`${'a'.repeat(160)}…`);
    // 原文一個字都不能少 —— 展開之後看到的必須是被 LWW 蓋掉的那一份完整舊值。
    expect(rows[0]?.text).toBe(long);
  });

  it('放得下的值原樣，沒有刪節號', () => {
    const rows = historyRows([write({ field: 'title', value: '改一個標題' })]);

    expect(rows[0]?.preview).toBe('改一個標題');
  });

  it('剛好等於上限的值也原樣', () => {
    const exact = 'b'.repeat(160);
    const rows = historyRows([write({ field: 'description', value: exact })]);

    expect(rows[0]?.preview).toBe(exact);
  });
});

describe('historyRows —— 多行的值收起來只看得到第一行', () => {
  // 字數上限擋不住這一種：五行、每行十個字的 description 遠低於上限，攤開卻是
  // 五列高。一列歷史在收起來的時候必須是一列，否則「一列一次寫入」這個形狀
  // 會被最常見的那種值（多行 markdown）破壞掉。
  it('第一行之後的內容收進展開鍵裡', () => {
    const rows = historyRows([write({ field: 'description', value: '第一行\n第二行\n第三行' })]);

    expect(rows[0]?.preview).toBe('第一行…');
    expect(rows[0]?.text).toBe('第一行\n第二行\n第三行');
  });

  it('本來就只有一行的值不受影響', () => {
    const rows = historyRows([write({ field: 'description', value: '只有一行' })]);

    expect(rows[0]?.preview).toBe('只有一行');
  });
});

describe('isIssueHistory —— 合法的 JSON 不等於承諾的形狀', () => {
  // `getJson` 的 `isShape` 是必填（api.ts），而它必填正是為了讓多一個端點的人在
  // 這裡回答「怎樣算是答對了」。擋的是「打錯 port，另一個 server 在那裡回了
  // JSON」—— 同 `isBoardSnapshot` 與 `isBoardInfo`。
  it('沒有 writes 的物件不是一份歷史', () => {
    expect(isIssueHistory({ nope: 1 })).toBe(false);
  });

  it('writes 是陣列就算答對了', () => {
    expect(isIssueHistory({ writes: [] })).toBe(true);
  });

  it('writes 不是陣列不算', () => {
    expect(isIssueHistory({ writes: { 0: 'x' } })).toBe(false);
  });

  it('不是物件的 body 同樣解得開，同樣不算', () => {
    expect(isIssueHistory(null)).toBe(false);
    expect(isIssueHistory([])).toBe(false);
  });

  // 只檢頂層是刻意的，同 `isBoardSnapshot`：逐列驗型別等於在 client 上放第二份
  // `WriteView` 的定義，而它會與 server 那一份分岔。
  it('列裡面的東西不檢查', () => {
    expect(isIssueHistory({ writes: [{ nope: 1 }] })).toBe(true);
  });
});
