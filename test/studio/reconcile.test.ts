import { describe, it, expect } from 'vitest';
import { initialClient, clientReduce, project } from '../../src/studio/reconcile.js';
import type { ClientAction, ClientState, ReconcileIssue } from '../../src/studio/reconcile.js';

// 純 reducer，environment: 'node'。不碰 DOM、不 import React。
// 四條規則搬自 .scratch/studio-write/write-model.prototype.html 的「可移植模組 A」，
// 每一條都對應一個實際會壞的畫面。

const snap = (...pairs: [string, string][]): readonly ReconcileIssue[] =>
  pairs.map(([id, status]) => full(id, { status }));

const shown = (state: ClientState, id: string): string | undefined =>
  project(state).find((p) => p.id === id)?.shown.status;

const reduceAll = (state: ClientState, ...actions: ClientAction[]): ClientState =>
  actions.reduce(clientReduce, state);

/**
 * 只看 status 的那一面。票 10 把 `shown` 從一個 status 字串擴成整張 issue，
 * 下面四條規則釘的是「卡片在哪一欄」——維持原本的斷言，只換取值的方式。
 *
 * `serverKnown` 直接從 `state.snapshot` 取：投影不再重複帶一份伺服器的值。
 * 這一欄釘的是本模組最中心的不變式 —— **樂觀寫入絕不動到快照** —— 所以它
 * 讀的是真正那一格，而不是投影對它的回音。
 */
const statusView = (
  state: ClientState,
): readonly { id: string; shown: string; serverKnown: string; optimistic: boolean; held: boolean }[] =>
  project(state).map((p) => ({
    id: p.id,
    shown: p.shown.status,
    serverKnown: state.snapshot.find((i) => i.id === p.id)!.status,
    optimistic: p.optimistic.has('status'),
    held: p.held,
  }));

