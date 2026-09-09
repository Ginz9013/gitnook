/**
 * 瀏覽器端的調和模型 —— 純函式，不碰 DOM、不 import React。
 *
 * 移植自 .scratch/studio-write/write-model.prototype.html 的「可移植模組 A」，
 * 那份 prototype 已把四個情境走過一遍。
 */

/** 一則留言。core 的 `reduce()` 已用 `(t, actor, id)` 全序排好，這裡絕不重排。 */
export interface ReconcileComment {
  readonly id: string;
  readonly actor: string;
  readonly t: number;
  readonly body: string;
}

/**
 * reducer 需要的最小結構 —— server 的 `IssueView` 正是這個形狀（外加預渲染的
 * HTML）。**刻意不 import 它**：這個模組不依賴 `src/server/**` 也不依賴
 * `src/studio/api.ts`，結構型別在本檔宣告，型別檢查因此不跟著 handler.ts 走。
 *
 * 型別參數 `I` 讓呼叫端帶著自己那個更寬的形狀進出（`descriptionHtml`、
 * `bodyHtml` 都原封不動地留在裡面）—— 調和只認得下面這幾個欄位，其餘一律照抄。
 */
export interface ReconcileIssue {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly description: string;
  readonly labels: readonly string[];
  readonly archived: boolean;
  readonly comments: readonly ReconcileComment[];
}

/**
 * 呼叫端表達的意圖，core 的 `Change`（CONTEXT.md）。同 `ReconcileIssue`，
 * 結構型別在本檔宣告，不從 `src/core/types.ts` 或 `src/studio/api.ts` import。
 *
 * `status` 是 `string` 而不是收窄的 `Status`：core 也收無歧義前綴，而調和
 * 不需要知道八個值是哪八個 —— 它只是把字串蓋上去。
 */
export interface ReconcileChange {
  readonly title?: string;
  readonly description?: string;
  readonly status?: string;
  readonly archived?: boolean;
  readonly labels?: { readonly add?: readonly string[]; readonly remove?: readonly string[] };
  readonly comment?: string;
}

/**
 * 一筆已經反映在畫面上、但還沒被伺服器回應確認的變更。
 *
 * 帶的是一份 `Change` 而不是單一 status 字串：拖拉只改 status，但 drawer 要改
 * 標題、增減 label、留言 —— 兩份樂觀模型會分歧，所以只留這一份（票 10）。
 */
export interface PendingWrite {
  readonly seq: number;
  readonly issueId: string;
  readonly change: ReconcileChange;
  readonly landed: boolean;
}

/**
 * 一則落不到快照上的 ACK：伺服器確認了對這張 issue 的寫入，但它不在我們手上的
 * 這份快照裡。它說的是「這份快照落後了」，不是「這張 issue 不存在」——
 * 成員資格永遠是 server 的決定。
 */
export interface UnmatchedAck {
  readonly seq: number;
  readonly issueId: string;
}

export interface ClientState<I extends ReconcileIssue = ReconcileIssue> {
  /** 最後一次輪詢拿到的伺服器真相。 */
  readonly snapshot: readonly I[];
  /** 樂觀變更，依 seq 遞增排列。 */
  readonly pending: readonly PendingWrite[];
  /** 指標正按著的卡片。 */
  readonly drag: { readonly issueId: string } | null;
  /** 因為正在拖曳而被押後的快照。 */
  readonly deferred: readonly I[] | null;
  readonly seq: number;
  /**
   * 最後一則落空的 ACK，沒有就是 `null`。純 reducer 不能 log、不能碰 DOM ——
   * 回傳的 state 是它唯一能說話的地方，這一格就是那句話。
   */
  readonly unmatchedAck: UnmatchedAck | null;
}

export type ClientAction<I extends ReconcileIssue = ReconcileIssue> =
  | { readonly type: 'GRAB'; readonly issueId: string }
  | { readonly type: 'RELEASE' }
  | { readonly type: 'DROP'; readonly issueId: string; readonly to: string }
  | { readonly type: 'EDIT'; readonly issueId: string; readonly change: ReconcileChange }
  | { readonly type: 'LAND'; readonly seq: number }
  | { readonly type: 'ACK'; readonly seq: number; readonly issue: I }
  | { readonly type: 'FAIL'; readonly seq: number }
  | { readonly type: 'POLL'; readonly issues: readonly I[] };

/** 有樂觀值覆蓋著的欄位。 */
export type OptimisticField = 'title' | 'description' | 'status' | 'labels' | 'archived';

/** 還沒被伺服器確認的留言。只有原文 —— 前端不得自己把 markdown 渲染成 HTML。 */
export interface UnconfirmedComment {
  readonly seq: number;
  readonly body: string;
}

