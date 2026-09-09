import { describe, it, expect } from 'vitest';
import { initialClient, clientReduce, project } from '../../src/studio/reconcile.js';
import type { ClientState, ReconcileIssue } from '../../src/studio/reconcile.js';

// 純 reducer，environment: 'node'。不碰 DOM、不 import React。
// 四條規則搬自 .scratch/studio-write/write-model.prototype.html 的「可移植模組 A」，
// 每一條都對應一個實際會壞的畫面。

const snap = (...pairs: [string, string][]): readonly ReconcileIssue[] =>
  pairs.map(([id, status]) => ({ id, status }));

const shown = (state: ClientState, id: string): string | undefined =>
  project(state).find((p) => p.id === id)?.shown;

const reduceAll = (state: ClientState, ...actions: Parameters<typeof clientReduce>[1][]): ClientState =>
  actions.reduce(clientReduce, state);

describe('project — 使用者看到的東西', () => {
  it('沒有飛行中的變更時，顯示伺服器快照的值', () => {
    const state = initialClient(snap(['a1', 'todo'], ['b2', 'review']));

    expect(project(state)).toEqual([
      { id: 'a1', shown: 'todo', serverKnown: 'todo', optimistic: false, held: false },
      { id: 'b2', shown: 'review', serverKnown: 'review', optimistic: false, held: false },
    ]);
  });
});

describe('DROP — 樂觀更新', () => {
  it('畫面立刻顯示拖到的欄位，不等伺服器', () => {
    const state = clientReduce(initialClient(snap(['a1', 'todo'])), {
      type: 'DROP',
      issueId: 'a1',
      to: 'queued',
    });

    expect(project(state)).toEqual([
      { id: 'a1', shown: 'queued', serverKnown: 'todo', optimistic: true, held: false },
    ]);
  });
});

// 規則 1：少了它，輪詢帶回「還沒看到你這筆」的舊快照時，卡片會彈回原位、
// 一秒後回應到了又彈過去。
describe('規則 1 —— 飛行中的變更蓋過快照', () => {
  it('套用新快照，但正在飛的那張卡片不彈回伺服器的舊值', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'DROP', issueId: 'a1', to: 'queued' },
      // 這份快照在 a1 的 op 寫進去之前就摺疊好了；同一輪裡 agent 把 b2 推進 todo。
      { type: 'POLL', issues: snap(['a1', 'todo'], ['b2', 'todo']) },
    );

    expect(project(state)).toEqual([
      { id: 'a1', shown: 'queued', serverKnown: 'todo', optimistic: true, held: false },
      { id: 'b2', shown: 'todo', serverKnown: 'todo', optimistic: false, held: false },
    ]);
  });
});

// 規則 4：append-only 之下沒有「被拒絕的寫入」（ADR-0007）。op 一定寫進去了，
// 只是摺疊時輸給了 agent 後來的那一筆 —— 畫面必須接受伺服器帶回來的值。
describe('規則 4 —— ACK 帶的是寫入當下的值，不是永恆真理', () => {
  it('伺服器回的值與你拖的不同時，畫面接受伺服器的值而不是回滾', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'])),
      { type: 'DROP', issueId: 'a1', to: 'blocked' },
      // op 有寫進 op-log，但摺疊出來是 review —— agent 那筆在 LWW 決勝時贏了。
      { type: 'ACK', seq: 1, status: 'review' },
    );

    expect(project(state)).toEqual([
      { id: 'a1', shown: 'review', serverKnown: 'review', optimistic: false, held: false },
    ]);
    expect(state.pending).toEqual([]);
  });
});

// 規則 2：少了它，第一筆的回應遲到時會把卡片拉回舊欄位 —— 你已經又拖過一次了。
describe('規則 2 —— 同一張 issue 只認最後一筆', () => {
  it('較晚的那筆蓋過較早的，被取代的那筆之後回來也不翻案', () => {
    const dropped = reduceAll(
      initialClient(snap(['a1', 'todo'])),
      { type: 'DROP', issueId: 'a1', to: 'queued' },
      { type: 'DROP', issueId: 'a1', to: 'review' },
    );

    expect(shown(dropped, 'a1')).toBe('review');

    // 第 1 筆的回應現在才回來，帶著它寫入當下的值 queued。它已經被第 2 筆取代了。
    const late = clientReduce(dropped, { type: 'ACK', seq: 1, status: 'queued' });

    expect(project(late)).toEqual([
      { id: 'a1', shown: 'review', serverKnown: 'queued', optimistic: true, held: false },
    ]);
  });
});

