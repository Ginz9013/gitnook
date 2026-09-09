import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { IssueView } from '@/api';
import type { ProjectedIssue } from '@/reconcile';
import { CommentTimeline } from './CommentTimeline';
import { LabelEditor } from './LabelEditor';
import { StatusPicker } from './StatusPicker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { archiveChange, deleteChange, descriptionChange, titleChange } from './changes';
import type { DrawerChange } from './changes';

export interface IssueDetailProps {
  /** 快照 + 樂觀覆蓋。`project()` 的產物，由 App 持有的那一份 reducer 算出來。 */
  readonly projected: ProjectedIssue<IssueView>;
  readonly onSubmit: (id: string, change: DrawerChange | undefined) => boolean;
}

/**
 * 一張 issue 的詳情與內編輯。每個編輯各自走 `POST /i/<ref>`，畫面先動、
 * 回應到了再以伺服器的版本蓋回去 —— 那一段在 `App.tsx`，這裡只交出 Change。
 *
 * 這個組件刻意很薄：所有「這一下該不該產生 op」的判斷都在 `changes.ts`，
 * 這裡只負責把使用者的動作翻成一份 Change 交出去。這一票沒有自動化測試
 * （spec.md 的測試策略），能推進純函式的就不留在組件裡。
 */
export function IssueDetail({ projected, onSubmit }: IssueDetailProps): React.JSX.Element {
  const shown = projected.shown;
  // 綁上這一張的 id 之後交給子組件 —— 它們只知道「送出一份 Change」。
  const submit = (change: DrawerChange | undefined): boolean => onSubmit(projected.id, change);

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
        {/* 寫入失敗的訊息在 App 的橫幅上：拖曳失敗時 drawer 可能根本沒開著。 */}
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

        <IssueActions
          shortId={shown.shortId}
          archived={shown.archived}
          pending={projected.optimistic.has('archived')}
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
 * 封存與刪除。**兩顆按鈕，因為它們是兩件事**（D4）：
 *
 * - **封存**是可見性（ADR-0003 說 `archived` 是欄位不是第九個 Status）——
 *   那張從看板上收起來，但 `nook list --all` 還列得到。可以再按回來。
 * - **刪除**是墓碑（ADR-0009 的 `set deleted=<bool>`）—— `--all` 也不再列它。
 *
 * `cancelled` 沒有按鈕：它是八個 Status 之一，拖過去就好（D4）。
 *
 * 這裡沒有「送出中」的刪除狀態，因為刪除不是樂觀欄位（`reconcile.ts` 的
 * `OptimisticField` 不含 `deleted`）：卡片消失的時機是 ACK 帶回 `deleted: true`
 * 把它移出快照，drawer 隨之關閉 —— `App` 那邊 `selectedId` 指的那張已經不在
 * 投影裡，`selected` 於是是 null。
 */
function IssueActions({
  shortId,
  archived,
  pending,
  onSubmit,
}: FieldProps & {
  readonly shortId: string;
  readonly archived: boolean;
}): React.JSX.Element {
  return (
    <section className="flex items-center justify-between gap-2 border-t pt-4">
      <Button
        variant="outline"
        size="sm"
        aria-busy={pending}
        // 切換：`next` 是現在那一格的相反，所以這一按一定有變化。
        // `archiveChange` 仍然自己判一次 —— 那條「沒有變化就不送」是 changes.ts
        // 對所有呼叫端的契約，不是這個呼叫端的義務。
        onClick={() => onSubmit(archiveChange(!archived, archived))}
      >
        {archived ? '取消封存' : '封存'}
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          {/* destructive —— 這一版裡該用到那個 token 的少數幾處之一（D9）。 */}
          <Button variant="destructive" size="sm">
            刪除
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除這張 Issue？</AlertDialogTitle>
            {/*
              這段話說的是「刪除跟封存差在哪」與「按錯了怎麼辦」。它必須在框裡
              而不是在文件裡：讀它的人正在猶豫要不要按，而那正是這兩件事唯一
              有用的時刻。用字與 `nook rm` 的確認訊息一致（cli/run.ts 的
              `deletedMessage`）—— 同一個決定在三個介面上說同一句話。

              **「每一個欄位寫過的值」是刻意的精確措辭，不要改回「每一個值」。**
              `history` 列的是對 LWW 欄位的寫入（票 A12 之後含 create 寫下的
              標題）；`comment` 與 `label` 不是欄位，不在那份清單裡 —— 它們
              仍然在 `.ndjson` 裡，但這句話不該讓人以為 `history` 撈得到。
            */}
            <AlertDialogDescription>
              封存只是把它從看板上收起來，<code className="font-mono">nook list --all</code>{' '}
              還列得到；<strong className="text-foreground font-medium">刪除之後 --all 也不再列它</strong>。
              檔案不會被刪掉：<code className="font-mono">nook history {shortId}</code>{' '}
              仍然撈得回它每一個欄位寫過的值，
              <code className="font-mono">nook set {shortId} deleted false</code> 可以把它放回來。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* 取消是預設焦點（Radix），關掉之後焦點回到上面那顆刪除按鈕。 */}
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => onSubmit(deleteChange())}
            >
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
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
        // 沒有變化（或 trim 後是空的）就不送 —— titleChange 判定，見 changes.ts。
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