describe('project — 使用者看到的東西', () => {
  it('沒有飛行中的變更時，顯示伺服器快照的值', () => {
    const state = initialClient(snap(['a1', 'todo'], ['b2', 'review']));

    expect(statusView(state)).toEqual([
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

    expect(statusView(state)).toEqual([
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

    expect(statusView(state)).toEqual([
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
      { type: 'ACK', seq: 1, issue: full('a1', { status: 'review' }) },
    );

    expect(statusView(state)).toEqual([
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
    const late = clientReduce(dropped, {
      type: 'ACK',
      seq: 1,
      issue: full('a1', { status: 'queued' }),
    });

    expect(statusView(late)).toEqual([
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

    expect(statusView(held)).toEqual([
      { id: 'a1', shown: 'todo', serverKnown: 'todo', optimistic: false, held: true },
      { id: 'b2', shown: 'backlog', serverKnown: 'backlog', optimistic: false, held: false },
    ]);

    // 輪詢在拖曳中回來：agent 把 a1 推到 done，也把 b2 推到 todo。整份都要押後 ——
    // 只押住被抓的那張、放行其他張，畫面會在拖曳中重排，一樣會把卡片抽走。
    const polled = clientReduce(held, { type: 'POLL', issues: snap(['a1', 'done'], ['b2', 'todo']) });

    expect(project(polled)).toEqual(project(held));

    const released = clientReduce(polled, { type: 'RELEASE' });

    expect(statusView(released)).toEqual([
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

    expect(statusView(state)).toEqual([
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

    expect(statusView(state)).toEqual([
      { id: 'a1', shown: 'todo', serverKnown: 'todo', optimistic: false, held: false },
    ]);
    expect(state.pending).toEqual([]);
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
    const late = clientReduce(rolledBack, {
      type: 'ACK',
      seq: 1,
      issue: full('a1', { status: 'done' }),
    });

    expect(project(late)).toEqual(project(rolledBack));
    expect(late.pending).toEqual([]);
  });
});

// ---- 票 10：PendingWrite 從單一 status 字串擴成一份 Change ----

/** 一張完整的 issue —— server 的 `IssueView` 就是這個形狀（外加預渲染的 HTML）。 */
const full = (id: string, over: Partial<ReconcileIssue> = {}): ReconcileIssue => ({
  id,
  title: `${id} 的標題`,
  status: 'todo',
  description: '內文',
  labels: ['bug'],
  archived: false,
  deleted: false,
  comments: [{ id: 'c1', actor: 'ann@example.com', t: 1, body: '第一則' }],
  ...over,
});

describe('project —— 交出整張 issue', () => {
  it('沒有飛行中的變更時，shown 是整張快照 issue，不是一個 status 字串', () => {
    const a1 = full('a1');
    const state = initialClient([a1]);
    const p = project(state)[0]!;

    expect(p.shown).toEqual(a1);
    expect(state.snapshot).toEqual([a1]);
    expect(p.optimistic).toEqual(new Set());
    expect(p.unconfirmed).toEqual([]);
  });
});

// LWW 欄位：title / description / status / archived —— 同一欄位取最後一筆。
describe('EDIT —— 飛行中的變更是一份 Change', () => {
  it('標題的樂觀值蓋過快照，同一欄位只認最後一筆', () => {
    const state = reduceAll(
      initialClient([full('a1', { title: '舊標題' })]),
      { type: 'EDIT', issueId: 'a1', change: { title: '改了一次' } },
      { type: 'EDIT', issueId: 'a1', change: { title: '再改一次' } },
    );

    const p = project(state)[0]!;

    expect(p.shown.title).toBe('再改一次');
    expect(state.snapshot[0]!.title).toBe('舊標題');
    expect(p.optimistic).toEqual(new Set(['title']));
  });
});

// 票 02 的規則 2 在這裡擴張：本來只有一個欄位，所以「只認最後一筆」講的是
// 整筆 pending；現在一次搬欄位與一次改內文可以同時在飛，彼此不得互相擦掉。
describe('規則 2 —— 每張 issue 的每個欄位各認最後一筆', () => {
  it('同時在飛的搬欄位與改內文互不覆蓋，各自取自己欄位的最後一筆', () => {
    const state = reduceAll(
      initialClient([full('a1', { status: 'todo', description: '舊內文', archived: false })]),
      { type: 'DROP', issueId: 'a1', to: 'queued' },
      { type: 'EDIT', issueId: 'a1', change: { description: '新內文', archived: true } },
      { type: 'DROP', issueId: 'a1', to: 'review' },
    );

    const p = project(state)[0]!;

    expect(p.shown.description).toBe('新內文');
    expect(p.shown.archived).toBe(true);
    expect(p.shown.status).toBe('review');
    expect(p.optimistic).toEqual(new Set(['status', 'description', 'archived']));
  });
});

// label 是 add-wins OR-Set（CONTEXT.md），不是 LWW 的一格值：兩筆在飛的 EDIT
// 要累加，後一筆只帶 add 不代表前一筆的 remove 被撤銷。
describe('labels —— 集合運算', () => {
  it('被移除的不見了、新增的接在尾端，兩筆 EDIT 累加而不是後蓋前', () => {
    const state = reduceAll(
      initialClient([full('a1', { labels: ['bug', 'p1'] })]),
      { type: 'EDIT', issueId: 'a1', change: { labels: { remove: ['bug'] } } },
      { type: 'EDIT', issueId: 'a1', change: { labels: { add: ['ux'] } } },
    );

    const p = project(state)[0]!;

    // 接在尾端與 core 的 reduce() 一致：呈現順序是各值第一個存活 add tag 在全序
    // 中的位置，新增的那筆 t 最大，因此落在最後。
    expect(p.shown.labels).toEqual(['p1', 'ux']);
    expect(state.snapshot[0]!.labels).toEqual(['bug', 'p1']);
    expect(p.optimistic).toEqual(new Set(['labels']));
  });
});

// 留言是附加，不是覆蓋。core 的 reduce() 已用 (t, actor, id) 全序排好 server
// 那份陣列，未確認的留言還沒有 t —— 在前端放第二個比較器把它插進去，正是
// commit 463343d 那個 bug 的成因。它接在後面，不併進去。
describe('comment —— 附加', () => {
  it('未確認的留言留在 unconfirmed，server 給的 comments 一個字都不動', () => {
    const served = [
      { id: 'c1', actor: 'ann@example.com', t: 1, body: '第一則' },
      { id: 'c2', actor: 'bob@example.com', t: 9, body: '第二則' },
    ];
    const state = reduceAll(
      initialClient([full('a1', { comments: served })]),
      { type: 'EDIT', issueId: 'a1', change: { comment: '還沒確認的' } },
      { type: 'EDIT', issueId: 'a1', change: { comment: '再一則' } },
    );

    const p = project(state)[0]!;

    expect(p.shown.comments).toEqual(served);
    expect(p.unconfirmed).toEqual([
      { seq: 1, body: '還沒確認的' },
      { seq: 2, body: '再一則' },
    ]);
    // 留言不是「有樂觀值覆蓋著的欄位」——沒有東西被蓋掉，只是多了兩則在飛的。
    expect(p.optimistic).toEqual(new Set());
  });
});

// 寫入的回應是 POST /i/<ref> 回的整張 IssueView（票 03）。收它整張當新快照，
// 而不是只挑 status 出來 —— 同一次寫入可能同時改了標題、label 與留言。
describe('ACK —— 收伺服器回的整張 issue 當新快照', () => {
  it('標題、label、留言一併換成伺服器回的那張，樂觀值退場', () => {
    const answered = full('a1', {
      status: 'review',
      title: 'agent 改過的標題',
      labels: ['p1'],
      comments: [
        { id: 'c1', actor: 'ann@example.com', t: 1, body: '第一則' },
        { id: 'c2', actor: 'agent@example.com', t: 7, body: 'agent 的留言' },
      ],
    });

    const state = reduceAll(
      initialClient([full('a1', { status: 'todo' })]),
      { type: 'EDIT', issueId: 'a1', change: { title: '我改的標題' } },
      { type: 'ACK', seq: 1, issue: answered },
    );

    const p = project(state)[0]!;

    expect(p.shown).toEqual(answered);
    expect(state.snapshot).toEqual([answered]);
    expect(p.optimistic).toEqual(new Set());
    expect(state.pending).toEqual([]);
  });
});

// 亂序 ACK（原 nook 01M22EFD3，票 10 吸收）：兩次寫入的回應在網路上換了位置。
// 少了這條，ACK(seq2) 之後 seq1 還掛在 pending 上，卡片當場閃回舊欄位 ——
// 而 seq1 帶的是已經被 seq2 取代的值，它永遠不該再上畫面。
describe('亂序 ACK —— 較晚的回應先到', () => {
  it('ACK(seq2) 之後，畫面不得落回 seq1 的值', () => {
    const dropped = reduceAll(
      initialClient(snap(['a1', 'todo'])),
      { type: 'DROP', issueId: 'a1', to: 'queued' }, // seq 1
      { type: 'DROP', issueId: 'a1', to: 'review' }, // seq 2
    );

    const acked2 = clientReduce(dropped, {
      type: 'ACK',
      seq: 2,
      issue: full('a1', { status: 'review' }),
    });

    expect(shown(acked2, 'a1')).toBe('review');
    expect(acked2.pending).toEqual([]);

    // 遲到的 ACK(seq1) 一樣不翻案：它對應的那筆已經不在飛行中了。
    const acked1 = clientReduce(acked2, {
      type: 'ACK',
      seq: 1,
      issue: full('a1', { status: 'queued' }),
    });

    expect(shown(acked1, 'a1')).toBe('review');
  });
});

// seq 是整塊 board 共用的流水號，所以「清掉 seq <= action.seq」必須限縮在同一
// 張 issue 上。少了這條限縮，回應一張卡片會把另一張卡片還在飛的變更一起抹掉
// —— 那正是上面剛修掉的那個閃動，只是換了一張卡片。
describe('亂序 ACK —— 只清同一張 issue', () => {
  it('另一張 issue 上較早、還在飛的變更不受影響', () => {
    const dropped = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'DROP', issueId: 'b2', to: 'todo' }, // seq 1
      { type: 'DROP', issueId: 'a1', to: 'review' }, // seq 2
    );

    const acked = clientReduce(dropped, {
      type: 'ACK',
      seq: 2,
      issue: full('a1', { status: 'review' }),
    });

    expect(shown(acked, 'b2')).toBe('todo');
    expect(acked.pending.map((p) => p.seq)).toEqual([1]);
  });
});

// 特徵測試（寫下來時就是綠的）：釘住「FAIL 不跟著 ACK 掃 seq <= action.seq」
// 這個決定。ACK 說的是「伺服器已經把這張 issue 摺疊到這個版本」，更早的樂觀值
// 因此過期；FAIL 只說「這一個 POST 沒送到」，它對更早那些寫入一無所知。
describe('FAIL —— 只回滾它自己那一筆', () => {
  it('同一張 issue 上較早、還在飛的那筆不受影響', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'])),
      { type: 'EDIT', issueId: 'a1', change: { title: '我改的標題' } }, // seq 1
      { type: 'DROP', issueId: 'a1', to: 'review' }, // seq 2
      { type: 'FAIL', seq: 2 },
    );

    const p = project(state)[0]!;

    expect(p.shown.title).toBe('我改的標題');
    expect(p.shown.status).toBe('todo');
    expect(p.optimistic).toEqual(new Set(['title']));
    expect(state.pending.map((x) => x.seq)).toEqual([1]);
  });
});

// ---- 票 03：ACK 帶回不在快照裡的 issue ----

// 這一條先以特徵測試寫下（當時就是綠的），釘住修改**不得**碰的那一面：快照的
// 成員資格是 server 的決定，client 憑一則寫入回應就把一張 issue 塞進快照是另一個
// bug。ACK 落空時 payload 照樣丟掉 —— 改變的只有「不再無聲無息」，見下一條。
// 今天不會發生（`/api/board` 是 `all: true` 全量），只要有人給它加上過濾就會。
describe('ACK 帶回不在快照裡的 issue —— 不得無條件 append', () => {
  it('伺服器回的那張仍然丟掉，快照一張都不多，畫面上沒有那張卡片', () => {
    // 一份被過濾過的快照：輪詢那一輪把 a1 濾掉了（它已經不符合過濾條件）。
    const filteredOut = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'EDIT', issueId: 'a1', change: { title: '我改的標題' } }, // seq 1
      { type: 'POLL', issues: snap(['b2', 'backlog']) },
    );

    const acked = clientReduce(filteredOut, {
      type: 'ACK',
      seq: 1,
      issue: full('a1', { title: '我改的標題' }),
    });

    // 伺服器剛剛告訴我們 a1 摺疊後長這樣 —— 這份資訊沒有留下任何痕跡。
    expect(acked.snapshot).toEqual(filteredOut.snapshot);
    expect(project(acked).map((p) => p.id)).toEqual(['b2']);
    // 而飛行中的那筆確實退場了。
    expect(acked.pending).toEqual([]);
  });
});

// 落空的 ACK 必須在 state 上留下痕跡。純 reducer 沒有 log、沒有 DOM，唯一能說話
// 的地方就是它回傳的那份 state —— 呼叫端據此重新輪詢一份新快照。
describe('ACK —— 落不到快照上時不得靜默', () => {
  it('記下這次落空，pending 照常退場，快照仍然一張都不多', () => {
    const filteredOut = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'EDIT', issueId: 'a1', change: { title: '我改的標題' } }, // seq 1
      { type: 'POLL', issues: snap(['b2', 'backlog']) },
    );

    const acked = clientReduce(filteredOut, {
      type: 'ACK',
      seq: 1,
      issue: full('a1', { title: '我改的標題' }),
    });

    expect(acked.unmatchedAck).toEqual({ seq: 1, issueId: 'a1' });
    expect(acked.pending).toEqual([]);
    expect(acked.snapshot).toEqual(filteredOut.snapshot);
  });

  it('落得到快照上的 ACK 不留痕跡', () => {
    const acked = reduceAll(
      initialClient(snap(['a1', 'todo'])),
      { type: 'DROP', issueId: 'a1', to: 'review' },
      { type: 'ACK', seq: 1, issue: full('a1', { status: 'review' }) },
    );

    expect(acked.unmatchedAck).toBeNull();
  });
});

// 標記必須自己退場，否則它只是另一種「永遠留在畫面上」。答覆它的東西就是下一份
// 快照 —— 那份快照到達時，「我手上這份落後了」這句話已經沒有意義了。
describe('unmatchedAck —— 由下一份套用的快照清掉', () => {
  /** 一份「落後的快照 + 一則落空的 ACK」。 */
  const stale = (): ClientState =>
    reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'EDIT', issueId: 'a1', change: { title: '我改的標題' } }, // seq 1
      { type: 'POLL', issues: snap(['b2', 'backlog']) },
      { type: 'ACK', seq: 1, issue: full('a1', { title: '我改的標題' }) },
    );

  it('POLL 套用新快照之後標記歸零', () => {
    const before = stale();

    expect(before.unmatchedAck).toEqual({ seq: 1, issueId: 'a1' });

    const after = clientReduce(before, {
      type: 'POLL',
      issues: snap(['a1', 'todo'], ['b2', 'backlog']),
    });

    expect(after.unmatchedAck).toBeNull();
  });

  it('拖曳中押後的快照不清標記，放開真的套用時才清', () => {
    const before = stale();
    const held = clientReduce(before, { type: 'GRAB', issueId: 'b2' });
    const polled = clientReduce(held, {
      type: 'POLL',
      issues: snap(['a1', 'todo'], ['b2', 'backlog']),
    });

    // 押後期間畫面與 state 都不動 —— 這份快照還沒套用。
    expect(polled.unmatchedAck).toEqual({ seq: 1, issueId: 'a1' });

    const released = clientReduce(polled, { type: 'RELEASE' });

    expect(released.unmatchedAck).toBeNull();
  });
});

// ---- 票 01：ACK 帶的 issue.id 與 pending 的 issueId 不一致 ----

// 選槽用 `p.issueId`、寫入用 `action.issue`，兩個 id 不同時回應就落進錯的槽：
// 快照冒出重複 id，原本那張當場消失 —— 而重複 id 之後每一條「找那張 issue」的
// 路徑（project、拖曳、drawer）都跟著錯。
describe('ACK —— 回應帶的 issue.id 與 pending 的 issueId 不一致', () => {
  /** 對 a1 送出一筆寫入（seq 1），快照裡 a1、b2 都在。 */
  const inflight = (): ClientState =>
    clientReduce(initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])), {
      type: 'EDIT',
      issueId: 'a1',
      change: { title: '我改的標題' },
    });

  it('不得寫進 pending 指的那一格 —— 快照不出現重複 id，原本那張也不消失', () => {
    const state = inflight();

    // 伺服器回的這張說自己是 b2，但這個 seq 我們送的是對 a1 的寫入。
    const acked = clientReduce(state, {
      type: 'ACK',
      seq: 1,
      issue: full('b2', { title: '別張的標題' }),
    });

    expect(acked.snapshot.map((i) => i.id)).toEqual(['a1', 'b2']);
    expect(acked.snapshot).toEqual(state.snapshot);
  });

  // 不一致本身就是異常，而 reducer 沒有辦法從中判斷伺服器摺疊的是哪一張 ——
  // 與票 03 的落空 ACK 同一種處理：payload 丟掉、記在 state 上、由呼叫端重新
  // 輪詢一份權威快照。issueId 記 pending 那一個：那是呼叫端手上有的東西。
  it('把不一致記成落空的 ACK，pending 照常退場', () => {
    const acked = clientReduce(inflight(), {
      type: 'ACK',
      seq: 1,
      issue: full('b2', { title: '別張的標題' }),
    });

    expect(acked.unmatchedAck).toEqual({ seq: 1, issueId: 'a1' });
    expect(acked.pending).toEqual([]);
  });
});

