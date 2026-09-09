import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Board } from '@/board/Board';
import { IssueDrawer } from '@/drawer/IssueDrawer';
import type { DrawerChange } from '@/drawer/changes';
import { fetchBoard, postChange } from '@/api';
import type { IssueView, Status } from '@/api';
import { clientReduce, initialClient, project } from '@/reconcile';
import type { ClientAction, ClientState } from '@/reconcile';
import { startPolling } from '@/poll';

type Client = ClientState<IssueView>;

/**
 * SPA 的殼裡唯一的組件 —— composition root。
 *
 * 它持有的東西剛好是「不屬於任何一個目錄」的那些：**一份**調和 state
 * （`reconcile.ts`）、**一份**寫入面（`api.ts` 的 `postChange`）、輪詢迴圈，
 * 以及 drawer 開在哪一張。看板（`board/`）與 drawer（`drawer/`）都不持有
 * 樂觀狀態：兩份樂觀模型會分歧，而分歧的樣子是「同一張 Issue 看板上停在 A，
 * drawer 說它在 B」。
 *
 * **可判定的邏輯不留在這個檔案。** 調和規則在 `reconcile.ts`，Status 與車道的
 * 判斷在 `board/lanes.ts` 與 `drawer/changes.ts`，連線中斷的門檻在 `poll.ts`
 * 的 `connectionReduce` —— 那些都有測試。這裡只剩接線，接線沒有自動化測試
 * （spec.md 的測試策略：不引入 jsdom）。
 */