// 規則 3：ADR-0007 —— 指標正按著的卡片不接受任何來自伺服器的移動。
// 少了它，手指還按著，卡片就被伺服器從指標底下抽走。
describe('規則 3 —— 拖曳期間押後快照', () => {
  it('抓著的時候輪詢不動畫面，放開之後押後的快照才套用', () => {
    const held = clientReduce(initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])), {
      type: 'GRAB',
      issueId: 'a1',
    });

    expect(project(held)).toEqual([
      { id: 'a1', shown: 'todo', serverKnown: 'todo', optimistic: false, held: true },
      { id: 'b2', shown: 'backlog', serverKnown: 'backlog', optimistic: false, held: false },
    ]);

    // 輪詢在拖曳中回來：agent 把 a1 推到 done，也把 b2 推到 todo。整份都要押後 ——
    // 只押住被抓的那張、放行其他張，畫面會在拖曳中重排，一樣會把卡片抽走。
    const polled = clientReduce(held, { type: 'POLL', issues: snap(['a1', 'done'], ['b2', 'todo']) });

    expect(project(polled)).toEqual(project(held));

    const released = clientReduce(polled, { type: 'RELEASE' });

    expect(project(released)).toEqual([
      { id: 'a1', shown: 'done', serverKnown: 'done', optimistic: false, held: false },
      { id: 'b2', shown: 'todo', serverKnown: 'todo', optimistic: false, held: false },
    ]);
    expect(released.deferred).toBeNull();
  });
});

// DROP 是「放開」的另一半：指標一樣已經抬起來了。押後的快照若留在 state 裡，
// 會在下一次不相干的 RELEASE 時才套用 —— 那時它已經是一份古老的快照。
describe('DROP 也結束拖曳', () => {
  it('放下之後拖曳鎖解除，押後的快照當場補上，拖的那張仍由樂觀值蓋著', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'GRAB', issueId: 'a1' },
      { type: 'POLL', issues: snap(['a1', 'done'], ['b2', 'todo']) },
      { type: 'DROP', issueId: 'a1', to: 'queued' },
    );

    expect(project(state)).toEqual([
      { id: 'a1', shown: 'queued', serverKnown: 'done', optimistic: true, held: false },
      { id: 'b2', shown: 'todo', serverKnown: 'todo', optimistic: false, held: false },
    ]);
    expect(state.drag).toBeNull();
    expect(state.deferred).toBeNull();
  });
});

// append-only 之下寫入唯一的失敗模式是「根本沒送到」（server 收掉了、board 目錄被移走）。
// 那是唯一需要回滾的情況 —— 不是「伺服器拒絕了你的寫入」，那件事不存在。
describe('FAIL —— 唯一會回滾的動作', () => {
  it('傳輸失敗時卡片退回伺服器上的值', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'])),
      { type: 'DROP', issueId: 'a1', to: 'done' },
      { type: 'FAIL', seq: 1 },
    );

    expect(project(state)).toEqual([
      { id: 'a1', shown: 'todo', serverKnown: 'todo', optimistic: false, held: false },
    ]);
    expect(state.pending).toEqual([]);
  });
});

describe('LAND —— op 已寫進 op-log', () => {
  it('標記那筆變更已落地，畫面不動也不回滾', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'])),
      { type: 'DROP', issueId: 'a1', to: 'queued' },
      { type: 'LAND', seq: 1 },
    );

    expect(state.pending).toEqual([{ seq: 1, issueId: 'a1', value: 'queued', landed: true }]);
    expect(shown(state, 'a1')).toBe('queued');
  });
});

describe('已經不在飛行中的變更', () => {
  it('回應對應到已被回滾（或已處理過）的變更時，什麼都不做', () => {
    const rolledBack = reduceAll(
      initialClient(snap(['a1', 'todo'])),
      { type: 'DROP', issueId: 'a1', to: 'done' },
      { type: 'FAIL', seq: 1 },
    );

    // 傳輸失敗與伺服器回應在網路上交錯，這一筆的回應還是可能之後才到。
    const late = clientReduce(rolledBack, { type: 'ACK', seq: 1, status: 'done' });

    expect(project(late)).toEqual(project(rolledBack));
    expect(late.pending).toEqual([]);
  });
});
