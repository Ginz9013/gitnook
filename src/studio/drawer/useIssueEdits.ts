import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { IssueView } from '@/api';
import { editReduce, initialEdits, projectEdits } from './pending';
import type { DrawerChange, ProjectedIssue } from './pending';
import { postChange } from './write';

export interface IssueEdits {
  /** 畫面該顯示的值：快照 + 樂觀覆蓋。 */
  readonly projected: ProjectedIssue;
  /**
   * 送出一份編輯。傳 `undefined`（`pending.ts` 的規則判定「這一下沒有東西
   * 要送」）時什麼都不做並回傳 false —— 呼叫端用它決定要不要清空輸入框。
   */
  readonly submit: (change: DrawerChange | undefined) => boolean;
  /** 最近一次傳輸失敗的訊息；成功一次就清掉。 */
  readonly failed: string | null;
}

/**
 * 把 `pending.ts`（規則）與 `write.ts`（傳輸）接起來的那一層。
 *
 * 組件因此只剩下「畫出 projected、把使用者的動作翻成 Change」兩件事 ——
 * 這一票沒有自動化測試（spec.md 的測試策略），所以能推進純函式的都推進去了。
 *
 * 呼叫端要為每一張 issue 各給一個實例（`key={issue.id}`）：飛行中的編輯屬於
 * 那一張，換一張就該整批丟掉。
 */
export function useIssueEdits(issue: IssueView): IssueEdits {
  const [state, dispatch] = useReducer(editReduce, issue, initialEdits);
  const [failed, setFailed] = useState<string | null>(null);
  // seq 的配發者。放在 ref 而不是 reducer state 裡，是因為配發與 dispatch 之間
  // 隔著一次 render：從 state 讀 `seq + 1` 會讓連按兩下拿到同一個號碼。
  const seqRef = useRef(0);

  // 上層送來新的快照（初次載入，之後是票 05 的輪詢）。pending 不動 ——
  // 飛行中的編輯蓋過快照。
  useEffect(() => {
    dispatch({ type: 'POLL', issue });
  }, [issue]);

  const id = issue.id;
  const submit = useCallback(
    (change: DrawerChange | undefined): boolean => {
      if (change === undefined) return false;

      const seq = (seqRef.current += 1);
      dispatch({ type: 'EDIT', seq, change });

      // 刻意不 abort：drawer 關掉不代表使用者要收回這次寫入，而 append-only
      // 之下也收不回來。讓它飛完，回應到了就更新（元件已卸載則被忽略）。
      postChange(id, change).then(
        (view) => {
          dispatch({ type: 'ACK', seq, issue: view });
          setFailed(null);
        },
        (err: unknown) => {
          dispatch({ type: 'FAIL', seq });
          setFailed(err instanceof Error ? err.message : String(err));
        },
      );
      return true;
    },
    [id],
  );

  return { projected: projectEdits(state), submit, failed };
}
