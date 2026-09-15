/**
 * 瀏覽器端的調和模型 —— Decision 專用，平行於 `reconcile.ts` 而不是共用它。
 *
 * **為什麼不共用 `ReconcileIssue` 的泛型限制。** `ReconcileIssue` 卡死在
 * `status`/`labels`/`archived`/`comments`，而 GRAB/RELEASE/DROP 三個拖曳動作
 * 對沒有看板的 Decision 完全無意義 —— Decision 沒有 Status/Lane（spec.md
 * Non-goals）。這是兩個真實 adapter 但差異是真的，同 core 那邊
 * `decisionReduce.ts` 之於 `reduce.ts` 的既有先例：平行、不硬拗一個「兩者都要
 * 塞得下」的泛型介面。
 *
 * 動作集合刻意是 `SNAPSHOT | EDIT | CREATED | ACK | FAIL`——比 Issue 少
 * GRAB/RELEASE/DROP，也沒有 `POLL`：沒有拖曳鎖，一份新快照到達就是直接套用，
 * 不必先問「現在有沒有人按著卡片」。
 */

/**
 * reducer 需要的最小結構 —— server 的 `DecisionView` 正是這個形狀（外加預渲染
 * 的 `bodyHtml`）。**刻意不 import 它**：同 `ReconcileIssue`，這個模組不依賴
 * `src/server/**` 也不依賴 `src/studio/api.ts`。
 */
export interface ReconcileDecision {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly disposition: string;
  /** 指向另一個 Decision 的 ref，只驗形狀不驗存在（spec.md Non-goals）。 */
  readonly supersededBy?: string;
  /** 遷移用的唯讀欄位。調和不改它，只原樣照抄（沒有任何 change 會帶它）。 */
  readonly legacyRef?: string;
}

/**
 * 呼叫端表達的意圖，core 的 `DecisionChange`（`decisionTypes.ts`）。同
 * `ReconcileChange`，結構型別在本檔宣告，不從 core 或 `api.ts` import。
 *
 * `disposition` 是 `string` 而不是收窄的 `Disposition`：core 也收無歧義前綴，
 * 調和不需要知道四個值是哪四個。
 */
export interface ReconcileDecisionChange {
  readonly title?: string;
  readonly body?: string;
  readonly disposition?: string;
  readonly supersededBy?: string;
}

/** 一筆已經反映在畫面上、但還沒被伺服器回應確認的變更。 */
export interface PendingDecisionWrite {
  readonly seq: number;
  readonly decisionId: string;
  readonly change: ReconcileDecisionChange;
}

/**
 * 一則落不到快照上的 ACK：伺服器確認了對這筆 Decision 的寫入，但它不在我們
 * 手上的這份快照裡。同 `reconcile.ts` 的 `UnmatchedAck`——這句話說的是「這份
 * 快照落後了」，不是「這筆 Decision 不存在」。
 */
export interface UnmatchedDecisionAck {
  readonly seq: number;
  readonly decisionId: string;
}

export interface ClientDecisionState<D extends ReconcileDecision = ReconcileDecision> {
  /** 最後一次輪詢拿到的伺服器真相。 */
  readonly snapshot: readonly D[];
  /** 樂觀變更，依 seq 遞增排列。 */
  readonly pending: readonly PendingDecisionWrite[];
  readonly seq: number;
  readonly unmatchedAck: UnmatchedDecisionAck | null;
}

export type ClientDecisionAction<D extends ReconcileDecision = ReconcileDecision> =
  | { readonly type: 'SNAPSHOT'; readonly decisions: readonly D[] }
  | { readonly type: 'EDIT'; readonly decisionId: string; readonly change: ReconcileDecisionChange }
  | { readonly type: 'ACK'; readonly seq: number; readonly decision: D }
  | { readonly type: 'FAIL'; readonly seq: number }
  | { readonly type: 'CREATED'; readonly decision: D };

/** 有樂觀值覆蓋著的欄位。 */
export type OptimisticDecisionField = 'title' | 'body' | 'disposition' | 'supersededBy';

export interface ProjectedDecision<D extends ReconcileDecision = ReconcileDecision> {
  readonly id: string;
  /** 畫面上該顯示的整筆 Decision：快照 + 樂觀覆蓋。 */
  readonly shown: D;
  /** 上面哪些欄位是樂觀值。空集合表示畫面上這筆就是伺服器上那筆。 */
  readonly optimistic: ReadonlySet<OptimisticDecisionField>;
}