// ---- 票 A5：CREATED 進快照、`deleted` 的 ACK 離開快照 ----

// 新增不做樂觀更新：新 Issue 的 ULID 由 server 產生，client 沒有 id 可以先畫。
// `CREATED` 只做一件事 —— 把 server 回來的那張接進快照尾端。
describe('CREATED —— server 回來的新 issue 進快照', () => {
  it('接在快照尾端，project() 含那張', () => {
    const created = full('c3', { status: 'backlog', title: '剛開的' });

    const state = clientReduce(initialClient(snap(['a1', 'todo'], ['b2', 'review'])), {
      type: 'CREATED',
      issue: created,
    });

    expect(state.snapshot.map((i) => i.id)).toEqual(['a1', 'b2', 'c3']);
    expect(project(state).map((p) => p.id)).toEqual(['a1', 'b2', 'c3']);
    expect(project(state)[2]!.shown).toEqual(created);
  });
});

// 輪詢先一步把新開的那張帶回來了（POST 的回應比下一輪輪詢晚到）。少了這條，
// 快照裡會冒出兩張同 id 的卡片 —— 而之後每一條「找那張 issue」的路徑（project、
// 拖曳、drawer）都跟著錯，那正是票 01 記下的那個形狀。
describe('CREATED —— 快照裡已經有那個 id 時', () => {
  it('不重複加，快照原封不動', () => {
    const polled = clientReduce(initialClient(snap(['a1', 'todo'])), {
      type: 'POLL',
      issues: snap(['a1', 'todo'], ['c3', 'backlog']),
    });

    const created = clientReduce(polled, {
      type: 'CREATED',
      // 建立當下摺疊出來的那張，比輪詢那份舊：輪詢跑在 POST 回應之前。
      issue: full('c3', { status: 'backlog' }),
    });

    expect(created.snapshot.map((i) => i.id)).toEqual(['a1', 'c3']);
    expect(created.snapshot).toEqual(polled.snapshot);
  });
});

