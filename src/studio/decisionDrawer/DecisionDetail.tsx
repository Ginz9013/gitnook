import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DecisionView } from '@/api';
import type { ProjectedDecision } from '@/decisionReconcile';
import { MARKDOWN_CONTENT_CLASS } from '@/drawer/markdownContent';
import { DispositionPicker } from './DispositionPicker';
import { bodyChange, supersededByChange, titleChange } from './decisionChanges';
import type { DecisionDrawerChange } from './decisionChanges';

export interface DecisionDetailProps {
  /** 快照 + 樂觀覆蓋。`projectDecisions()` 的產物，由 App 持有的那一份 reducer 算出來。 */
  readonly projected: ProjectedDecision<DecisionView>;
  readonly onSubmit: (id: string, change: DecisionDrawerChange | undefined) => boolean;
}

/**
 * 一筆 Decision 的詳情與內編輯。每個編輯各自走 `POST /d/<ref>`，畫面先動、
 * 回應到了再以伺服器的版本蓋回去 —— 那一段在 `DecisionApp.tsx`，這裡只交出
 * Change。同 `IssueDetail.tsx` 的既有節奏：這個組件刻意很薄，所有「這一下
 * 該不該產生 op」的判斷都在 `decisionChanges.ts`。
 *
 * **沒有 comments、labels、archive、delete** —— Decision 這個實體本來就沒有
 * 這些欄位（spec.md Non-goals）。**`legacyRef` 唯讀，有值才顯示一塊小標記**
 * （spec.md：同 CLI 的 `set` 不曝露它的理由，遷移用的欄位不該在畫面上被改）。
 *
 * **這一批沒有自動化測試**（spec.md 的測試策略：React 組件不寫測試），
 * 能推進純函式的都在 `decisionChanges.ts` 裡，那裡有測試。
 */
export function DecisionDetail({ projected, onSubmit }: DecisionDetailProps): React.JSX.Element {
  const shown = projected.shown;
  // 綁上這一筆的 id 之後交給子組件 —— 它們只知道「送出一份 Change」。
  const submit = (change: DecisionDrawerChange | undefined): boolean => onSubmit(projected.id, change);

  return (
    <>
      {/* 內距一律是 sheet.tsx 預設的兩倍 —— 同 `IssueDetail.tsx` 的既有規則
          （p-4 → p-8、pr-12 → pr-16，右邊多留的那一截讓開右上角的關閉鈕）。 */}
      <SheetHeader className="gap-3 border-b p-8 pr-16">
        {/*
          對話框的可及名稱。可見的那個是下面的 input —— 把 input 塞進 Radix
          的 Title 會讓可及名稱變成空字串（input 沒有文字內容），同
          `IssueDetail.tsx` 的既有理由。
        */}
        <SheetTitle className="sr-only">{shown.title}</SheetTitle>
        <SheetDescription className="sr-only">Details and editing for decision {shown.id}</SheetDescription>

        <TitleField
          title={shown.title}
          pending={projected.optimistic.has('title')}
          onSubmit={submit}
        />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{shown.id}</span>
          {/* 遷移用的唯讀欄位，有值才顯示 —— 不可編輯（spec.md Non-goals）。 */}
          {shown.legacyRef !== undefined ? (
            <Badge variant="outline" className="text-xs">
              legacy: {shown.legacyRef}
            </Badge>
          ) : null}
        </div>

        <DispositionPicker
          disposition={shown.disposition}
          pending={projected.optimistic.has('disposition')}
          onSubmit={submit}
        />
      </SheetHeader>

      <div className="flex flex-col gap-6 px-8 pb-12">
        <BodyField
          body={shown.body}
          bodyHtml={shown.bodyHtml}
          pending={projected.optimistic.has('body')}
          onSubmit={submit}
        />

        <SupersededByField
          supersededBy={shown.supersededBy}
          pending={projected.optimistic.has('supersededBy')}
          onSubmit={submit}
        />
      </div>
    </>
  );
}

interface FieldProps {
  readonly pending: boolean;
  readonly onSubmit: (change: DecisionDrawerChange | undefined) => boolean;
}