export function initialDecisionClient<D extends ReconcileDecision>(
  snapshot: readonly D[],
): ClientDecisionState<D> {
  return { snapshot, pending: [], seq: 0, unmatchedAck: null };
}

export function clientDecisionReduce<D extends ReconcileDecision>(
  state: ClientDecisionState<D>,
  action: ClientDecisionAction<D>,
): ClientDecisionState<D> {
  switch (action.type) {
    case 'EDIT': {
      // Drawer 的樂觀編輯。畫面先動，POST 之後才送 —— 同 `reconcile.ts` 的 EDIT。
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        pending: [...state.pending, { seq, decisionId: action.decisionId, change: action.change }],
      };
    }

    case 'ACK': {
      // 這一筆可能已經不在飛行中了（已回滾、或回應重複送達）——那就什麼都不做。
      const p = state.pending.find((x) => x.seq === action.seq);
      if (p === undefined) return state;

      // 同 `reconcile.ts` 的 ACK：選槽用 `p.decisionId`，落不落地要求兩件事都
      // 成立 —— 回應的 id 與送出這筆寫入時的 id 一致，而且那個 id 真的在快照裡。
      const lands =
        action.decision.id === p.decisionId && state.snapshot.some((d) => d.id === action.decision.id);

      return {
        ...state,
        unmatchedAck: lands ? state.unmatchedAck : { seq: action.seq, decisionId: p.decisionId },
        // 同一筆 Decision 上，連同 `seq <= action.seq` 的一起退場 —— 理由同
        // `reconcile.ts`：兩次寫入的回應在網路上換了位置時，只拿掉較晚那筆的
        // seq 會讓較早那筆留在 pending 上，帶著已經被取代的舊值。
        pending: state.pending.filter((x) => x.decisionId !== p.decisionId || x.seq > action.seq),
        snapshot: lands
          ? state.snapshot.map((d) => (d.id === action.decision.id ? action.decision : d))
          : state.snapshot,
      };
    }

    case 'FAIL':
      // 傳輸失敗。這是唯一真正要回滾的情況：樂觀值退場，快照不動。
      // 刻意不跟著 ACK 掃 `seq <= action.seq`——理由同 `reconcile.ts`：FAIL
      // 只說「這一個 POST 沒送到」，對更早那些寫入一無所知。
      return { ...state, pending: state.pending.filter((x) => x.seq !== action.seq) };

    case 'SNAPSHOT':
      // 套用一份新快照。還在飛的樂觀變更蓋過快照 —— 那條覆蓋由 projectDecisions
      // 負責，這裡只換 snapshot、絕不動 pending。unmatchedAck 在這裡歸零：
      // 清的時機正是「答覆它的那份快照真的上場了」。
      return { ...state, snapshot: action.decisions, unmatchedAck: null };

    case 'CREATED':
      // 新增不做樂觀更新：新 Decision 的 ULID 由 server 產生，client 沒有 id
      // 可以先畫（同 `reconcile.ts` 的 CREATED）。已經在快照裡就什麼都不做 ——
      // 輪詢跑在 POST 回應之前時就是這個情況。
      return state.snapshot.some((d) => d.id === action.decision.id)
        ? state
        : { ...state, snapshot: [...state.snapshot, action.decision] };
  }
}

/** 使用者實際看到的東西：快照 + 樂觀覆蓋。 */
export function projectDecisions<D extends ReconcileDecision>(
  state: ClientDecisionState<D>,
): readonly ProjectedDecision<D>[] {
  return state.snapshot.map((decision) => {
    const optimistic = new Set<OptimisticDecisionField>();
    let shown = decision;

    // pending 依 seq 遞增排列（append 而來），照著套就是「同一欄位只認最後一
    // 筆」——較早的那筆已被取代，它之後回來也翻不了案。
    for (const p of state.pending) {
      if (p.decisionId !== decision.id) continue;
      if (p.change.title !== undefined) {
        shown = { ...shown, title: p.change.title };
        optimistic.add('title');
      }
      if (p.change.body !== undefined) {
        shown = { ...shown, body: p.change.body };
        optimistic.add('body');
      }
      if (p.change.disposition !== undefined) {
        shown = { ...shown, disposition: p.change.disposition };
        optimistic.add('disposition');
      }
      if (p.change.supersededBy !== undefined) {
        shown = { ...shown, supersededBy: p.change.supersededBy };
        optimistic.add('supersededBy');
      }
    }

    return { id: decision.id, shown, optimistic };
  });
}
