import { describe, it, expect } from 'vitest';

import { panStarted, panTo } from '../../src/studio/board/pan.js';

// 純函式，environment: 'node'。不 import React、不碰 DOM
// （spec.md 的測試策略：React 組件不寫測試，不得新增 jsdom／@testing-library／playwright）。
//
// 票 B4 的指標互動**沒有自動化測試**，票面明說。這個檔案裝的是那張票裡可判定的
// 那兩條規則：抓著空白處往旁邊拉時捲動容器該停在哪。它們住在 `board/pan.ts`
// 正是為了測得到，同 `board/collapse.ts`。

describe('panTo —— 內容跟著手走', () => {
  it('手往右拉，看板跟著往右滑，於是 scrollLeft 變小', () => {
    expect(panTo({ x: 300, scrollLeft: 500 }, 380)).toBe(420);
  });
});

/**
 * 平移與「按一下容器裡的某顆按鈕」共用同一個 pointerdown —— 欄頂的 `+`、
 * 折疊鈕都在捲動容器裡面。分不開的話按下去的那一下會被平移吃掉。
 */
describe('panStarted —— 這一下是平移，還是一次點擊', () => {
  it('手抖的那幾 px 還是一次點擊', () => {
    expect(panStarted({ x: 300, scrollLeft: 0 }, 304)).toBe(false);
  });

  it('過了門檻就是平移', () => {
    expect(panStarted({ x: 300, scrollLeft: 0 }, 305)).toBe(true);
  });

  it('往左拉一樣算 —— 門檻問的是距離，不是方向', () => {
    expect(panStarted({ x: 300, scrollLeft: 0 }, 295)).toBe(true);
  });
});
