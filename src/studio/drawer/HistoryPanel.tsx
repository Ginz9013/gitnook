import { useEffect, useState } from 'react';
import { ChevronRightIcon } from 'lucide-react';

import { historyRows } from './history';
import type { HistoryRow, HistoryWrite } from './history';

/**
 * 這一張 Issue 或這一筆 Decision 的每一次 LWW 欄位寫入 —— **接在留言時間軸
 * （Issue）或編輯欄位（Decision）下面，預設收合**。
 *
 * 它是「出事才會去看」的東西，不該跟每天在用的編輯欄位搶版面，所以既不預設
 * 展開，也**不做「每個欄位旁邊各一個小小的歷史入口」** —— 那會在 drawer 上撒
 * 五個幾乎不會被按的圖示（票 B7）。
 *
 * 被 LWW 蓋掉的舊值以前只有 CLI 的 `nook history`／`nook decision history`
 * 撈得回來，而 studio 是人的主要操作介面（ADR-0007）。`deleted` 也在 Issue
 * 那份清單上（它是第五個 LWW 欄位），這裡因此正是刪除確認框答應給使用者的
 * 那條救生索。
 *
 * **這個組件本身是 Issue 與 Decision 共用的同一份實作**（spec.md Domain
 * decisions）：`historyRows()` 只看 field/value/actor/t，跟欄位名稱的值域
 * 無關；唯一曾經寫死 Issue 的地方是內部直接 import 的 `fetchHistory`，這一批
 * （票 04）把它換成呼叫端傳進來的 `fetchWrites`，Issue 既有呼叫端改傳
 * `fetchHistory` 本身，行為逐字不變。
 */
export interface HistoryPanelProps {
  /** 這一張 Issue 或這一筆 Decision 的 id（完整 ULID）—— history 端點的那個 ref。 */
  readonly id: string;
  /**
   * 打哪個 history 端點由呼叫端決定 —— Issue 傳 `fetchHistory`
   * （`GET /api/history/<ref>`），Decision 傳 `fetchDecisionHistory`
   * （`GET /api/decision-history/<ref>`）。兩邊回應的 `writes` 型別各自窄一點
   * （`WriteView`／`DecisionWriteView`），但結構上都是 `HistoryWrite` 的子集，
   * 因此都能原樣交給這裡。
   */
  readonly fetchWrites: (id: string, signal: AbortSignal) => Promise<{ readonly writes: readonly HistoryWrite[] }>;
}

/**
 * `null` 表示「還沒有人展開過」。**畫面上它與 `loading` 是同一格** —— 收合時
 * 什麼都不畫，而展開的那一瞬間到 effect 送出請求之間只有一個 frame，那一格
 * 畫成別的樣子就是閃一下。分成兩個狀態純粹是因為它們的**來源**不同：一個是
 * 初始值，一個是 effect 設的；合成一個就得用 `open` 去反推現在算哪一種。
 */
type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly rows: readonly HistoryRow[] }
  | { readonly state: 'failed'; readonly message: string };

export function HistoryPanel({ id, fetchWrites }: HistoryPanelProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load | null>(null);

  // **展開時才 fetch，不在開 drawer 時**（票 B7）：多數人不會展開它，而每開
  // 一次 drawer 就多讀一次 op-log 是替不會發生的事付錢。
  //
  // 相依是 `open`／`id`／`fetchWrites`，`load` 刻意不在裡面 —— 把自己設定的
  // 狀態放進相依會讓 effect 立刻重跑，而 cleanup 會把剛送出的那個請求 abort
  // 掉。收合時 cleanup 取消還在飛的請求；再展開就重抓一次（這也就是失敗之後
  // 的重試）。`fetchWrites` 兩邊呼叫端都是模組層級的函式參照（`fetchHistory`／
  // `fetchDecisionHistory`），不會隨每次 render 變動，放進相依因此不會多重跑。
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    fetchWrites(id, controller.signal)
      .then((history) => setLoad({ state: 'ready', rows: historyRows(history.writes) }))
      .catch((err: unknown) => {
        // 自己取消的請求不是失敗 —— 那個 AbortError 是收合這個動作本身。
        if (controller.signal.aborted) return;
        setLoad({ state: 'failed', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [open, id, fetchWrites]);

  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 self-start text-xs font-medium"
      >
        <ChevronRightIcon
          aria-hidden
          className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        History
      </button>

      {open ? <Body load={load} /> : null}
    </section>
  );
}

function Body({ load }: { readonly load: Load | null }): React.JSX.Element {
  if (load === null || load.state === 'loading') {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (load.state === 'failed') {
    // 寫入失敗的橫幅在 App 上，這一則不是 —— 讀失敗只影響這一塊，而收合再展開
    // 就是重試，所以那句話寫在這裡而不是另外給一顆按鈕。
    return (
      <p className="text-destructive text-sm">
        Failed to load history: {load.message} (collapse and expand to retry)
      </p>
    );
  }

  if (load.rows.length === 0) {
    // 空清單要用講的，不是畫一個空的 `<ol>`：一份空的清單看起來像「壞掉了」，
    // 而這裡的事實是「沒有東西被改過」。
    return <p className="text-muted-foreground text-sm">No fields on this issue have been changed yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-3">
      {load.rows.map((row, i) => (
        // 索引當 key：這份清單載入之後不會重排也不會增減（重抓是整份換掉），
        // 而 `(t, field)` 在兩個 Actor 並行寫入不同欄位時不保證唯一。
        <Row key={i} row={row} />
      ))}
    </ol>
  );
}

/**
 * 一列一次寫入：欄位 · 值 · actor · `t`，與 CLI 的 `nook history` 同一份資訊。
 *
 * `t` 是 per-issue 的 lamport clock，不是牆上時鐘 —— 所以它照 CLI 的樣子印成
 * 一個數字，不換算成日期。把它當日期畫出來會是一個看起來很有說服力的謊
 * （同 `CommentTimeline`）。
 */
function Row({ row }: { readonly row: HistoryRow }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // 規則在 `history.ts`：`preview === text` 就是「這一列沒有東西被收起來」。
  const truncated = row.preview !== row.text;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 font-mono text-xs">
        <span className="font-medium">{row.field}</span>
        <span className="text-muted-foreground">{row.actor}</span>
        <span className="text-muted-foreground">t{row.t}</span>
      </div>

      {/*
        **原文，不渲染 markdown。** 前端不得有第二份 markdown 渲染器
        （ADR-0008），而歷史要看的本來就是原文本身 —— 讀的人要把它 copy 回
        `nook set` 或編輯框裡。
      */}
      <p className="text-sm whitespace-pre-wrap wrap-break-word">
        {expanded ? row.text : row.preview}
      </p>

      {truncated ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground cursor-pointer self-start text-xs underline"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      ) : null}
    </li>
  );
}