export interface ProjectedIssue<I extends ReconcileIssue = ReconcileIssue> {
  readonly id: string;
  /**
   * 畫面上該顯示的整張 issue：快照 + 樂觀覆蓋。
   *
   * **`descriptionHtml` 與 `comments[].bodyHtml`（若呼叫端的 `I` 有這兩個欄位）
   * 一律原封不動**：那兩個字串是 server 用「先逸出、再構造」產出的，前端沒有
   * （也不該有）第二份 markdown 渲染器。描述有樂觀值時 `description` 是新原文
   * 而 `descriptionHtml` 還是舊的 —— 呼叫端用 `optimistic` 判斷該顯示哪一個。
   */
  readonly shown: I;
  /** 伺服器上次告訴我們的整張 issue。 */
  readonly serverKnown: I;
  /** 上面哪些欄位是樂觀值。空集合表示畫面上這張就是伺服器上那張。 */
  readonly optimistic: ReadonlySet<OptimisticField>;
  /**
   * 飛行中的留言。**接在 `shown.comments` 尾端顯示，不併進去、不排序** ——
   * `shown.comments` 已由 core 的 `reduce()` 以 (t, actor, id) 全序產出，在前端
   * 放第二個比較器正是 commit 463343d 那個 bug 的成因。
   */
  readonly unconfirmed: readonly UnconfirmedComment[];
  readonly held: boolean;
}

export function initialClient<I extends ReconcileIssue>(snapshot: readonly I[]): ClientState<I> {
  return { snapshot, pending: [], drag: null, deferred: null, seq: 0, unmatchedAck: null };
}

export function clientReduce<I extends ReconcileIssue>(
  state: ClientState<I>,
  action: ClientAction<I>,
): ClientState<I> {
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
        pending: [...ended.pending, write(seq, action.issueId, { status: action.to })],
      };
    }

    case 'EDIT': {
      // Drawer 的樂觀編輯。與 DROP 同一條路：畫面先動，POST 之後才送 —— 差別
      // 只在拖曳鎖，鍵盤與選單的編輯沒有指標按著任何東西。
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        pending: [...state.pending, write(seq, action.issueId, action.change)],
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
      // 伺服器回應，帶著寫入當下摺疊出來的**整張** issue。那不是永恆真理：在這
      // 個回應飛回來的路上，別人的 op 還是可能後來居上，所以它是一份新快照而不
      // 是「把樂觀值扶正」——下一次輪詢仍然可以蓋過它。
      // 這一筆可能已經不在飛行中了（已回滾、或回應重複送達）——那就什麼都不做。
      const p = state.pending.find((x) => x.seq === action.seq);
      if (p === undefined) return state;
      // 這張 issue 不在快照裡時（有人給 /api/board 加了過濾、或這張已經被濾掉），
      // `snapshot.map` 什麼都對不上，伺服器剛送回來的那張就被丟掉了。三個可能的
      // 形狀，這裡選第三個：
      //   1. append 進快照 —— 不行。成員資格是 server 的決定，client 憑一則寫入
      //      回應就把一張 issue 塞進快照，是另一個 bug 而不是修好這一個。
      //   2. throw —— 不行。過濾一旦存在，這就是**正常**情況（把卡片移出過濾條件
      //      就會發生），為正常情況炸掉整塊看板顯然過頭。
      //   3. payload 照樣丟掉，但**把落空這件事記在 state 上**。呼叫端讀到它就知道
      //      「手上這份快照落後了」，正確的反應是重新輪詢一份 —— 決定權仍然留在
      //      server 手上。下一份快照套用時這個標記自動清掉（見 applySnapshot）。
      // pending 無論如何都要退場：伺服器已經回應過這筆寫入了，把它留在飛行中就是
      // 讓一個永遠不會再有下文的樂觀值掛在畫面上。
      const known = state.snapshot.some((i) => i.id === p.issueId);
      return {
        ...state,
        unmatchedAck: known ? state.unmatchedAck : { seq: action.seq, issueId: p.issueId },
        // 同一張 issue 上，連同 `seq <= action.seq` 的一起退場，不只是 action.seq
        // 那一筆：兩次寫入的回應在網路上換了位置時，只拿掉 seq2 會讓 seq1 留在
        // pending 上，而它帶的是已經被 seq2 取代的舊值 —— 卡片當場閃回舊欄位。
        // 限縮在同一張 issue 是必要的：seq 是整塊 board 共用的流水號，掃掉別張
        // issue 還在飛的變更，就是把同一個閃動搬到另一張卡片上。
        pending: state.pending.filter((x) => x.seq > action.seq || x.issueId !== p.issueId),
        snapshot: state.snapshot.map((i) => (i.id === p.issueId ? action.issue : i)),
      };
    }

    case 'FAIL':
      // 傳輸失敗（server 收掉了、board 目錄不見了）。這是唯一真正要回滾的情況：
      // 樂觀值退場，快照不動，卡片回到伺服器上的值。
      //
      // **FAIL 刻意不跟著 ACK 掃 `seq <= action.seq`。** 兩者說的不是同一件事：
      // ACK 說「伺服器已經把這張 issue 摺疊到這個版本了」，所以更早的樂觀值都
      // 過期了；FAIL 只說「這一個 POST 沒送到」，它對更早那些寫入一無所知 ——
      // 那些可能已經送達、正等著自己的回應。跟著掃就是把好好的寫入一起回滾掉。
      return { ...state, pending: state.pending.filter((x) => x.seq !== action.seq) };

    case 'POLL':
      // 拖曳期間絕不改動畫面。押著，等放開再說 —— 代價是最多延遲一次輪詢間隔。
      if (state.drag !== null) return { ...state, deferred: action.issues };
      return applySnapshot(state, action.issues);
  }
}

