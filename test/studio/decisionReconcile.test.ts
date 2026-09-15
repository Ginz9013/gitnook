import { describe, it, expect } from 'vitest';
import {
  clientDecisionReduce,
  initialDecisionClient,
  projectDecisions,
} from '../../src/studio/decisionReconcile.js';
import type {
  ClientDecisionAction,
  ClientDecisionState,
  ReconcileDecision,
} from '../../src/studio/decisionReconcile.js';

// 純 reducer，environment: 'node'。不碰 DOM、不 import React。
// 鏡射 test/studio/reconcile.test.ts 的手法，但沒有 GRAB/RELEASE/DROP ——
// Decision 沒有看板，沒有拖曳（spec.md Domain decisions）。

const full = (id: string, over: Partial<ReconcileDecision> = {}): ReconcileDecision => ({
  id,
  title: 'untitled',
  body: '',
  disposition: 'proposed',
  ...over,
});

const snap = (...pairs: [string, string][]): readonly ReconcileDecision[] =>
  pairs.map(([id, disposition]) => full(id, { disposition }));

const reduceAll = (
  state: ClientDecisionState,
  ...actions: ClientDecisionAction[]
): ClientDecisionState => actions.reduce(clientDecisionReduce, state);

const view = (
  state: ClientDecisionState,
): readonly {
  id: string;
  shown: string;
  serverKnown: string;
  optimistic: boolean;
}[] =>
  projectDecisions(state).map((p) => ({
    id: p.id,
    shown: p.shown.disposition,
    serverKnown: state.snapshot.find((d) => d.id === p.id)!.disposition,
    optimistic: p.optimistic.has('disposition'),
  }));

describe('projectDecisions — 使用者看到的東西', () => {
  it('沒有飛行中的變更時，顯示伺服器快照的值', () => {
    const state = initialDecisionClient(snap(['a1', 'proposed'], ['b2', 'accepted']));

    expect(view(state)).toEqual([
      { id: 'a1', shown: 'proposed', serverKnown: 'proposed', optimistic: false },
      { id: 'b2', shown: 'accepted', serverKnown: 'accepted', optimistic: false },
    ]);
  });
});

describe('SNAPSHOT — 套用一份新的伺服器快照', () => {
  it('換掉快照，投影跟著換', () => {
    const state = clientDecisionReduce(initialDecisionClient(snap(['a1', 'proposed'])), {
      type: 'SNAPSHOT',
      decisions: snap(['a1', 'accepted']),
    });

    expect(view(state)).toEqual([
      { id: 'a1', shown: 'accepted', serverKnown: 'accepted', optimistic: false },
    ]);
  });

  it('未落地的 ACK 標記在新快照套用時歸零', () => {
    const dropped = clientDecisionReduce(initialDecisionClient(snap(['a1', 'proposed'])), {
      type: 'ACK',
      seq: 999,
      decision: full('ghost'),
    });
    // 這則 ACK 沒有對應的 pending，什麼都不會發生 —— 先製造一筆真的 pending。
    const edited = clientDecisionReduce(dropped, {
      type: 'EDIT',
      decisionId: 'a1',
      change: { title: 'renamed' },
    });
    const acked = clientDecisionReduce(edited, {
      type: 'ACK',
      seq: edited.seq,
      decision: full('not-in-snapshot'),
    });
    expect(acked.unmatchedAck).not.toBeNull();

    const snapshotted = clientDecisionReduce(acked, {
      type: 'SNAPSHOT',
      decisions: snap(['a1', 'proposed']),
    });

    expect(snapshotted.unmatchedAck).toBeNull();
  });
});

describe('EDIT — 樂觀更新', () => {
  it('畫面立刻顯示改過的欄位，不等伺服器', () => {
    const state = clientDecisionReduce(initialDecisionClient(snap(['a1', 'proposed'])), {
      type: 'EDIT',
      decisionId: 'a1',
      change: { disposition: 'accepted' },
    });

    expect(view(state)).toEqual([
      { id: 'a1', shown: 'accepted', serverKnown: 'proposed', optimistic: true },
    ]);
    expect(state.seq).toBe(1);
  });

  it('title/body/supersededBy 各自獨立套上樂觀值', () => {
    const state = clientDecisionReduce(initialDecisionClient(snap(['a1', 'proposed'])), {
      type: 'EDIT',
      decisionId: 'a1',
      change: { title: 'new title', body: 'new body', supersededBy: '01JXYZ' },
    });

    const [projected] = projectDecisions(state);
    expect(projected!.shown).toMatchObject({
      title: 'new title',
      body: 'new body',
      supersededBy: '01JXYZ',
    });
    expect([...projected!.optimistic].sort()).toEqual(['body', 'supersededBy', 'title']);
  });
});