/**
 * 標題。`draft === null` 表示「沒有在編」，此時顯示的就是伺服器的值 ——
 * 同 `IssueDetail.tsx` 的 `TitleField`：輪詢帶回別人改過的標題會直接跟上，
 * 而使用者正在打字時不會被抽掉。
 */
function TitleField({ title, pending, onSubmit }: FieldProps & { readonly title: string }): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      value={draft ?? title}
      aria-label="Title"
      className="focus-visible:border-ring focus-visible:ring-ring/50 -mx-2 rounded-md border border-transparent px-2 py-1 text-lg font-semibold outline-none focus-visible:ring-[3px]"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        // 沒有變化（或 trim 後是空的）就不送 —— titleChange 判定，見 decisionChanges.ts。
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
 * body。閱讀時注入 server 的 `bodyHtml`，編輯時換成原文的 textarea ——
 * 同 `IssueDetail.tsx` 的 `DescriptionField`。
 *
 * 送出中的那一段刻意顯示**原文純文字**而不是 HTML：`bodyHtml` 還是舊的
 * 那一份，而前端不得自己把 markdown 渲染成 HTML（server 的「先逸出、再
 * 構造」是唯一一套模型）。等 ACK 回來，server 渲染好的版本就接手。
 */
function BodyField({
  body,
  bodyHtml,
  pending,
  onSubmit,
}: FieldProps & {
  readonly body: string;
  readonly bodyHtml: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">body</h3>
        <Textarea
          autoFocus
          rows={10}
          value={draft}
          aria-label="body"
          className="font-mono text-sm"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              onSubmit(bodyChange(draft, body));
              setDraft(null);
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">body</h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => setDraft(body)}
        >
          Edit
        </Button>
        {pending ? <span className="text-muted-foreground text-xs">Sending…</span> : null}
      </div>

      {body.trim() === '' ? (
        <p className="text-muted-foreground text-sm">No body.</p>
      ) : pending ? (
        <p className="text-sm wrap-break-word whitespace-pre-wrap">{body}</p>
      ) : (
        // server 已把 markdown 渲染成安全 HTML（先逸出、再構造）。這裡直接
        // 注入，且不再過第二套消毒 —— 同 `IssueDetail.tsx` 的既有理由。
        <div className={MARKDOWN_CONTENT_CLASS} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      )}
    </section>
  );
}

/**
 * supersededBy。**純文字輸入，不解析目標、不顯示連結、不驗證存在**
 * （spec.md Non-goals）——同 `IssueDetail.tsx` 的 `TitleField` 一樣的
 * inline 編輯節奏，但沒有 trim（見 `decisionChanges.ts` 的 `supersededByChange`）。
 *
 * **一個平面 `<input>`，不是 `components/ui/` 底下的元件**：這批目錄裡沒有
 * shadcn 的 `Input`（現有清單只有 button／textarea／badge／dropdown-menu／
 * sheet／alert-dialog），新增一個泛用元件超出這一批的寫入所有權；樣式因此
 * 借用 `Textarea` 那份既有 class 字串（拿掉 `min-h-16`／`field-sizing-content`
 * 那兩個只對多行框有意義的部分），單行輸入視覺上仍與其餘欄位一致。
 *
 * `undefined` 顯示成空字串：從沒被寫過跟「被清成空字串」在伺服器端是
 * 不同的事（optional 欄位用鍵不存在表達），但在這一格輸入框上使用者只看得到
 * 「有沒有字」，沒有第三種狀態可以畫。
 */
function SupersededByField({
  supersededBy,
  pending,
  onSubmit,
}: FieldProps & { readonly supersededBy: string | undefined }): React.JSX.Element {
  const current = supersededBy ?? '';
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">superseded by</h3>
      <div className="flex items-center gap-2">
        <input
          value={draft ?? current}
          aria-label="superseded by"
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft === null) return;
            // 沒有變化就不送 —— supersededByChange 判定，見 decisionChanges.ts。
            onSubmit(supersededByChange(draft, current));
            setDraft(null);
          }}
        />
        {pending ? <span className="text-muted-foreground shrink-0 text-xs">Sending…</span> : null}
      </div>
    </section>
  );
}
