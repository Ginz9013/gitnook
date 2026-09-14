import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CommentView } from '@/api';
import type { UnconfirmedComment } from '@/reconcile';
import { commentChange } from './changes';
import type { DrawerChange } from './changes';
import { MARKDOWN_CONTENT_CLASS } from './markdownContent';

export interface CommentTimelineProps {
  readonly comments: readonly CommentView[];
  readonly unconfirmed: readonly UnconfirmedComment[];
  readonly onSubmit: (change: DrawerChange | undefined) => boolean;
}

/**
 * 留言時間軸。
 *
 * **不重排、不反轉。** `Issue.comments` 已由 core 的 `reduce()` 以
 * `(t, actor, id)` 全序產出，`IssueView.comments` 原樣帶過來。在這裡放第二個
 * 比較器只會與 core 分歧 —— 那正是 commit 463343d 那個 bug 的成因，也是
 * `render/table.ts` 上面同一句註解的由來。
 *
 * `t` 是 per-issue 的 lamport clock，不是牆上時鐘，所以這裡不顯示時間 ——
 * 把它當日期畫出來會是一個看起來很有說服力的謊。CLI 的 `show` 同樣只印 actor。
 */
export function CommentTimeline({
  comments,
  unconfirmed,
  onSubmit,
}: CommentTimelineProps): React.JSX.Element {
  const [draft, setDraft] = useState('');

  function send(): void {
    if (onSubmit(commentChange(draft))) setDraft('');
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-muted-foreground text-xs font-medium">
        comments（{comments.length + unconfirmed.length}）
      </h3>

      {comments.length + unconfirmed.length === 0 ? (
        <p className="text-muted-foreground text-sm">No comments yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="flex flex-col gap-1">
              <span className="text-muted-foreground font-mono text-xs">{c.actor}</span>
              {/*
                server 已把 markdown 渲染成安全 HTML（先逸出、再構造），前端
                直接注入。這裡不得再過一次「消毒」：第二套模型與第一套遲早
                會對同一段輸入給出不同答案，而那個分歧才是漏洞。
              */}
              <div
                className={MARKDOWN_CONTENT_CLASS}
                dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
              />
            </li>
          ))}
          {/* 飛行中的留言接在尾端 —— 伺服器確認後它會回到 core 給的位置。 */}
          {unconfirmed.map((u) => (
            <li key={`unconfirmed-${u.seq}`} className="flex flex-col gap-1 opacity-60">
              <span className="text-muted-foreground font-mono text-xs">Sending…</span>
              {/* 還沒有 bodyHtml —— 前端不渲染 markdown，所以顯示原文。 */}
              <p className="text-sm wrap-break-word whitespace-pre-wrap">{u.body}</p>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          rows={3}
          value={draft}
          aria-label="New comment"
          placeholder="Comment (⌘/Ctrl + Enter to send)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div>
          <Button size="sm" disabled={commentChange(draft) === undefined} onClick={send}>
            Send
          </Button>
        </div>
      </div>
    </section>
  );
}