// 規則三押後的是 `POLL`：它保護的是「手指按著的那張不被伺服器抽走」。新增與被
// 抓著的那張無關 —— 押後它只會讓剛開好的 Issue 在放開之前憑空消失一段時間。
describe('CREATED —— 拖曳中不被押後', () => {
  it('抓著卡片時新開的那張立刻進快照，deferred 不被動到', () => {
    const held = clientReduce(initialClient(snap(['a1', 'todo'])), {
      type: 'GRAB',
      issueId: 'a1',
    });

    const created = clientReduce(held, { type: 'CREATED', issue: full('c3', { status: 'todo' }) });

    expect(created.snapshot.map((i) => i.id)).toEqual(['a1', 'c3']);
    expect(project(created).map((p) => p.id)).toEqual(['a1', 'c3']);
    expect(created.deferred).toBeNull();
    // 拖曳鎖本身不受影響：放開的仍然是 a1。
    expect(created.drag).toEqual({ issueId: 'a1' });
  });
});

// 刪除是 `set deleted=<bool>`（D1），所以它走的是既有的 `POST /i/<ref>` 與既有的
// ACK。而現行的 ACK 是「用回應覆蓋那一格」—— 照做會在畫面上留下一張已刪但仍然
// 畫著的卡片，而且點得開、拖得動。
describe('ACK —— 回應帶 deleted: true', () => {
  it('那張離開快照，它的 pending 一併結清', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'EDIT', issueId: 'a1', change: { archived: true } }, // seq 1
      { type: 'EDIT', issueId: 'a1', change: { title: '刪之前改的' } }, // seq 2
      { type: 'ACK', seq: 2, issue: full('a1', { deleted: true }) },
    );

    expect(state.snapshot.map((i) => i.id)).toEqual(['b2']);
    expect(project(state).map((p) => p.id)).toEqual(['b2']);
    expect(state.pending).toEqual([]);
    // 這則 ACK **落到了**快照上 —— 它做的事是移除而不是覆蓋。把它記成落空，
    // 呼叫端會為了一次成功的刪除多抓一份快照。
    expect(state.unmatchedAck).toBeNull();
  });
});

