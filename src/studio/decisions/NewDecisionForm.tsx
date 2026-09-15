import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * 在 Decisions 清單上開一筆 Decision —— 一個入口（那顆按鈕）加上一條輸入框。
 * 逐項比照 `board/NewIssueForm.tsx`：只有一個入口（Issue 那邊有九個，因為
 * 八欄各自帶著自己的 Status；Decision 沒有欄，因此只有 header 這一個）。
 *
 * **只收標題**。單行、Enter 送出、Esc 取消、送出後保持開啟並清空 ——
 * 「連開好幾筆」是這個表單真實的使用情境，所以成功之後把輸入框收起來，等於逼
 * 使用者為第二筆再點一次。`body`／`disposition` 留給 drawer（票 03）：一個開場
 * 就要求填三格的對話框，會讓「快速記下一個決定」這個唯一的使用情境變慢。
 *
 * **這裡沒有自動化測試**（spec 的測試策略：React 組件不寫測試、不引入 jsdom）。
 * 可判定的那一半住在別處，而且都有測試：端點對空標題／不合法 disposition 回
 * 400 的行為在 `test/server/handler.test.ts`，「把新的那筆接進快照」在
 * `decisionReconcile.ts` 的 `CREATED`（票 01 已測）。留在這個檔案裡的只有
 * 接線與焦點。
 */

/**
 * 一個入口的開關狀態 —— 那顆按鈕、它開著沒有，以及**關掉之後焦點回哪裡**。
 * 逐字比照 `NewIssueForm.tsx` 的 `useNewIssueEntry`：Decisions 只有一個入口，
 * 但焦點掉回 `<body>` 的失敗模式跟 Issue 的九個入口是同一件事，值得沿用
 * 同一份手法而不是自己重寫一次。
 */
export interface NewDecisionEntry {
  readonly open: boolean;
  /** 攤在觸發鈕上。`ref` 是焦點要回去的那個節點，所以它非給不可。 */
  readonly trigger: {
    readonly ref: React.RefObject<HTMLButtonElement | null>;
    readonly 'aria-expanded': boolean;
    readonly onClick: () => void;
  };
  /** 關掉表單，並把焦點還給開啟它的那顆按鈕。 */
  readonly close: () => void;
}

export function useNewDecisionEntry(): NewDecisionEntry {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // 先 focus 再等重繪都可以 —— 按鈕一直在畫面上，這一行不會是無聲的 no-op。
    ref.current?.focus();
  }, []);

  const onClick = useCallback(() => setOpen((v) => !v), []);

  return { open, trigger: { ref, 'aria-expanded': open, onClick }, close };
}

export interface NewDecisionFormProps {
  /**
   * 送出一筆。**回 `false` 表示沒有建成**（伺服器說不、或送不到），此時輸入框
   * 不清空 —— 使用者剛打的那句話是他手上唯一的一份，清掉等於要他重打。錯誤本身
   * 由 `DecisionApp` 的失敗橫幅說，不在這裡再講一次。
   *
   * 同 `NewIssueForm` 的 `onCreate`：回傳 boolean 而不是讓呼叫端 reject，
   * 因為「沒建成」在這裡是一個預期中的結果，不是例外。
   */
  readonly onCreate: (title: string) => Promise<boolean>;
  /** Esc。關掉並把焦點還給那顆按鈕 —— 就是 `useNewDecisionEntry().close`。 */
  readonly onCancel: () => void;
  readonly className?: string;
}

export function NewDecisionForm({
  onCreate,
  onCancel,
  className,
}: NewDecisionFormProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  // 「送出中」是一格 state 而不是一個 ref，因為畫面要說得出來（`aria-busy`）。
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  // 表單一出現，焦點就進輸入框 —— 打開它的那一下就是「我要打字」。
  useEffect(() => {
    input.current?.focus();
  }, []);

  async function submit(): Promise<void> {
    // 空標題不送 —— 同 `NewIssueForm` 的既有規則：append-only 之下一筆沒有
    // 標題的 Decision 刪不掉，只能再寫一次 op 蓋過去。
    const value = title.trim();
    if (value === '' || submitting) return;
    setSubmitting(true);
    const ok = await onCreate(value);
    setSubmitting(false);
    // 成功才清空，而且**不關閉** —— 連開好幾筆是真實情境。
    if (ok) setTitle('');
  }

  return (
    <form
      className={cn('flex items-center', className)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // 表單自己吃掉 Esc：這一下說的是「不開了」。
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      {/*
        表單裡只有這一個文字輸入框，所以 Enter 就是送出 —— HTML 的隱式送出
        （implicit submission）對「恰好一個會擋住它的欄位」是有定義的行為，
        因此這裡不必再自己聽一次 Enter。
      */}
      <input
        ref={input}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="New decision title"
        placeholder="Title, Enter to submit"
        aria-busy={submitting}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-[3px]"
      />
    </form>
  );
}
