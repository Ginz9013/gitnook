import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createDecision, fetchDecisionHash, fetchDecisions, postDecisionChange } from '@/api';
import type { DecisionView } from '@/api';
import {
  clientDecisionReduce,
  initialDecisionClient,
  projectDecisions,
} from '@/decisionReconcile';
import type { ClientDecisionAction, ClientDecisionState } from '@/decisionReconcile';
import { DecisionDrawer } from '@/decisionDrawer/DecisionDrawer';
import type { DecisionDrawerChange } from '@/decisionDrawer/decisionChanges';
import { DecisionList } from '@/decisions/DecisionList';
import { DecisionListHeader } from '@/decisions/DecisionListHeader';
import { DecisionListSkeleton } from '@/decisions/DecisionListSkeleton';
import { EmptyDecisions } from '@/decisions/EmptyDecisions';
import { filterByDisposition } from '@/decisions/filter';
import {
  CONNECTED,
  POLL_INTERVAL_MS,
  classifyFailure,
  connectionFault,
  connectionReduce,
  sameFault,
} from '@/poll';
import type { ConnectionFault, ConnectionState } from '@/poll';

type Client = ClientDecisionState<DecisionView>;

/**
 * Decisions 視圖的 composition root —— 鏡射 `IssueApp.tsx` 的節奏（一份調和
 * state 的權威副本、輪詢迴圈、連線中斷橫幅），但**沒有拖曳相關的任何東西**：
 * Decision 沒有看板（spec.md Non-goals）。
 *
 * **新增（`onCreate`）是票 02 落地的第一個寫入**；這一批接上第二個：`send`
 * （drawer 的 EDIT/ACK/FAIL 那一整條）——同 `IssueApp.tsx` 既有的「畫面先動、
 * POST 隨後、回應蓋回快照、送不到就退場」節奏，重用票 01 已完整實作的
 * `decisionReconcile.ts` 的 EDIT/ACK/FAIL action。`selectedId` 早在票 02 就
 * 接上 `DecisionList` 的 `onSelect`，這一批補上真的會讀它的 `DecisionDrawer`。
 *
 * **輪詢迴圈是這裡自己寫的一份小接線，不是呼叫 `poll.ts` 的 `startPolling`**——
 * 那個函式本身寫死了 Issue 的 `fetchHash`/`fetchBoard` 與 `ClientAction<IssueView>`
 * 的 `POLL` 動作，對 Decision 的 `fetchDecisionHash`/`fetchDecisions`（`SNAPSHOT`
 * 動作）沒有一個字對得上，而 `poll.ts` 本身是不得修改的檔案（write scope）。
 * 這裡重用的是 `poll.ts` 裡**真正泛型**的那幾件：連線狀態機
 * （`CONNECTED`/`connectionReduce`/`connectionFault`/`sameFault`）與失敗分類
 * （`classifyFailure`），三者都不知道 Issue 是什麼，同一套規則因此在兩個視圖
 * 上是同一份實作、同一份測試涵蓋（`test/studio/poll.test.ts`）。
 *
 * **這個檔案沒有自動化測試**（spec.md：React 組件不寫測試，接線本身沒有
 * 判斷 —— 有判斷的部分全部住在上面列的那些純函式裡）。
 */