// 刪除的回應飛回來的路上，同一張 issue 上可能還有更晚送出的寫入（drawer 上改了
// 標題才按刪除，兩個 POST 各自在飛）。既有的 ACK 只清 `seq <= action.seq` ——
// 剩下那筆之後永遠不會上畫面（`project()` 只走快照，那張已經不在了），卻會在
// 這張被復原（`deleted false`）、輪詢帶回來的那一刻整個冒出來。
describe('ACK —— deleted: true 之後那張 issue 上不留任何飛行中的變更', () => {
  it('seq 比這則 ACK 更晚的 pending 也退場，別張 issue 的不受影響', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'EDIT', issueId: 'a1', change: { title: '刪之前改的' } }, // seq 1
      { type: 'EDIT', issueId: 'b2', change: { title: '別張的' } }, // seq 2
      { type: 'EDIT', issueId: 'a1', change: { description: '刪之後才送出的' } }, // seq 3
      // 刪除那一筆（seq 1）的回應現在到了，seq 3 還在飛。
      { type: 'ACK', seq: 1, issue: full('a1', { deleted: true }) },
    );

    expect(state.snapshot.map((i) => i.id)).toEqual(['b2']);
    expect(state.pending.map((p) => p.seq)).toEqual([2]);
  });
});

// 規則三（ADR-0007）保護的是「手指按著的那張不被伺服器**移動**」。刪除不是移動：
// 使用者刪的就是這一張，而留著一張抓不放的幽靈卡片，比在指標底下抽掉它更糟 ——
// 放開之後它還會落回某一欄，然後每一次點擊都打在一張伺服器上已經不存在的 Issue 上。
describe('ACK —— deleted: true 而那張正被抓著', () => {
  it('仍然離開快照', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'GRAB', issueId: 'a1' },
      { type: 'EDIT', issueId: 'a1', change: { title: '抓著的時候改的' } }, // seq 1
      { type: 'ACK', seq: 1, issue: full('a1', { deleted: true }) },
    );

    expect(state.snapshot.map((i) => i.id)).toEqual(['b2']);
    expect(project(state).map((p) => p.id)).toEqual(['b2']);
    expect(state.pending).toEqual([]);
  });
});