export function App(): React.JSX.Element {
  const [state, setState] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // 開場那份快照的 hash。設定它同時也是「第一份快照到了」的訊號 —— 輪詢的
  // effect 以它為 dep，因此不可能在快照之前就開始跑。
  const [hash, setHash] = useState<string | null>(null);

  /**
   * 調和 state 的權威副本。
   *
   * **為什麼是 ref 而不是 `useReducer`。** `clientReduce` 的 `DROP` / `EDIT`
   * 自己配 `seq`（`state.seq + 1`），而呼叫端非知道那個號碼不可 —— 之後的
   * `ACK` / `FAIL` 就是靠它認回這一筆。`useReducer` 的 `dispatch` 不回傳東西，
   * 所以只剩兩條路：呼叫端自己養一個平行的計數器去「猜」reducer 會配到幾號，
   * 或是把摺疊搬到自己手上、直接讀結果。
   *
   * 選後者，因為前者的失敗是靜默的：計數器一旦跟 reducer 差一號，`ACK` 找不到
   * 那筆 pending 就**原樣回傳**（`reconcile.ts` 的 ACK：`p === undefined` 時
   * 什麼都不做），樂觀值於是永遠留在畫面上，而且不會有任何錯誤訊息。
   * 下面 `apply()` 回傳的是 `clientReduce` 實際算出來的 state，`next.seq` 因此
   * 是**事實**而不是預測，兩邊不可能對不上。
   *
   * `useState` 仍然在，但它只負責觸發重繪：塞進去的就是 ref 裡那個同一個物件，
   * 兩者不可能分岔。
   */
  const stateRef = useRef<Client | null>(null);

  /** 唯一改動調和 state 的入口。回傳新的 state，快照還沒到就回傳 null。 */
  const apply = useCallback((action: ClientAction<IssueView>): Client | null => {
    const current = stateRef.current;
    if (current === null) return null;
    const next = clientReduce(current, action);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  /**
   * 一次寫入：畫面先動（`action` 交給 reducer），`POST` 隨後，回應把伺服器
   * 摺疊出來的整張 issue 蓋回快照（`ACK`），送不到就退場（`FAIL`）。
   *
   * 刻意不 abort：drawer 關掉、那張 Issue 被輪詢挪走，都不代表使用者要收回這次寫入，
   * 而 append-only 之下也收不回來。讓它飛完。
   */
  const send = useCallback(
    (id: string, change: DrawerChange, action: ClientAction<IssueView>): void => {
      const next = apply(action);
      if (next === null) return;
      // reducer 剛剛配給這一筆的號碼 —— 讀的是結果，不是猜的。
      const seq = next.seq;
      postChange(id, change).then(
        (issue) => {
          apply({ type: 'ACK', seq, issue });
          setFailed(null);
        },
        (err: unknown) => {
          apply({ type: 'FAIL', seq });
          setFailed(err instanceof Error ? err.message : String(err));
        },
      );
    },
    [apply],
  );

  // 開場那一次全量快照。輪詢在它之後才開始 —— 見 `hash`。
  useEffect(() => {
    const abort = new AbortController();
    fetchBoard(abort.signal).then(
      (snapshot) => {
        if (abort.signal.aborted) return;
        const initial = initialClient(snapshot.issues);
        stateRef.current = initial;
        setState(initial);
        setHash(snapshot.hash);
      },
      (err: unknown) => {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => abort.abort();
  }, []);

  // 輪詢。**dep 是 hash**：第一份快照到達之前它是 null，迴圈因此不會啟動，
  // 第一次 tick 也就不會白抓一次整塊 board（`startPolling` 拿著開場的 hash 去
  // 比對）。之後 hash 不再變 —— 迴圈自己記著最新的那個，不回報上來。
  useEffect(() => {
    if (hash === null) return;
    return startPolling({ hash, dispatch: apply, onConnectionChange: setDisconnected });
  }, [hash, apply]);

  const projected = useMemo(() => (state === null ? [] : project(state)), [state]);

  const onMove = useCallback(
    (id: string, status: Status) => {
      // DROP 本身就結束拖曳（`reconcile.ts`），所以移動時不再補一次 RELEASE。
      send(id, { status }, { type: 'DROP', issueId: id, to: status });
    },
    [send],
  );

  const onGrab = useCallback((id: string) => void apply({ type: 'GRAB', issueId: id }), [apply]);
  const onRelease = useCallback(() => void apply({ type: 'RELEASE' }), [apply]);

  const onSubmit = useCallback(
    (id: string, change: DrawerChange | undefined): boolean => {
      // `undefined` = `changes.ts` 判定這一下沒有東西要送。回 false 讓呼叫端
      // 知道不要清空輸入框。
      if (change === undefined) return false;
      send(id, change, { type: 'EDIT', issueId: id, change });
      return true;
    },
    [send],
  );

  if (error !== null) {
    return (
      <main className="p-4">
        <p className="text-destructive text-sm">讀不到 board：{error}</p>
      </main>
    );
  }

  if (state === null) {
    return (
      <main className="p-4">
        <p className="text-muted-foreground text-sm">載入中…</p>
      </main>
    );
  }

  const selected = projected.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <Board
        // 看板拿的是 `project()` 的產物而不是原始快照 —— 飛行中的變更蓋過快照，
        // 否則輪詢帶回舊快照時那張 Issue 會彈回去再彈回來（reconcile 的第一條規則）。
        // `BoardProps` 收的是 `IssueView[]`，所以這裡交出每一張的 `shown`。
        issues={projected.map((p) => p.shown)}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={onMove}
        onGrab={onGrab}
        onRelease={onRelease}
      />
      <IssueDrawer issue={selected} onClose={() => setSelectedId(null)} onSubmit={onSubmit} />
      <StatusBanner
        disconnected={disconnected}
        failed={failed}
        onDismiss={() => setFailed(null)}
      />
    </>
  );
}

/**
 * 「你的變更正在掉」這件事，畫面必須說出來（ADR-0007）。
 *
 * 放在最上層而不是 drawer 裡：拖曳失敗時 drawer 可能根本沒開著，而失敗的
 * 拖曳看起來就只是那張 Issue 自己彈回去 —— 那是最容易被讀成「我拖歪了」的一種失敗。
 *
 * 「中斷」蓋過「單次失敗」：伺服器不通的時候，每一筆寫入都會失敗，把最後
 * 那一筆的訊息貼在中斷橫幅旁邊只是噪音。
 *
 * 兩者的**收回方式不同**，因為兩者說的不是同一件事。「中斷」描述現在的狀態，
 * 所以由輪詢自己收回（伺服器答了就不再中斷）。失敗描述的是**已經發生過的一件
 * 事** —— 那筆寫入永遠不會補送（append-only 之下沒有重試佇列），伺服器回來也
 * 不會讓它變成沒發生。所以它不自動消失，由人按掉：下一次成功的寫入會清掉它，
 * 沒有下一次寫入時就留在那裡，等人讀到。
 */
function StatusBanner({
  disconnected,
  failed,
  onDismiss,
}: {
  readonly disconnected: boolean;
  readonly failed: string | null;
  readonly onDismiss: () => void;
}): React.JSX.Element | null {
  if (!disconnected && failed === null) return null;
  return (
    <div
      role="status"
      // dnd-kit 的拖曳播報有自己的 live region；這裡用 polite 才不會插隊。
      aria-live="polite"
      className="bg-destructive text-destructive-foreground fixed bottom-4 left-1/2 z-50 flex max-w-[min(36rem,90vw)] -translate-x-1/2 items-start gap-3 rounded-md px-3 py-2 text-sm shadow-lg"
    >
      {disconnected ? (
        <span>連線中斷 —— 伺服器沒有回應，現在做的變更送不出去。</span>
      ) : (
        <>
          <span>寫入沒送到，畫面已回到伺服器上的值：{failed}</span>
          <button type="button" className="shrink-0 underline" onClick={onDismiss}>
            知道了
          </button>
        </>
      )}
    </div>
  );
}
