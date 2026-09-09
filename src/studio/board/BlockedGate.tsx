import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

import type { Status } from '@/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { statusChange } from '@/drawer/changes';
import type { DrawerChange } from '@/drawer/changes';

export interface BlockedGateProps {
  readonly title: string;
  /** 這張 Issue 現在的 Status —— `statusChange` 要它才判得出這一下有沒有變化。 */
  readonly from: Status;
  /**
   * 確認。帶出去的是**同時裝著 status 與原因的那一份 `Change`**，不是兩件事
   * —— 呼叫端只要送它，`board.apply()` 就把兩個 op 一起 append。
   */
  readonly onConfirm: (change: DrawerChange) => void;
  readonly onCancel: () => void;
  /**
   * 關閉之後焦點要去哪。閘門是放手的當下**程式化**開啟的，沒有 Trigger，而
   * Radix 關閉時做的事正是「把焦點交給 Trigger」—— 見 `focus.ts`。
   */
  readonly onCloseFocus: () => void;
}

/**
 * 拖進 `blocked` 的當下擋一下，**並且在這裡收下原因**。
 *
 * ADR-0003：`blocked` 留在 Status 裡的代價，是它必須同時留下一則說明卡住原因的
 * Comment —— 少了那則 Comment，「卡住前在做什麼」就永久消失。這道閘門的重點是
 * **時機**：規則要在放手的當下講，不能讓人拖完才發現。
 *
 * **輸入框在這裡，不在別的地方。** 前一版把原因推給 drawer（確認後開啟細節請人
 * 去寫），理由是 `onMove(id, status)` 帶不了 comment。那個限制是介面的形狀造成
 * 的，而介面是我們自己的：`onConfirm` 現在交出整份 `Change`，`BoardProps.onBlock`
 * 收它。推給 drawer 的版本沒有任何東西逼人真的寫 —— 關掉 drawer 就是一張
 * 「已經 blocked 但沒有人知道為什麼」的 Issue，正是這條規則要防的狀態。
 *
 * 「原因夠不夠」不在這裡判斷：`statusChange` 回 `undefined` 就是不夠。那是
 * drawer 的 `StatusPicker` 用的同一個函式，兩條路徑因此不可能對 blocked 有兩套
 * 標準。
 *
 * focus trap、Esc、scroll lock 交給 Radix（ADR-0008：這些手寫都會寫錯）；
 * 只有「關閉後焦點去哪」必須接手，見 `onCloseAutoFocus`。
 */
export function BlockedGate({
  title,
  from,
  onConfirm,
  onCancel,
  onCloseFocus,
}: BlockedGateProps): React.JSX.Element {
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState('');
  // 這一下送得出去的東西。`undefined` = 還沒有原因，於是「移到 blocked」按不下去。
  const change = statusChange('blocked', from, reason);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          role="alertdialog"
          onOpenAutoFocus={(event) => {
            // 焦點落在輸入框：這一步是使用者剛才親手拖出來的，他要做的下一件事
            // 是寫原因，不是找按鈕。反悔的路徑仍然有 Esc 與取消鍵。
            event.preventDefault();
            reasonRef.current?.focus();
          }}
          onInteractOutside={(event) => {
            // 點外面不關。Radix 的 Dialog 預設關掉，但這是 alertdialog：它問的
            // 問題必須有一個明確的答案，而現在框裡還有使用者打到一半的原因 ——
            // 一次落在看板上的誤點不該把那段字丟掉。Esc 仍然是取消。
            event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // 一律接手。Radix 內建的動作是 `focus()` 到 `<Dialog.Trigger>`，
            // 而這個對話框沒有 Trigger —— 交給它就是把焦點交給 null。
            event.preventDefault();
            onCloseFocus();
          }}
          aria-describedby="blocked-gate-why"
          className="bg-background fixed top-1/2 left-1/2 z-50 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-lg"
        >
          <Dialog.Title className="text-sm font-medium">
            「{title}」要移到 blocked
          </Dialog.Title>
          <Dialog.Description
            id="blocked-gate-why"
            className="text-muted-foreground mt-2 text-sm leading-relaxed"
          >
            設為 blocked 必須同時留下一則 Comment 說明卡住的原因，否則「卡住前在做什麼」
            這件事會從 Board 上消失。原因與這次移動會一起送出，成為這張 Issue 的一則 comment。
          </Dialog.Description>

          <label className="mt-4 block text-xs" htmlFor="blocked-gate-reason">
            卡在哪裡？
          </label>
          <Textarea
            id="blocked-gate-reason"
            ref={reasonRef}
            className="mt-1"
            rows={3}
            value={reason}
            placeholder="例：等 API 那邊確認欄位名稱"
            onChange={(e) => setReason(e.target.value)}
          />

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              取消，不要移動
            </Button>
            <Button
              size="sm"
              disabled={change === undefined}
              onClick={() => {
                if (change !== undefined) onConfirm(change);
              }}
            >
              移到 blocked
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
