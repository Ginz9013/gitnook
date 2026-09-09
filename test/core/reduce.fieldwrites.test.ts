import { describe, it, expect } from 'vitest';
import type { Op } from '../../src/core/ops.js';
import { fieldWrites } from '../../src/core/reduce.js';

/**
 * `fieldWrites` —— 一個 Issue 的 Op-log 裡，對 LWW 欄位的每一次寫入。
 *
 * `create` op 帶的 title 就是 title 的第一次寫入，所以它折成一筆 SetOp。不折的話
 * 「這個欄位從沒被寫過」會是一句假話，而問的人正在找一份被蓋掉的舊值（票 B9）。
 *
 * 這裡直接餵 op 陣列，不開 board：這個函式是純的，`orderOps` 與檔案在別處測。
 */

const create = (id: string, t: number, title: string): Op => ({
  id,
  t,
  a: 'k3f9',
  op: 'create',
  title,
});

const set = (id: string, t: number, k: 'title' | 'status', v: string): Op => ({
  id,
  t,
  a: 'k3f9',
  op: 'set',
  k,
  v,
});

describe('fieldWrites', () => {
  it('create + 兩筆 set 回三筆，順序與傳入相同', () => {
    const ops: Op[] = [
      create('01A', 1, 'Fix login redirect'),
      set('01B', 2, 'title', 'Fix the login redirect'),
      set('01C', 3, 'status', 'in_progress'),
    ];

    expect(fieldWrites(ops)).toEqual([
      { id: '01A', t: 1, a: 'k3f9', op: 'set', k: 'title', v: 'Fix login redirect' },
      { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'title', v: 'Fix the login redirect' },
      { id: '01C', t: 3, a: 'k3f9', op: 'set', k: 'status', v: 'in_progress' },
    ]);
  });
});

describe('fieldWrites 的欄位篩選', () => {
  it("fieldWrites(ops, 'status') 不含 create 那一筆 —— create 不寫 status", () => {
    const ops: Op[] = [
      create('01A', 1, 'Fix login redirect'),
      set('01B', 2, 'status', 'in_progress'),
      set('01C', 3, 'title', 'Fix the login redirect'),
    ];

    expect(fieldWrites(ops, 'status')).toEqual([
      { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'status', v: 'in_progress' },
    ]);
  });
});

/**
 * **`fieldWrites` 不排序。** 呼叫端傳進來的是 `board.opLog()`，那已經是
 * `orderOps` 的全序，而那個全序在整個 repo 只有一份（reduce.ts 開頭的註解）。
 * 在這裡再排一次就是第二份比較器 —— 兩份比較器分歧正是 commit 463343d 的成因。
 *
 * 這條測試因此刻意餵一份 t 亂序的陣列：回來的順序必須逐項等於傳進去的順序，
 * 而不是被「順手」照 t 排好。
 */
describe('fieldWrites 不排序', () => {
  it('傳進一份刻意亂序的陣列，回傳維持那個順序', () => {
    const ops: Op[] = [
      set('01C', 9, 'title', '第三個寫入，t 最大'),
      create('01A', 1, '第一個寫入，t 最小'),
      set('01B', 5, 'title', '第二個寫入，t 居中'),
    ];

    // 照傳入的順序，不是照 t —— 若這裡排了序，v 會變成「最小、居中、最大」。
    expect(fieldWrites(ops).map((w) => w.v)).toEqual([
      '第三個寫入，t 最大',
      '第一個寫入，t 最小',
      '第二個寫入，t 居中',
    ]);
    expect(fieldWrites(ops).map((w) => w.t)).toEqual([9, 1, 5]);
  });
});
