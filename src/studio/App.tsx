import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Board } from '@/board/Board';
import { focusIssue } from '@/board/focus';
import { IssueDrawer } from '@/drawer/IssueDrawer';
import type { DrawerChange } from '@/drawer/changes';
import { fetchBoard, postChange } from '@/api';
import type { IssueView, Status } from '@/api';
import { clientReduce, initialClient, project } from '@/reconcile';
import type { ClientAction, ClientState } from '@/reconcile';
import { startPolling } from '@/poll';
import type { ConnectionFault } from '@/poll';

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
  // null = 連得上。非 null 時它同時是「中斷了」、「哪一種中斷」與「伺服器就這件
  // 事說了什麼」—— 三者是同一個事實，分成幾格遲早會出現「中斷但說不出話」或
  // 「掛著上一次中斷留下的訊息」這種狀態。
  const [fault, setFault] = useState<ConnectionFault | null>(null);
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
    return startPolling({ hash, dispatch: apply, onConnectionChange: setFault });
  }, [hash, apply]);

  /**
   * 落空的 ACK：伺服器確認了對某張 issue 的寫入，但它不在我們手上這份快照裡
   * （`reconcile.ts` 的 ACK）。**那句話說的是「這份快照落後了」**，不是
   * 「這張 issue 不存在」—— 所以正確的反應是重新問一次 server，而不是自己把
   * 那張 issue 補進快照。成員資格是 server 的決定，client 憑一則寫入回應就
   * 塞一張進來，是另一個 bug 而不是修好這一個。
   *
   * dep 是那個標記本身（reducer 每次落空都給一個新物件），所以同一則不會抓兩次；
   * 抓回來的快照一經套用，`applySnapshot` 就把標記清成 null。拖曳中的快照會被
   * 押後、標記因此還留著，那也正確：放開時押後的那份會補上，一併清掉。
   *
   * 抓不到就不重試 —— 輪詢迴圈本來就每 2 秒問一次 hash，它會補上這一趟。
   */
  const unmatchedAck = state?.unmatchedAck ?? null;
  useEffect(() => {
    if (unmatchedAck === null) return;
    const abort = new AbortController();
    fetchBoard(abort.signal).then(
      (snapshot) => {
        if (!abort.signal.aborted) apply({ type: 'POLL', issues: snapshot.issues });
      },
      () => {
        // 連線狀態由輪詢迴圈負責報，這裡不重複講一次。
      },
    );
    return () => abort.abort();
  }, [unmatchedAck, apply]);

  const projected = useMemo(() => (state === null ? [] : project(state)), [state]);

  const onMove = useCallback(
    (id: string, status: Status) => {
      // DROP 本身就結束拖曳（`reconcile.ts`），所以移動時不再補一次 RELEASE。
      send(id, { status }, { type: 'DROP', issueId: id, to: status });
    },
    [send],
  );

  /**
   * 拖進 `blocked`：status 與原因是**同一份 Change**，因此是同一次 `POST`，
   * 而 `board.apply()` 對一份 Change 只 append 一次 —— 磁碟上不會出現
   * 「已經 blocked 但還沒留言」的那一刻（ADR-0003）。
   *
   * **為什麼是 `RELEASE` + `EDIT` 而不是 `DROP`。** `DROP` 只帶得動一個 `to`
   * 字串，reducer 用它組出來的樂觀變更就只有 `{ status }` —— 那則留言會在樂觀
   * 這一側被丟掉，於是閘門關掉的瞬間，畫面上那張 Issue 已經是 blocked、卻看不到
   * 使用者一秒前才打進去的原因，要等 ACK 回來才補上。`DROP` 做的兩件事拆開來
   * 就是這兩個 action：`RELEASE` 結束拖曳（閘門開著的期間看板刻意押著沒放），
   * `EDIT` 掛上完整的那份 Change。drawer 那條路徑用的也是 `EDIT`，兩邊從此
   * 連樂觀模型上的形狀都一樣。
   */
  const onBlock = useCallback(
    (id: string, change: DrawerChange) => {
      apply({ type: 'RELEASE' });
      send(id, change, { type: 'EDIT', issueId: id, change });
    },
    [apply, send],
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
        //
        // **整份投影交出去，不再 `.map(p => p.shown)`。** 攤平會把 `optimistic`
        // 與 `held` 丟在這一行，而那兩格正是「這張還沒落地」「這張正被抓著」的
        // 唯一來源 —— 看板拿不到就只能畫得跟已落地的一模一樣。drawer 收的一直
        // 是投影（`IssueDrawerProps`），兩邊從此是同一個形狀。
        issues={projected}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={onMove}
        onBlock={onBlock}
        onGrab={onGrab}
        onRelease={onRelease}
      />
      <IssueDrawer
        issue={selected}
        onClose={() => setSelectedId(null)}
        onSubmit={onSubmit}
        // 關掉之後焦點回到那張 Issue 的卡片。Radix 對受控 Dialog 的預設是把
        // 焦點交給不存在的 Trigger，等於交給 <body> —— 見 `board/focus.ts`。
        onCloseFocus={focusIssue}
      />
      <StatusBanner fault={fault} failed={failed} onDismiss={() => setFailed(null)} />
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
 *
 * **中斷有三句話，因為下一步不同**（票 02）。伺服器沒有回應時該去看跑
 * `nook studio` 的那個終端機還在不在；伺服器回了錯誤時它明明活著，去查網路
 * 是白費工；答了但回的不是 JSON，代表那個位址上的東西根本不是 nook studio。
 * 哪一種由 `poll.ts` 的 `connectionFault` 決定，這裡只負責把它說出來。
 *
 * **伺服器自己說的話優先於這裡寫的任何一句。** `handler.ts` 的 `serverError`
 * 刻意送一則可行動的訊息（「不是一個 Nook board：/path…」），它比「最常見的
 * 原因是……」精確 —— 後者是猜，而猜的時候使用者手上明明就有正確答案。沒有話
 * 可引用時（`detail` 是 null）才退回那句猜測，因為那時它是現場最好的線索。
 */
function StatusBanner({
  fault,
  failed,
  onDismiss,
}: {
  readonly fault: ConnectionFault | null;
  readonly failed: string | null;
  readonly onDismiss: () => void;
}): React.JSX.Element | null {
  if (fault === null && failed === null) return null;
  return (
    <div
      role="status"
      // dnd-kit 的拖曳播報有自己的 live region；這裡用 polite 才不會插隊。
      aria-live="polite"
      className="bg-destructive text-destructive-foreground fixed bottom-4 left-1/2 z-50 flex max-w-[min(36rem,90vw)] -translate-x-1/2 items-start gap-3 rounded-md px-3 py-2 text-sm shadow-lg"
    >
      {fault?.kind === 'failed' ? (
        <span>
          連線中斷 —— 伺服器沒有回應，現在做的變更送不出去。跑 <code>nook studio</code>{' '}
          的那個終端機還開著嗎？
        </span>
      ) : fault?.kind === 'server-error' ? (
        <span>
          伺服器回了錯誤 —— 它還活著，所以不是網路的問題，但現在做的變更一樣送不出去。
          {fault.detail === null ? (
            <>
              最常見的原因是 board 目錄（<code>.issues/</code>）被移走或改名了；確認它還在原處，
              再重開 <code>nook studio</code>。
            </>
          ) : (
            <>
              它說：「{fault.detail}」修好之後重開 <code>nook studio</code>。
            </>
          )}
        </span>
      ) : fault?.kind === 'malformed' ? (
        <span>
          伺服器答了，但回的不是 nook 的資料 —— 它活著，所以不是網路的問題，
          可是這個位址上跑的東西不是 <code>nook studio</code>（前面擋著別的服務，
          或那個 port 換人跑了）。確認它還在同一個 port 上，再重新整理這一頁。
        </span>
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