export function DecisionApp(): React.JSX.Element {
  const [state, setState] = useState<Client | null>(null);
  const [error, setError] = useState<ConnectionFault | null>(null);
  const [fault, setFault] = useState<ConnectionFault | null>(null);
  // 「你剛才那次新增沒有送出去」——同 `IssueApp.tsx` 的 `failed`：描述的是已經
  // 發生過的一件事，不像 `fault` 那樣由輪詢自己收回，靠人按掉或下一次成功的
  // 寫入蓋過去。
  const [failed, setFailed] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stateRef = useRef<Client | null>(null);

  const apply = useCallback((action: ClientDecisionAction<DecisionView>): Client | null => {
    const current = stateRef.current;
    if (current === null) return null;
    const next = clientDecisionReduce(current, action);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  /**
   * 一次寫入：畫面先動（`action` 交給 reducer），`POST` 隨後，回應把伺服器
   * 摺疊出來的整筆 decision 蓋回快照（`ACK`），送不到就退場（`FAIL`）——
   * 同 `IssueApp.tsx` 的 `send`。
   *
   * 刻意不 abort：drawer 關掉、那一筆被輪詢挪走，都不代表使用者要收回這次
   * 寫入，而 append-only 之下也收不回來。讓它飛完。
   */
  const send = useCallback(
    (id: string, change: DecisionDrawerChange, action: ClientDecisionAction<DecisionView>): void => {
      const next = apply(action);
      if (next === null) return;
      // reducer 剛剛配給這一筆的號碼 —— 讀的是結果，不是猜的。
      const seq = next.seq;
      postDecisionChange(id, change).then(
        (decision) => {
          apply({ type: 'ACK', seq, decision });
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

  /**
   * drawer 一次編輯的入口。`undefined` = `decisionChanges.ts` 判定這一下沒有
   * 東西要送，回 false 讓呼叫端知道不要清空輸入框 —— 同 `IssueApp.tsx` 的
   * `onSubmit`。
   */
  const onSubmit = useCallback(
    (id: string, change: DecisionDrawerChange | undefined): boolean => {
      if (change === undefined) return false;
      send(id, change, { type: 'EDIT', decisionId: id, change });
      return true;
    },
    [send],
  );

  /**
   * 一次新增。**沒有樂觀的那一半** —— 新 Decision 的 ULID 由 server 產生，
   * client 手上沒有 id 可以先畫（`decisionReconcile.ts` 的 `CREATED`，票 01
   * 已完整實作，這裡只呼叫）。所以順序是先 `POST`，回應到了才把那筆接進快照。
   *
   * 失敗走既有的失敗橫幅（`DecisionStatusBanner` 的 `failed` 那一半，同
   * `IssueApp.tsx` 的樣式），另外回一個 `false` 給表單 —— 那句剛打好的標題是
   * 使用者手上唯一的一份，沒建成就不該被清掉。
   */
  const onCreate = useCallback(
    (title: string): Promise<boolean> =>
      createDecision(title).then(
        (decision) => {
          apply({ type: 'CREATED', decision });
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

  // 開場那一次全量快照。輪詢在它之後才開始 —— 見下面的 `hash`。
  useEffect(() => {
    const abort = new AbortController();
    fetchDecisions(abort.signal).then(
      (snapshot) => {
        if (abort.signal.aborted) return;
        const initial = initialDecisionClient(snapshot.decisions);
        stateRef.current = initial;
        setState(initial);
        setHash(snapshot.hash);
      },
      (err: unknown) => {
        if (!abort.signal.aborted) setError(classifyFailure(err));
      },
    );
    return () => abort.abort();
  }, []);

  // 輪詢。dep 是 hash —— 第一份快照到達之前它是 null，迴圈因此不會啟動。
  useEffect(() => {
    if (hash === null) return;

    const abort = new AbortController();
    let latest = hash;
    let connection: ConnectionState = CONNECTED;
    let busy = false;

    const record = (outcome: 'ok' | ConnectionFault): void => {
      const before = connectionFault(connection);
      connection = connectionReduce(connection, outcome);
      const now = connectionFault(connection);
      if (!sameFault(now, before)) setFault(now);
    };

    const tick = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const next = await fetchDecisionHash(abort.signal);
        if (next !== latest) {
          const snapshot = await fetchDecisions(abort.signal);
          latest = next;
          apply({ type: 'SNAPSHOT', decisions: snapshot.decisions });
        }
        record('ok');
      } catch (err) {
        if (!abort.signal.aborted) record(classifyFailure(err));
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [hash, apply]);

  const projected = useMemo(() => (state === null ? [] : projectDecisions(state)), [state]);
  // `filterByDisposition` 認的是頂層 `.disposition`（`decisions/filter.ts` 的
  // 測試簽章），而 `ProjectedDecision` 把它包在 `.shown` 裡 —— 對 `.shown` 那
  // 一份跑過濾，再拿篩出來的 id 挑回帶著 `optimistic` 的投影，而不是另外寫
  // 一份認得 `.shown.disposition` 的過濾器。
  const filteredIds = useMemo(
    () => new Set(filterByDisposition(projected.map((p) => p.shown), disposition).map((d) => d.id)),
    [projected, disposition],
  );
  const filtered = useMemo(() => projected.filter((p) => filteredIds.has(p.id)), [projected, filteredIds]);

  if (error !== null) return <DecisionLoadFailure fault={error} />;
  if (state === null) return <DecisionListSkeleton />;

  const selected = projected.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <main className="flex h-full flex-col" aria-label="Nook decisions">
        <DecisionListHeader
          disposition={disposition}
          onChangeDisposition={setDisposition}
          visibleCount={filtered.length}
          onCreate={onCreate}
        />
        {projected.length === 0 ? (
          <EmptyDecisions />
        ) : (
          <DecisionList decisions={filtered} onSelect={setSelectedId} />
        )}
        <DecisionStatusBanner fault={fault} failed={failed} onDismiss={() => setFailed(null)} />
      </main>
      <DecisionDrawer decision={selected} onClose={() => setSelectedId(null)} onSubmit={onSubmit} />
    </>
  );
}

/** 開場那份快照抓不到 —— 同 `IssueApp.tsx` 的 `LoadFailure`，但講的是 Decision Log。 */
function DecisionLoadFailure({ fault }: { readonly fault: ConnectionFault }): React.JSX.Element {
  return (
    <main className="flex h-full items-center justify-center p-6" aria-label="Nook decisions">
      <div className="bg-card text-card-foreground max-w-lg rounded-lg border p-6 shadow-lg">
        <p className="text-destructive text-sm font-semibold">Cannot load decisions</p>
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
              not <code className="font-mono">nook studio</code>.
            </>
          ) : (
            <>
              The most common cause is that the decision log directory (
              <code className="font-mono">.decisions/</code>) was moved or renamed.
            </>
          )}
        </p>
      </div>
    </main>
  );
}

/**
 * 連線中斷橫幅 + 寫入失敗橫幅 —— 同 `IssueApp.tsx` 的 `StatusBanner`。
 * 「中斷」蓋過「單次失敗」（同一套理由：伺服器不通時每一筆寫入都會失敗，
 * 把最後那一筆的訊息貼在中斷橫幅旁邊只是噪音），兩者收回方式不同：
 * `fault` 由輪詢自己收回，`failed` 描述已經發生過的一件事，由人按掉，或下一次
 * 成功的新增蓋過去。
 */
function DecisionStatusBanner({
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
      aria-live="polite"
      className="bg-destructive text-destructive-foreground fixed bottom-4 left-1/2 z-50 flex max-w-[min(36rem,90vw)] -translate-x-1/2 items-start gap-3 rounded-md px-3 py-2 text-sm shadow-lg"
    >
      {fault?.kind === 'failed' ? (
        <span>
          Disconnected — the server did not respond. Is the terminal running{' '}
          <code>nook studio</code> still open?
        </span>
      ) : fault?.kind === 'server-error' ? (
        <span>
          The server returned an error — it is still alive, so this is not a network problem.{' '}
          {fault.detail === null ? (
            <>
              The most common cause is that the decision log directory (<code>.decisions/</code>) was
              moved or renamed.
            </>
          ) : (
            <>It said: "{fault.detail}"</>
          )}
        </span>
      ) : fault?.kind === 'malformed' ? (
        <span>
          The server answered, but not with nook's data — whatever is running at this address is not{' '}
          <code>nook studio</code>.
        </span>
      ) : (
        <>
          <span>A write did not go through: {failed}</span>
          <button type="button" className="shrink-0 cursor-pointer underline" onClick={onDismiss}>
            Got it
          </button>
        </>
      )}
    </div>
  );
}
