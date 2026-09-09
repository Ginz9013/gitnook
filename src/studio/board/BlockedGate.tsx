import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';

export interface BlockedGateProps {
  readonly title: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 拖進 `blocked` 的當下擋一下。
 *
 * ADR-0003：`blocked` 留在 Status 裡的代價，是它必須同時留下一則說明卡住原因的
 * Comment —— 少了那則 Comment，「卡住前在做什麼」就永久消失。這道閘門的重點是
 * **時機**：規則要在放手的當下講，不能讓人拖完才發現。
 *
 * 這裡不放輸入框：留言要走 `Change` 才會進 op-log，而看板手上只有
 * `onMove(id, status)`，寫留言是 drawer 的事。收下一段之後丟掉的文字比不收更糟，
 * 所以確認之後直接把這張 Issue 的 drawer 打開，原因寫在那裡。
 *
 * focus trap、Esc、scroll lock 交給 Radix（ADR-0008：這些手寫都會寫錯）。
 */
export function BlockedGate({ title, onConfirm, onCancel }: BlockedGateProps): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null);
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
            // 這一步是使用者剛才親手拖出來的，所以焦點落在「繼續」而不是預設的
            // 第一顆按鈕；反悔的路徑仍然有 Esc 與取消鍵。
            event.preventDefault();
            confirmRef.current?.focus();
          }}
          className="bg-background fixed top-1/2 left-1/2 z-50 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-lg"
        >
          <Dialog.Title className="text-sm font-medium">
            「{title}」要移到 blocked
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-2 text-sm leading-relaxed">
            設為 blocked 必須同時留下一則 Comment 說明卡住的原因，否則「卡住前在做什麼」
            這件事會從 Board 上消失。按下確認會移動這張 Issue 並開啟它的細節，請在那裡寫下原因。
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              取消，不要移動
            </Button>
            <Button size="sm" ref={confirmRef} onClick={onConfirm}>
              移到 blocked 並寫下原因
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
