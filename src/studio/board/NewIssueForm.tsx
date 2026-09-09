import { useCallback, useEffect, useRef, useState } from 'react';

import type { Status } from '@/api';
import { cn } from '@/lib/utils';

/**
 * 在看板上開一張 Issue —— 一個入口（那顆按鈕）加上一條輸入框。
 *
 * **只收標題**（D15）。單行、Enter 送出、Esc 取消、送出後保持開啟並清空 ——
 * 「連開三張」是這個表單真實的使用情境，所以成功之後把輸入框收起來，等於逼
 * 使用者為第二張再點一次。其餘欄位（描述、標籤）留給 drawer：一個開場就要求
 * 填五格的對話框，會讓「快速記下一件事」這個唯一的使用情境變慢，而 `nook new`
 * 之後接著就是 `nook set description`，CLI 上本來也是兩步。
 *
 * **這裡沒有自動化測試**（spec 的測試策略：React 組件不寫測試、不引入 jsdom）。
 * 可判定的那一半住在別處，而且都有測試：`title` 空不空由呼叫端之外的同一條
 * 規則決定（`drawer/changes.ts` 的 `titleChange`：空標題不是一次編輯，是一次
 * 誤觸），端點對空標題／不合法 Status 回 400 的行為在 `test/server/handler.test.ts`，
 * 「把新的那張接進快照」在 `test/studio/reconcile.test.ts` 的 `CREATED`。
 * 留在這個檔案裡的只有接線與焦點。
 */

/**
 * 一個入口的開關狀態 —— 那顆按鈕、它開著沒有，以及**關掉之後焦點回哪裡**。
 *
 * 抽成 hook 而不是讓每個呼叫端自己寫，是為了最後那一件事。表單一 unmount，
 * 焦點就會掉回 `<body>`（`board/focus.ts` 記的是同一種失敗：鍵盤使用者在看板上
 * 失去自己的位置，下一次 Tab 從整份文件的開頭重來）。而入口有**九個** ——
 * header 一個、八欄各一個 —— 九份手抄的焦點處理只要有一份漏了，那一個入口就會
 * 靜靜地把焦點丟掉，畫面上看不出任何異狀。
 *
 * 按鈕與表單在版面上不相鄰（欄位裡按鈕在欄頭那一列，表單在它下面一整條），
 * 所以這裡交出的是兩塊零件而不是一個組件：呼叫端把 `trigger` 攤在自己的按鈕上，
 * 在自己選的位置 render `<NewIssueForm>`。
 */
export interface NewIssueEntry {
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

export function useNewIssueEntry(): NewIssueEntry {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // 先 focus 再等重繪都可以 —— 按鈕一直在畫面上（它不是 Radix 那種
    // 「開著的時候 Trigger 不存在」的情況），所以這一行不會是無聲的 no-op。
    ref.current?.focus();
  }, []);

  const onClick = useCallback(() => setOpen((v) => !v), []);

  return { open, trigger: { ref, 'aria-expanded': open, onClick }, close };
}

export interface NewIssueFormProps {
  /**
   * 這個入口把哪一個 Status 當預設值。**`undefined` = 不送 `status`**，端點
   * 於是讓它落在 `backlog`（`board.create` 的預設）——header 那顆按鈕就是這種。
   *
   * 欄頂那八個各自帶著自己那一欄的 Status。**這是看板這個版面唯一比 CLI 好的
   * 地方**：在 `review` 那一欄上按下 `+`，想的就是「開一張已經在 review 的」，
   * 而 CLI 上那是 `nook new … --status review` 兩段字。
   */
  readonly status?: Status;
  /**
   * 送出一張。**回 `false` 表示沒有建成**（伺服器說不、或送不到），此時輸入框
   * 不清空 —— 使用者剛打的那句話是他手上唯一的一份，清掉等於要他重打。錯誤本身
   * 由 `App` 的失敗橫幅說，不在這裡再講一次。
   *
   * 同 `drawer` 的 `onSubmit`：回傳 boolean 而不是讓呼叫端 reject，因為「沒建成」
   * 在這裡是一個預期中的結果，不是例外。
   */
  readonly onCreate: (title: string, status: Status | undefined) => Promise<boolean>;
  /** Esc。關掉並把焦點還給那顆按鈕 —— 就是 `useNewIssueEntry().close`。 */
  readonly onCancel: () => void;
  readonly className?: string;
}

export function NewIssueForm({
  status,
  onCreate,
  onCancel,
  className,
}: NewIssueFormProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  // 「送出中」是一格 state 而不是一個 ref，因為畫面要說得出來（`aria-busy`）。
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  // 表單一出現，焦點就進輸入框 —— 打開它的那一下就是「我要打字」。
  // 用 effect 而不是 `autoFocus`：後者在 React 裡是 mount 當下的一次性屬性，
  // 讀 JSX 的人看不出它跟下面那條 Esc 還焦點的規則是同一件事。
  useEffect(() => {
    input.current?.focus();
  }, []);

  async function submit(): Promise<void> {
    // 空標題不送 —— 與 `changes.ts` 的 `titleChange` 同一條規則。append-only
    // 之下一張沒有標題的白卡刪不掉，只能再寫一次 op 蓋過去。
    const value = title.trim();
    if (value === '' || submitting) return;
    setSubmitting(true);
    const ok = await onCreate(value, status);
    setSubmitting(false);
    // 成功才清空，而且**不關閉** —— 連開三張是真實情境（D15）。
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
          // 表單自己吃掉 Esc：這一下說的是「不開了」，不是「取消拖曳」，
          // 而看板的鍵盤 sensor 也把 Escape 當成取消。
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      {/*
        表單裡只有這一個文字輸入框，所以 Enter 就是送出 —— HTML 的隱式送出
        （implicit submission）對「恰好一個會擋住它的欄位」是有定義的行為，
        因此這裡不必再自己聽一次 Enter。自己聽會變成兩條送出路徑，而兩條路徑
        在 append-only 之下的分歧是「同一次 Enter 開了兩張」。
      */}
      <input
        ref={input}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        // 九個入口的輸入框都在同一份文件上，可及名稱因此不能都叫「標題」。
        aria-label={status === undefined ? '新 Issue 的標題' : `新 Issue 的標題（${status}）`}
        placeholder="標題，Enter 送出"
        aria-busy={submitting}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-[3px]"
      />
    </form>
  );
}