// 復原走的是同一條 op（`deleted false`，D1），也回同一種 `IssueView`。移除的觸發
// 條件因此必須是「`deleted` **是 true**」而不是「回應帶了 `deleted` 這個欄位」——
// 後者會把每一則正常的 ACK 都當成刪除。
describe('ACK —— 回應帶 deleted: false', () => {
  it('照常蓋回那一格，那張留在快照上', () => {
    const answered = full('a1', { status: 'review', title: '伺服器上的標題', deleted: false });

    const state = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'EDIT', issueId: 'a1', change: { title: '我改的標題' } }, // seq 1
      { type: 'ACK', seq: 1, issue: answered },
    );

    expect(state.snapshot.map((i) => i.id)).toEqual(['a1', 'b2']);
    expect(project(state)[0]!.shown).toEqual(answered);
    expect(project(state)[0]!.optimistic).toEqual(new Set());
    expect(state.pending).toEqual([]);
    expect(state.unmatchedAck).toBeNull();
  });
});

// 拖曳鎖指著一個已經不在快照裡的 id 時，`POLL` 會一直被押後，等一個永遠不會來的
// `RELEASE` —— 卡片已經 unmount，指標放開時沒有東西送得出那個 action。實務上
// dnd-kit 會在 unmount 時送 cancel 而自行解開，但**保證這件事的必須是 reducer**：
// 它是有測試的那一層，而畫面停止更新是靠一個外部函式庫的善意在撐著。
describe('ACK —— deleted: true 移除的正是被抓著的那張', () => {
  it('拖曳鎖跟著解除，後續的 POLL 不再被押後', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'GRAB', issueId: 'a1' },
      { type: 'EDIT', issueId: 'a1', change: { deleted: true } }, // seq 1
      { type: 'ACK', seq: 1, issue: full('a1', { deleted: true }) },
    );

    expect(state.snapshot.map((i) => i.id)).toEqual(['b2']);
    expect(state.drag).toBeNull();

    const polled = clientReduce(state, { type: 'POLL', issues: snap(['b2', 'review']) });
    expect(polled.deferred).toBeNull();
    expect(shown(polled, 'b2')).toBe('review');
  });

  it('移除的是別張時，拖曳鎖不動', () => {
    const state = reduceAll(
      initialClient(snap(['a1', 'todo'], ['b2', 'backlog'])),
      { type: 'GRAB', issueId: 'a1' },
      { type: 'EDIT', issueId: 'b2', change: { deleted: true } }, // seq 1
      { type: 'ACK', seq: 1, issue: full('b2', { deleted: true }) },
    );

    expect(state.snapshot.map((i) => i.id)).toEqual(['a1']);
    expect(state.drag).toEqual({ issueId: 'a1' });

    // 手指還按著 a1，所以規則三照舊：這份快照押後，不上畫面。
    const polled = clientReduce(state, { type: 'POLL', issues: snap(['a1', 'review']) });
    expect(polled.deferred).not.toBeNull();
    expect(shown(polled, 'a1')).toBe('todo');
  });
});
