import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Board } from '@/board/Board';
import { BoardSkeleton } from '@/board/BoardSkeleton';
import { focusIssue } from '@/board/focus';
import { IssueDrawer } from '@/drawer/IssueDrawer';
import type { DrawerChange } from '@/drawer/changes';
import { createIssue, fetchBoard, fetchBoardInfo, fetchHash, postChange } from '@/api';
import type { BoardInfo, IssueView, Status } from '@/api';
import { clientReduce, initialClient, project } from '@/reconcile';
import type { ClientAction, ClientState } from '@/reconcile';
import { classifyFailure, startPolling } from '@/poll';
import type { ConnectionFault } from '@/poll';

type Client = ClientState<IssueView>;

/**
 * SPA 的殼裡唯一的組件 —— composition root。
 *
 * 它持有的東西剛好是「不屬於任何一個目錄」的那些：**一份**調和 state
 * （`reconcile.ts`）、**一份**寫入面（`api.ts` 的 `postChange` 與 `createIssue`）、輪詢迴圈，
 * 以及 drawer 開在哪一張。看板（`board/`）與 drawer（`drawer/`）都不持有
 * 樂觀狀態：兩份樂觀模型會分歧，而分歧的樣子是「同一張 Issue 看板上停在 A，
 * drawer 說它在 B」。
 *
 * **可判定的邏輯不留在這個檔案。** 調和規則在 `reconcile.ts`，八個 Status 那份
 * 清單與分組在 `statuses.ts`，一次編輯送不送得出去在 `drawer/changes.ts`，
 * 連線中斷的門檻在 `poll.ts`
 * 的 `connectionReduce` —— 那些都有測試。這裡只剩接線，接線沒有自動化測試
 * （spec.md 的測試策略：不引入 jsdom）。
 *
 * **從 `App.tsx` 原樣搬過來（票 01），邏輯一行不改** —— 唯一的差別是這個
 * 匯出的名字（`App` → `IssueApp`），因為 `App.tsx` 現在是讀 `prefs.ts` 視圖
 * 偏好、依偏好只掛載一個 composition root 的薄殼（同 CLI 那批
 * `dispatchIssue` 的搬遷手法）。
 */
