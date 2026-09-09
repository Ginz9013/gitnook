/**
 * 瀏覽器端的調和模型 —— 純函式，不碰 DOM、不 import React。
 *
 * 移植自 .scratch/studio-write/write-model.prototype.html 的「可移植模組 A」，
 * 那份 prototype 已把四個情境走過一遍。
 */

/**
 * reducer 需要的最小結構 —— 只有 id 與 status。
 *
 * 刻意不 import server 的 `IssueView`：這個模組只在乎「哪張 issue 現在在哪一欄」，
 * 標題、內文、留言都與調和無關。UI 拿 `project()` 的結果以 id 接回完整的 issue。
 */
export interface ReconcileIssue {
  readonly id: string;
  readonly status: string;
}

/** 一筆已經反映在畫面上、但還沒被伺服器回應確認的變更。 */
export interface PendingWrite {
  readonly seq: number;
  readonly issueId: string;
  readonly value: string;
  readonly landed: boolean;
}

export interface ClientState {
  /** 最後一次輪詢拿到的伺服器真相。 */
  readonly snapshot: readonly ReconcileIssue[];
  /** 樂觀變更，依 seq 遞增排列。 */
  readonly pending: readonly PendingWrite[];
  /** 指標正按著的卡片。 */
  readonly drag: { readonly issueId: string } | null;
  /** 因為正在拖曳而被押後的快照。 */
  readonly deferred: readonly ReconcileIssue[] | null;
  readonly seq: number;
}

export type ClientAction =
  | { readonly type: 'GRAB'; readonly issueId: string }
  | { readonly type: 'RELEASE' }
  | { readonly type: 'DROP'; readonly issueId: string; readonly to: string }
  | { readonly type: 'LAND'; readonly seq: number }
  | { readonly type: 'ACK'; readonly seq: number; readonly status: string }
  | { readonly type: 'FAIL'; readonly seq: number }
  | { readonly type: 'POLL'; readonly issues: readonly ReconcileIssue[] };

export interface ProjectedIssue {
  readonly id: string;
  /** 畫面上該顯示的值：快照 + 樂觀覆蓋。 */
  readonly shown: string;
  /** 伺服器上次告訴我們的值。 */
  readonly serverKnown: string;
  readonly optimistic: boolean;
  readonly held: boolean;
}

export function initialClient(snapshot: readonly ReconcileIssue[]): ClientState {
  return { snapshot, pending: [], drag: null, deferred: null, seq: 0 };
}

export function clientReduce(state: ClientState, action: ClientAction): ClientState {
  switch (action.type) {
    case 'GRAB':
      // 抓住之後，這張卡片在放開之前不接受任何來自伺服器的移動（ADR-0007）。
      return { ...state, drag: { issueId: action.issueId } };

    case 'RELEASE': {
      if (state.drag === null) return state;
      return endDrag(state);
    }

    case 'DROP': {
      // 樂觀更新：畫面先動，op 之後才送。放下也是放開，因此一併結束拖曳。
      const seq = state.seq + 1;
      const ended = endDrag(state);
      return {
        ...ended,
        seq,
        pending: [
          ...ended.pending,
          { seq, issueId: action.issueId, value: action.to, landed: false },
        ],
      };
    }

    case 'LAND':
      // op 已 append 進 .ndjson。append-only：這一步不可能失敗，也沒有「被拒絕」
      // 這回事。畫面還沒得到任何新資訊，所以什麼都不動。
      return {
        ...state,
        pending: state.pending.map((x) => (x.seq === action.seq ? { ...x, landed: true } : x)),
      };

    case 'ACK': {
      // 伺服器回應。它帶的是「寫入當下摺疊出來的值」——不是永恆真理：在這個回應
      // 飛回來的路上，別人的 op 還是可能後來居上。樂觀值退場，改用它蓋進快照。
      // 這一筆可能已經不在飛行中了（已回滾、或回應重複送達）——那就什麼都不做。
      const p = state.pending.find((x) => x.seq === action.seq);
      if (p === undefined) return state;
      return {
        ...state,
        pending: state.pending.filter((x) => x.seq !== action.seq),
        snapshot: state.snapshot.map((i) =>
          i.id === p.issueId ? { ...i, status: action.status } : i,
        ),
      };
    }

    case 'FAIL':
      // 傳輸失敗（server 收掉了、board 目錄不見了）。這是唯一真正要回滾的情況：
      // 樂觀值退場，快照不動，卡片回到伺服器上的值。
      return { ...state, pending: state.pending.filter((x) => x.seq !== action.seq) };

    case 'POLL':
      // 拖曳期間絕不改動畫面。押著，等放開再說 —— 代價是最多延遲一次輪詢間隔。
      if (state.drag !== null) return { ...state, deferred: action.issues };
      return applySnapshot(state, action.issues);
  }
}

/** 放開指標：拖曳鎖解除，押後的快照補上。 */
function endDrag(state: ClientState): ClientState {
  const released: ClientState = { ...state, drag: null, deferred: null };
  return state.deferred === null ? released : applySnapshot(released, state.deferred);
}

/**
 * 套用一份新快照。關鍵規則：還在飛的樂觀變更蓋過快照 —— 那條覆蓋由 project()
 * 負責，因此這裡只換 snapshot、絕不動 pending。
 */
function applySnapshot(state: ClientState, issues: readonly ReconcileIssue[]): ClientState {
  return { ...state, snapshot: issues };
}

/** 使用者實際看到的東西：快照 + 樂觀覆蓋 + 拖曳鎖。 */
export function project(state: ClientState): readonly ProjectedIssue[] {
  return state.snapshot.map((issue) => {
    // 只認最後一筆：同一張 issue 上較早的變更已被取代，它們之後回來也翻不了案。
    const mine = [...state.pending].reverse().find((p) => p.issueId === issue.id);
    return {
      id: issue.id,
      shown: mine ? mine.value : issue.status,
      serverKnown: issue.status,
      optimistic: mine !== undefined,
      held: state.drag?.issueId === issue.id,
    };
  });
}