/**
 * 樂觀的 label 集合。label 是 add-wins OR-Set（CONTEXT.md），不是 LWW 的一格值
 * —— 所以是集合運算：留下沒被點名移除的，把新增的接在尾端。
 *
 * 接在尾端與 core 的 `reduce()` 一致：呈現順序是各值第一個存活 add tag 在全序
 * 中的位置，而新增的那筆 t 最大，因此落在最後。同一份 Change 裡同時 add 與
 * remove 同一個 label 時 add 贏，這也是 add-wins 的意思。
 */
function applyLabels(
  labels: readonly string[],
  edit: NonNullable<ReconcileChange['labels']>,
): readonly string[] {
  const removed = new Set(edit.remove ?? []);
  const kept = labels.filter((l) => !removed.has(l));
  return [...kept, ...(edit.add ?? []).filter((l) => !kept.includes(l))];
}

function write(seq: number, issueId: string, change: ReconcileChange): PendingWrite {
  return { seq, issueId, change, landed: false };
}

/** 放開指標：拖曳鎖解除，押後的快照補上。 */
function endDrag<I extends ReconcileIssue>(state: ClientState<I>): ClientState<I> {
  const released: ClientState<I> = { ...state, drag: null, deferred: null };
  return state.deferred === null ? released : applySnapshot(released, state.deferred);
}

/**
 * 套用一份新快照。關鍵規則：還在飛的樂觀變更蓋過快照 —— 那條覆蓋由 project()
 * 負責，因此這裡只換 snapshot、絕不動 pending。
 *
 * `unmatchedAck` 在這裡歸零，而不是在 POLL 那個 case：拖曳中的快照是被押後的，
 * 還沒套用，那時清掉就是在說一句還沒成真的話。清的時機正是「答覆它的那份快照
 * 真的上場了」—— 不管它來自 POLL 還是放開時補上的那份。
 */
function applySnapshot<I extends ReconcileIssue>(
  state: ClientState<I>,
  issues: readonly I[],
): ClientState<I> {
  return { ...state, snapshot: issues, unmatchedAck: null };
}

/** 使用者實際看到的東西：快照 + 樂觀覆蓋 + 拖曳鎖。 */
export function project<I extends ReconcileIssue>(
  state: ClientState<I>,
): readonly ProjectedIssue<I>[] {
  return state.snapshot.map((issue) => {
    const optimistic = new Set<OptimisticField>();
    const unconfirmed: UnconfirmedComment[] = [];
    let shown = issue;

    // pending 依 seq 遞增排列（append 而來），照著套就是「同一欄位只認最後一
    // 筆」——較早的那筆已被取代，它之後回來也翻不了案。逐欄位而不是逐筆覆蓋：
    // 一次改標題不該把同時在飛的那次搬欄位擦掉。
    for (const p of state.pending) {
      if (p.issueId !== issue.id) continue;
      if (p.change.title !== undefined) {
        shown = { ...shown, title: p.change.title };
        optimistic.add('title');
      }
      if (p.change.description !== undefined) {
        shown = { ...shown, description: p.change.description };
        optimistic.add('description');
      }
      if (p.change.status !== undefined) {
        shown = { ...shown, status: p.change.status };
        optimistic.add('status');
      }
      if (p.change.archived !== undefined) {
        shown = { ...shown, archived: p.change.archived };
        optimistic.add('archived');
      }
      if (p.change.labels !== undefined) {
        shown = { ...shown, labels: applyLabels(shown.labels, p.change.labels) };
        optimistic.add('labels');
      }
      // 留言是附加，不是覆蓋 —— 它沒有蓋掉任何東西，所以不進 optimistic，而是
      // 單獨交出去讓呼叫端接在 shown.comments 尾端。**不得併進那個陣列**：它已
      // 由 core 以 (t, actor, id) 全序排好，而在飛的這則還沒有 t。
      if (p.change.comment !== undefined) unconfirmed.push({ seq: p.seq, body: p.change.comment });
    }

    return {
      id: issue.id,
      shown,
      serverKnown: issue,
      optimistic,
      unconfirmed,
      held: state.drag?.issueId === issue.id,
    };
  });
}