export function IssueApp(): React.JSX.Element {
  const [state, setState] = useState<Client | null>(null);
  /**
   * 開場那份快照抓不到 —— 這時候整個畫面沒有東西可以畫。
   *
   * **存的是那次失敗本身而不是 `err.message`**，走的是輪詢那邊已經論證過的
   * 同一條路（`poll.ts` 的 `ConnectionFault`）：`handler.ts` 的 `serverError`
   * 刻意在 body 裡送一則可行動的訊息（「不是一個 Nook board：/path…」），而
   * `HttpError.message` 只有 `/api/board 回了 500`——**那句可行動的話掛在
   * `detail` 上**，存 message 等於在讀的人最需要它的時候把它丟掉。
   */
  const [error, setError] = useState<ConnectionFault | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // null = 連得上。非 null 時它同時是「中斷了」、「哪一種中斷」與「伺服器就這件
  // 事說了什麼」—— 三者是同一個事實，分成幾格遲早會出現「中斷但說不出話」或
  // 「掛著上一次中斷留下的訊息」這種狀態。
  const [fault, setFault] = useState<ConnectionFault | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // 開場那份快照的 hash。設定它同時也是「第一份快照到了」的訊號 —— 輪詢的
  // effect 以它為 dep，因此不可能在快照之前就開始跑。
  const [hash, setHash] = useState<string | null>(null);
  // 這塊 board 在磁碟上的位置、分支與 Actor。header 的那一行說明文字，**只此
  // 一格**，抓不到就一直是 null。
  const [info, setInfo] = useState<BoardInfo | null>(null);

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
        // 分類的規則只有一份，而且有測試（`poll.ts` 的 `classifyFailure`）——
        // 「伺服器到底有沒有回應、它說了什麼」在開場與在輪詢裡是同一個問題，
        // 在這裡自己 `instanceof` 一次就是第二份定義，而兩份遲早分岔。
        if (!abort.signal.aborted) setError(classifyFailure(err));
      },
    );
    return () => abort.abort();
  }, []);

  /**
   * board 的位置、分支與 Actor —— **開場抓一次，永遠不進輪詢迴圈**。
   *
   * 那個端點會 spawn 一個 `git rev-parse`（`health.ts`），掛進每 2 秒一次的迴圈
   * 等於每 2 秒多一個子行程，換來的是一個幾乎不會變的答案。它與 `/api/board`
   * 分開就是為了這件事（`handler.ts` 的 `boardInfo`）。
   *
   * **失敗不設 `error`。** 上面那個 `fetchBoard` 失敗時整個畫面換成一句「讀不到
   * board」，因為那時候真的沒有東西可以畫；這裡失敗只是 header 少一行說明文字，
   * 把整塊看板換掉是把一個裝飾當成前提。連線真的斷了的時候，輪詢迴圈會在兩秒內
   * 用底部橫幅說出來 —— 那句話不必在這裡再講一次。
   */
  useEffect(() => {
    const abort = new AbortController();
    fetchBoardInfo(abort.signal).then(
      (fetched) => {
        if (!abort.signal.aborted) setInfo(fetched);
      },
      () => {
        // 見上：header 少一行，看板照跑。
      },
    );
    return () => abort.abort();
  }, []);

  // 輪詢。**dep 是 hash**：第一份快照到達之前它是 null，迴圈因此不會啟動，
  // 第一次 tick 也就不會白抓一次整塊 board（`startPolling` 拿著開場的 hash 去
  // 比對）。之後 hash 不再變 —— 迴圈自己記著最新的那個，不回報上來。
  useEffect(() => {
    if (hash === null) return;
    return startPolling({
      hash,
      fetchHash,
      fetchSnapshot: fetchBoard,
      // 快照變成一個 action —— reducer 判斷該不該動畫面，這裡只是搬運（票 02）。
      // 回傳型別得標成 `ClientAction<IssueView>`：物件字面值裡的 `type: 'POLL'`
      // 不加註解會被推成 `string`，`A` 就跟著 `dispatch`（也就是 `apply`）期待
      // 的聯集型別對不上。
      toAction: (snapshot): ClientAction<IssueView> => ({ type: 'POLL', issues: snapshot.issues }),
      dispatch: apply,
      onConnectionChange: setFault,
    });
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

  /**
   * 開著的那張從快照上消失了 —— 放掉它。
   *
   * 唯一會發生這件事的路徑是刪除：ACK 帶回 `deleted: true` 時 `reconcile.ts`
   * 把那張移出快照（ADR-0009），於是下面的 `selected` 變成 null、drawer 自己
   * 關上。**封存不會走到這裡** —— `/api/board` 送的是 `all: true`，被封存的那張
   * 仍然在快照裡，只是看板自己把它藏起來，所以封存之後 drawer 照樣開著，
   * 那顆「取消封存」按得到。
   *
   * 光靠 `selected` 變 null 已經關得掉 drawer，這個 effect 要修的是**留在
   * `selectedId` 裡的那個死 id**：`nook set <ref> deleted false` 復原之後，
   * 輪詢會把那張帶回快照，而一個還記著它的 `selectedId` 會讓 drawer 在沒有人
   * 碰它的情況下自己彈開。
   */
  useEffect(() => {
    if (selectedId !== null && !projected.some((p) => p.id === selectedId)) setSelectedId(null);
  }, [projected, selectedId]);

  const onMove = useCallback(
    (id: string, status: Status) => {
      // DROP 本身就結束拖曳（`reconcile.ts`），所以移動時不再補一次 RELEASE。
      send(id, { status }, { type: 'DROP', issueId: id, to: status });
    },
    [send],
  );

  /**
   * 一次新增。**與 `send` 不同，這裡沒有樂觀的那一半** —— 新 Issue 的 ULID 由
   * server 產生，client 手上沒有 id 可以先畫（`reconcile.ts` 的 `CREATED`）。
   * 所以順序是反過來的：先 `POST`，回應到了才把那張接進快照。
   *
   * 失敗走的是同一條 `failed` 橫幅（`postChange` 那條路徑同款），另外回一個
   * `false` 給表單 —— 那句剛打好的標題是使用者手上唯一的一份，沒建成就不該
   * 被清掉。
   */
  const onCreate = useCallback(
    (title: string, status: Status | undefined): Promise<boolean> =>
      createIssue(title, status).then(
        (issue) => {
          apply({ type: 'CREATED', issue });
          setFailed(null);
          return true;
        },
        (err: unknown) => {
          setFailed(err instanceof Error ? err.message : String(err));
          return false;
        },
      ),
    [apply],
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

  if (error !== null) return <LoadFailure fault={error} />;

  // 第一份快照還沒到。**骨架而不是一行「載入中…」** —— 版面不跳是它唯一的
  // 理由（`board/BoardSkeleton.tsx`）。
  if (state === null) return <BoardSkeleton />;

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
        // 還沒抓到就是 null —— header 自己會少畫那一行，看板不等它。
        info={info}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={onMove}
        onGrab={onGrab}
        onRelease={onRelease}
        onCreate={onCreate}
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
 * 開場那份快照抓不到 —— 整個畫面上沒有東西可以畫的那一種失敗。
 *
 * **伺服器自己說的話優先於這裡寫的任何一句**，同 `StatusBanner` 已經論證過的
 * 模型：`handler.ts` 的 `serverError` 送的是「不是一個 Nook board：/path…」
 * 這種可行動的訊息，它比這裡猜的「最常見的原因是……」精確，而猜的時候使用者
 * 手上明明就有正確答案。沒有話可引用時才退回猜測，因為那時它是現場最好的線索。
 *
 * **下一步要講。** 一句「讀不到 board」把人留在原地：這個畫面最常見的來源是
 * 在一個沒有 `.issues/` 的目錄底下（或 board 目錄被移走之後）開 studio，而那
 * 件事的解法就是一行 `nook init`，而且**得在 repo 根目錄跑**（AGENT.md：它在
 * 子目錄會拒絕）。`malformed` 那一種不講這句 —— 那時 board 沒有問題，有問題的
 * 是這個 port 上跑的東西，叫人去 `nook init` 只會讓他改壞一塊好的 board。
 */
function LoadFailure({ fault }: { readonly fault: ConnectionFault }): React.JSX.Element {
  return (
    // `<main>` 加名字：這一頁上只有這一塊，而它是使用者現在唯一讀得到的東西。
    <main className="flex h-full items-center justify-center p-6" aria-label="Nook board">
      <div className="bg-card text-card-foreground max-w-lg rounded-lg border p-6 shadow-lg">
        <p className="text-destructive text-sm font-semibold">Cannot load board</p>

        <p className="mt-2 text-sm leading-relaxed">
          {fault.detail !== null ? (
            <>
              The server said: "<span className="font-mono">{fault.detail}</span>"
            </>
          ) : fault.kind === 'failed' ? (
            <>
              The server did not respond. Is the terminal running{' '}
              <code className="font-mono">nook studio</code> still open?
            </>
          ) : fault.kind === 'malformed' ? (
            <>
              The server answered, but not with nook's data — whatever is running at this address is
              not <code className="font-mono">nook studio</code> (something else is in front of it, or
              another process took over the port).
            </>
          ) : (
            <>The most common cause is that the board directory (<code className="font-mono">.issues/</code>) was moved or renamed.</>
          )}
        </p>

        {fault.kind !== 'malformed' && (
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Next: confirm <code className="font-mono">.issues/</code> is still where it was; if not,
            run{' '}
            <code className="text-foreground font-mono font-semibold">nook init</code>{' '}
            <strong className="font-medium">at the repo root</strong> (it refuses in a subdirectory).
            Once fixed, restart <code className="font-mono">nook studio</code>.
          </p>
        )}
      </div>
    </main>
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
          Disconnected — the server did not respond, so the change you just made was not sent. Is the
          terminal running <code>nook studio</code> still open?
        </span>
      ) : fault?.kind === 'server-error' ? (
        <span>
          The server returned an error — it is still alive, so this is not a network problem, but the
          change you just made was not sent either.{' '}
          {fault.detail === null ? (
            <>
              The most common cause is that the board directory (<code>.issues/</code>) was moved or
              renamed; confirm it is still there, then restart <code>nook studio</code>.
            </>
          ) : (
            <>
              It said: "{fault.detail}" Once fixed, restart <code>nook studio</code>.
            </>
          )}
        </span>
      ) : fault?.kind === 'malformed' ? (
        <span>
          The server answered, but not with nook's data — it is alive, so this is not a network
          problem, but whatever is running at this address is not <code>nook studio</code> (something
          else is in front of it, or another process took over the port). Confirm it is still on the
          same port, then reload this page.
        </span>
      ) : (
        <>
          <span>A write did not go through; the screen reverted to the server's value: {failed}</span>
          <button type="button" className="shrink-0 cursor-pointer underline" onClick={onDismiss}>
            Got it
          </button>
        </>
      )}
    </div>
  );
}