describe('規則 —— 同一筆 Decision 只認最後一筆飛行中的變更', () => {
  it('較晚的那筆蓋過較早的，被取代的那筆之後回來也不翻案', () => {
    const dropped = clientDecisionReduce(
      clientDecisionReduce(initialDecisionClient(snap(['a1', 'proposed'])), {
        type: 'EDIT',
        decisionId: 'a1',
        change: { disposition: 'accepted' },
      }),
      { type: 'EDIT', decisionId: 'a1', change: { disposition: 'rejected' } },
    );

    expect(view(dropped)[0]!.shown).toBe('rejected');

    // 第 1 筆的回應現在才回來，帶著它寫入當下的值 accepted。它已經被第 2 筆取代了。
    const late = clientDecisionReduce(dropped, {
      type: 'ACK',
      seq: 1,
      decision: full('a1', { disposition: 'accepted' }),
    });

    expect(view(late)).toEqual([
      { id: 'a1', shown: 'rejected', serverKnown: 'accepted', optimistic: true },
    ]);
  });
});

describe('ACK — 帶的是寫入當下的值，不是永恆真理', () => {
  it('伺服器回的值與送出的不同時，畫面接受伺服器的值而不是回滾', () => {
    const state = reduceAll(
      initialDecisionClient(snap(['a1', 'proposed'])),
      { type: 'EDIT', decisionId: 'a1', change: { disposition: 'rejected' } },
      { type: 'ACK', seq: 1, decision: full('a1', { disposition: 'accepted' }) },
    );

    expect(view(state)).toEqual([
      { id: 'a1', shown: 'accepted', serverKnown: 'accepted', optimistic: false },
    ]);
    expect(state.pending).toEqual([]);
  });

  it('回應對不上任何一筆快照時，落空的 ACK 記在 state 上而不是硬塞進快照', () => {
    const state = reduceAll(
      initialDecisionClient(snap(['a1', 'proposed'])),
      { type: 'EDIT', decisionId: 'a1', change: { disposition: 'rejected' } },
      { type: 'ACK', seq: 1, decision: full('not-a1', { disposition: 'accepted' }) },
    );

    expect(state.snapshot.map((d) => d.id)).toEqual(['a1']);
    expect(state.unmatchedAck).toEqual({ seq: 1, decisionId: 'a1' });
    expect(state.pending).toEqual([]);
  });

  it('找不到對應 pending 的 ACK（已回滾或重複送達）原樣回傳', () => {
    const state = initialDecisionClient(snap(['a1', 'proposed']));

    const after = clientDecisionReduce(state, {
      type: 'ACK',
      seq: 999,
      decision: full('a1', { disposition: 'accepted' }),
    });

    expect(after).toBe(state);
  });
});

describe('FAIL — 傳輸失敗時回滾，快照不動', () => {
  it('樂觀值退場，畫面回到伺服器上的值', () => {
    const state = reduceAll(
      initialDecisionClient(snap(['a1', 'proposed'])),
      { type: 'EDIT', decisionId: 'a1', change: { disposition: 'rejected' } },
      { type: 'FAIL', seq: 1 },
    );

    expect(view(state)).toEqual([
      { id: 'a1', shown: 'proposed', serverKnown: 'proposed', optimistic: false },
    ]);
    expect(state.pending).toEqual([]);
  });

  it('FAIL 不影響更早或更晚、其他 seq 的飛行中變更', () => {
    const state = reduceAll(
      initialDecisionClient(snap(['a1', 'proposed'])),
      { type: 'EDIT', decisionId: 'a1', change: { title: 'first' } },
      { type: 'EDIT', decisionId: 'a1', change: { body: 'second' } },
      { type: 'FAIL', seq: 1 },
    );

    expect(state.pending).toEqual([{ seq: 2, decisionId: 'a1', change: { body: 'second' } }]);
  });
});

describe('CREATED — 新增不做樂觀更新，接在快照尾端', () => {
  it('把 server 回來的那筆接進快照', () => {
    const state = clientDecisionReduce(initialDecisionClient(snap(['a1', 'proposed'])), {
      type: 'CREATED',
      decision: full('b2', { title: 'brand new' }),
    });

    expect(state.snapshot.map((d) => d.id)).toEqual(['a1', 'b2']);
  });

  it('已經在快照裡時什麼都不做 —— 不會冒出兩筆同 id', () => {
    const state = clientDecisionReduce(initialDecisionClient(snap(['a1', 'proposed'])), {
      type: 'CREATED',
      decision: full('a1', { title: 'duplicate' }),
    });

    expect(state.snapshot).toHaveLength(1);
    expect(state.snapshot[0]!.title).toBe('untitled');
  });
});
