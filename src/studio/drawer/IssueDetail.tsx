import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { IssueView } from '@/api';
import { CommentTimeline } from './CommentTimeline';
import { LabelEditor } from './LabelEditor';
import { StatusPicker } from './StatusPicker';
import { descriptionChange, titleChange } from './pending';
import type { DrawerChange } from './pending';
import { useIssueEdits } from './useIssueEdits';

export interface IssueDetailProps {
  readonly issue: IssueView;
}

/**
 * 一張 issue 的詳情與內編輯。每個編輯各自走 `POST /i/<ref>`，畫面先動、
 * 回應到了再以伺服器的版本蓋回去（`useIssueEdits`）。
 *
 * 這個組件刻意很薄：所有「這一下該不該產生 op」的判斷都在 `pending.ts`，
 * 這裡只負責把使用者的動作翻成一份 Change 交出去。這一票沒有自動化測試
 * （spec.md 的測試策略），能推進純函式的就不留在組件裡。
 */
export function IssueDetail({ issue }: IssueDetailProps): React.JSX.Element {
  const { projected, submit, failed } = useIssueEdits(issue);
  const shown = projected.issue;

  return (
    <>
      <SheetHeader className="gap-3 border-b pr-12">
        {/*
          對話框的可及名稱。可見的那個是下面的 input —— 把 input 塞進 Radix
          的 Title 會讓可及名稱變成空字串（input 沒有文字內容）。
        */}
        <SheetTitle className="sr-only">{shown.title}</SheetTitle>
        <SheetDescription className="sr-only">Issue {shown.id} 的詳情與編輯</SheetDescription>

        <TitleField
          title={shown.title}
          pending={projected.optimistic.has('title')}
          onSubmit={submit}
        />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{shown.id}</span>
          {shown.archived ? (
            <Badge variant="outline" className="text-xs">
              archived
            </Badge>
          ) : null}
        </div>

        <StatusPicker
          status={shown.status}
          pending={projected.optimistic.has('status')}
          onSubmit={submit}
        />
        <LabelEditor
          labels={shown.labels}
          pending={projected.optimistic.has('labels')}
          onSubmit={submit}
        />
      </SheetHeader>

      <div className="flex flex-col gap-6 px-4 pb-6">
        {failed === null ? null : (
          <p className="text-destructive text-sm" role="status">
            寫入沒送到，畫面已回到伺服器上的值：{failed}
          </p>
        )}

        <DescriptionField
          description={shown.description}
          descriptionHtml={shown.descriptionHtml}
          pending={projected.optimistic.has('description')}
          onSubmit={submit}
        />

        <CommentTimeline
          comments={shown.comments}
          unconfirmed={projected.unconfirmed}
          onSubmit={submit}
        />
      </div>
    </>
  );
}

interface FieldProps {
  readonly pending: boolean;
  readonly onSubmit: (change: DrawerChange | undefined) => boolean;
}

/**
 * 標題。`draft === null` 表示「沒有在編」，此時顯示的就是伺服器的值 ——
 * 輪詢帶回別人改過的標題會直接跟上，而使用者正在打字時不會被抽掉。
 */
function TitleField({ title, pending, onSubmit }: FieldProps & { readonly title: string }): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      value={draft ?? title}
      aria-label="標題"
      className="focus-visible:border-ring focus-visible:ring-ring/50 -mx-2 rounded-md border border-transparent px-2 py-1 text-lg font-semibold outline-none focus-visible:ring-[3px]"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        // 沒有變化（或 trim 後是空的）就不送 —— titleChange 判定，見 pending.ts。
        onSubmit(titleChange(draft, title));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      // 顯示的已經是樂觀值；還在飛就讓輔助技術知道這裡尚未定案。
      aria-busy={pending}
    />
  );
}

/**
 * 描述。閱讀時注入 server 的 `descriptionHtml`，編輯時換成原文的 textarea。
 *
 * 送出中的那一段刻意顯示**原文純文字**而不是 HTML：`descriptionHtml` 還是
 * 舊的那一份，而前端不得自己把 markdown 渲染成 HTML（server 的「先逸出、
 * 再構造」是唯一一套模型）。等 ACK 回來，server 渲染好的版本就接手。
 */
function DescriptionField({
  description,
  descriptionHtml,
  pending,
  onSubmit,
}: FieldProps & {
  readonly description: string;
  readonly descriptionHtml: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">description</h3>
        <Textarea
          autoFocus
          rows={10}
          value={draft}
          aria-label="description"
          className="font-mono text-sm"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              onSubmit(descriptionChange(draft, description));
              setDraft(null);
            }}
          >
            儲存
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            取消
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">description</h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => setDraft(description)}
        >
          編輯
        </Button>
        {pending ? <span className="text-muted-foreground text-xs">送出中…</span> : null}
      </div>

      {description.trim() === '' ? (
        <p className="text-muted-foreground text-sm">沒有描述。</p>
      ) : pending ? (
        <p className="text-sm wrap-break-word whitespace-pre-wrap">{description}</p>
      ) : (
        // server 已把 markdown 渲染成安全 HTML（先逸出、再構造）。這裡直接
        // 注入，且不再過第二套消毒 —— 兩套模型對同一段輸入遲早會給出不同
        // 答案，那個分歧才是漏洞。
        <div
          className="prose-sm text-sm wrap-break-word [&_a]:underline [&_code]:font-mono [&_pre]:overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}
    </section>
  );
}
