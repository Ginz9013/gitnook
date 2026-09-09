import { describe, it, expect } from 'vitest';

import type { Status } from '../../src/studio/api.js';
import { collapsedNow, revealOver, toggleCollapsed } from '../../src/studio/board/collapse.js';

// 純函式，environment: 'node'。不 import React、不碰 DOM
// （spec.md 的測試策略：React 組件不寫測試，不得新增 jsdom／@testing-library／playwright）。
//
// 票 B3 的版面與拖曳互動**沒有自動化測試**，票面明說。這個檔案裝的是那張票裡
// 可判定的那幾條規則：折疊集合怎麼變。它們住在 `board/collapse.ts` 正是為了
// 測得到，同 `board/path.ts` 與 `board/announce.ts`。

const set = (...s: Status[]): ReadonlySet<Status> => new Set(s);

describe('toggleCollapsed —— 一欄的折疊開關', () => {
  it('沒折起來的欄位切換之後折起來', () => {
    expect([...toggleCollapsed(set('todo'), 'done')]).toEqual(['todo', 'done']);
  });
});

describe('toggleCollapsed —— 折疊是往返的，不是單程票', () => {
  it('折起來的欄位再切一次就展開', () => {
    expect([...toggleCollapsed(set('todo', 'done'), 'done')]).toEqual(['todo']);
  });

  /**
   * 就地改再把同一個 Set 交回 `useState`，React 看到的是同一個參照 ——
   * 於是不重繪：按鈕按下去畫面什麼都不會發生，而程式沒有任何錯誤。
   */
  it('原本那個集合一格都沒動', () => {
    const before = set('todo');
    toggleCollapsed(before, 'done');

    expect([...before]).toEqual(['todo']);
  });
});

/**
 * 折起來的欄位仍然是合法的 drop target，所以拖曳指到它時要暫時掀開 —— 否則
 * 使用者看不到自己放進去的東西掉在哪。**掀開之後在這次拖曳結束之前不再收回**，
 * 而不是指標一離開就收：收回去會讓右邊每一欄同時往左跳約 216px，而
 * `dnd.ts` 的 `columnKeyboardCoordinates` 這時已經照著掀開時的版面把卡片放到
 * 某一欄的中心了。欄距 268px、跳動 216px，於是「最近的中心」變成隔壁那一欄 ——
 * 鍵盤使用者按一次右鍵走兩欄，畫面上看不出任何異狀。
 */
describe('revealOver —— 拖曳掀開的欄位', () => {
  it('指到哪一欄就掀開哪一欄', () => {
    expect([...revealOver(set(), 'done')]).toEqual(['done']);
  });

  it('拖曳離開之後仍然掀著 —— 收回是放開之後的事', () => {
    expect([...revealOver(set('done'), 'review')]).toEqual(['done', 'review']);
  });
});

/**
 * `Board.tsx` 在 `onDragOver` 裡呼叫它，而拖曳中 `over` 反覆落在同一欄。
 * 每次都交出一個新的 Set，React 就每次都重繪八欄（`useState` 的 updater 回
 * 同一個參照時它會跳過）—— 拖著卡片走一趟等於幾十次整塊看板重繪。
 */
describe('revealOver —— 沒有新東西就是同一個集合', () => {
  it('已經掀開的欄位回原本那個參照', () => {
    const revealed = set('done');

    expect(revealOver(revealed, 'done')).toBe(revealed);
  });

  it('沒指到任何一欄時回原本那個參照', () => {
    const revealed = set('done');

    expect(revealOver(revealed, null)).toBe(revealed);
  });
});

/**
 * 畫面上「這一欄現在折著嗎」是兩個來源的差集：使用者記在 `localStorage` 的
 * 偏好（`@/prefs`），扣掉這次拖曳掀開的。偏好本身不因為一次拖曳而改變 ——
 * 放開之後那一欄要照樣折回去。
 */
describe('collapsedNow —— 現在實際折著的欄位', () => {
  it('偏好折起來、又被拖曳掀開的那一欄，現在不算折著', () => {
    expect([...collapsedNow(set('todo', 'done'), set('done'))]).toEqual(['todo']);
  });

  it('掀開一個本來就沒折的欄位不會多出任何東西', () => {
    expect([...collapsedNow(set('todo'), set('done'))]).toEqual(['todo']);
  });
});
