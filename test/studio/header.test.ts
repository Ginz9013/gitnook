import { describe, it, expect } from 'vitest';

import { isBoardInfo } from '../../src/studio/api.js';
import { shortenPath } from '../../src/studio/board/path.js';

// 純函式，environment: 'node'。不 import React、不碰 DOM。
//
// 票 B2 本身**沒有自動化測試** —— header 是版面，而 spec.md 的測試策略是
// 「React 組件不寫測試」。這個檔案裝的是那張票裡唯一可判定的規則：路徑太長時
// 要怎麼縮。它被推進 `board/path.ts` 正是為了測得到，同 `board/announce.ts`。

describe('shortenPath —— 太長時從中間截，不從尾端', () => {
  // 票面上的實例：`/Users/…/issue-tracker/.issues`。尾端那兩段是「這是哪個
  // repo」的唯一來源，砍掉它等於砍掉路徑出現在畫面上的理由。
  it('留下開頭與結尾，中間換成刪節號', () => {
    expect(shortenPath('/Users/kouhei/Documents/repos/issue-tracker/.issues', 30)).toBe(
      '/Users/…/issue-tracker/.issues',
    );
  });
});

describe('shortenPath —— 放得下就一個字都不動', () => {
  // 放得下卻仍然縮，是「畫面上寫的不是真的路徑」這種最難察覺的錯：
  // 使用者拿去 `cd` 的時候才會發現。
  it('比上限短的路徑原樣回傳', () => {
    expect(shortenPath('/tmp/nook/.issues', 30)).toBe('/tmp/nook/.issues');
  });

  it('剛好等於上限的路徑也原樣回傳', () => {
    const path = '/Users/kouhei/repos/nook/.issues';
    expect(path).toHaveLength(32);
    expect(shortenPath(path, 32)).toBe(path);
  });
});

describe('shortenPath —— 尾端不可犧牲', () => {
  // 上限是目標而不是保證。縮到只剩頭尾兩段還是太長時，正確的做法是交出那兩段
  // ——「這是哪個 repo」比「一定不超過 N 個字」重要，而版面自己會處理溢出。
  it('縮到剩頭尾兩段仍然超過上限時，交出的是那兩段而不是整條路徑', () => {
    expect(shortenPath('/Users/kouhei/repos/nook/.issues', 10)).toBe('/Users/…/.issues');
  });

  // 中間沒有東西可以拿掉的路徑，唯一能縮的辦法就是砍尾端 —— 所以不縮。
  it('沒有中間可拿的路徑原樣回傳', () => {
    expect(shortenPath('/one-extremely-long-single-directory-name', 10)).toBe(
      '/one-extremely-long-single-directory-name',
    );
  });
});

describe('isBoardInfo —— 合法的 JSON 不等於承諾的形狀', () => {
  const info = { root: '/tmp/nook', branch: 'main', actor: 'kouhei', diagnostics: [] };

  // 同 `isBoardSnapshot`（poll.test.ts）：擋的是「打錯 port，另一個 server
  // 在那裡回了 JSON」。
  it('別的 server 回的 JSON 不是 BoardInfo', () => {
    expect(isBoardInfo({ nope: 1 })).toBe(false);
  });

  it('四格都對就是 BoardInfo', () => {
    expect(isBoardInfo(info)).toBe(true);
  });

  it('不是物件的 body 同樣解得開，一樣要擋', () => {
    expect(isBoardInfo(null)).toBe(false);
    expect(isBoardInfo('/tmp/nook')).toBe(false);
  });
});

describe('isBoardInfo —— branch 是 string 或 null，沒有第三種', () => {
  const info = { root: '/tmp/nook', branch: 'main', actor: 'kouhei', diagnostics: [] };

  // 不是 git repo、detached HEAD、還沒有第一次提交 —— 三者都回 null
  // （`handler.ts` 的 `currentBranch`）。**null 是正常的答案，不是壞掉的 body。**
  it('branch 是 null 照樣是一份合法的 BoardInfo', () => {
    expect(isBoardInfo({ ...info, branch: null })).toBe(true);
  });

  it('branch 是別的東西就不是 BoardInfo', () => {
    expect(isBoardInfo({ ...info, branch: 42 })).toBe(false);
  });

  it('少了 branch 這一格也不是 BoardInfo', () => {
    expect(isBoardInfo({ root: '/tmp/nook', actor: 'kouhei', diagnostics: [] })).toBe(false);
  });
});
