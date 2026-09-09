import { describe, it, expect } from 'vitest';
import { archiveChange, deleteChange } from '../../src/studio/drawer/changes.js';
import type { Change } from '../../src/studio/api.js';

// 純函式，environment: 'node'。不碰 DOM、不 import React。
// spec.md 的測試策略：只測純邏輯，React 組件不寫測試 —— A9 除了這兩個
// 函式之外的部分（drawer 的兩顆按鈕、AlertDialog、App 的接線）沒有自動化測試。

describe('archiveChange', () => {
  it('切成封存時送出 { archived: true }', () => {
    expect(archiveChange(true, false)).toEqual({ archived: true });
  });

  // op-log 是 append-only：一個什麼都沒改的點擊不該在歷史上留下痕跡。
  it('已經是那個值時什麼都不送', () => {
    expect(archiveChange(false, false)).toBeUndefined();
    expect(archiveChange(true, true)).toBeUndefined();
  });
});

describe('deleteChange', () => {
  // 刪除沒有「沒有變化」這一半：已刪的那張根本不在看板上，按不到那顆按鈕。
  it('永遠送出 { deleted: true }', () => {
    expect(deleteChange()).toEqual({ deleted: true });
  });
});

/**
 * 型別層。`POST /i/<ref>` 對不認得的欄位回 400 而不是忽略（票 03），所以
 * 「多送一個鍵」不是一個無害的多餘欄位，是一次失敗的寫入。這一條由 `tsc`
 * 判定 —— 執行期的 `expect` 只是讓它待在測試檔裡有個歸屬。
 */
describe('送得出去的形狀', () => {
  it('兩個函式的回傳值都指派得給 Change', () => {
    const archived: Change | undefined = archiveChange(true, false);
    const deleted: Change = deleteChange();
    expect({ ...archived, ...deleted }).toEqual({ archived: true, deleted: true });
  });
});
