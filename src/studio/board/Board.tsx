import type { IssueView, Status } from '@/api';

/**
 * 看板的插槽。**這是票 06 要填的空殼** —— 八欄、卡片與 `@dnd-kit` 的拖拉
 * 都在那張票。這裡先把介面定下來，票 06 因此只需要改本目錄底下的檔案，
 * 不必回頭動 `App.tsx`。
 */
export interface BoardProps {
  /** 目前這一版快照裡的全部 Issue，含 archived —— 藏不藏是這一層的決定。 */
  readonly issues: readonly IssueView[];
  /** drawer 目前開在哪一張；沒開就是 null。 */
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  /** 一次拖曳的結果。票 06 接上 @dnd-kit，票 05 負責送出與調和。 */
  readonly onMove: (id: string, status: Status) => void;
}

export function Board({ issues, onSelect }: BoardProps): React.JSX.Element {
  const visible = issues.filter((i) => !i.archived);
  return (
    <main className="p-4" data-slot="board">
      <p className="text-muted-foreground text-sm">
        看板尚未實作（票 06）。目前的快照有 {visible.length} 張 Issue。
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {visible.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              className="text-left text-sm underline-offset-4 hover:underline"
              onClick={() => onSelect(issue.id)}
            >
              {issue.title}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
