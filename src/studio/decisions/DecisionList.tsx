import type { DecisionView } from '@/api';
import type { ProjectedDecision } from '@/decisionReconcile';
import { Badge } from '@/components/ui/badge';

/**
 * Decisions 的扁平清單 —— 一列一個 Decision（shortId／title／disposition）。
 * **不是看板**：Decision 沒有 Status/Lane（spec.md Non-goals），所以這裡是
 * 一份 `<ul>`，不是 `board/Board.tsx` 那種多欄拖曳版面。
 *
 * 收的是 `projectDecisions()` 的投影而不是 `DecisionView[]`——同 `board/Card.tsx`
 * 收 `ProjectedIssue` 的既有理由：畫面上要畫的還有「這筆上面有沒有東西還沒
 * 落地」，只有投影帶得動。
 *
 * **點擊之後這一批先不做任何事** —— drawer 是票 03 的範圍（spec.md 的票面）。
 * `onSelect` 因此先宣告介面、接上點擊，但呼叫端（`DecisionApp.tsx`）這一批
 * 還沒有任何 drawer 可開。
 *
 * **這裡沒有自動化測試**（spec.md：React 組件不寫測試）。
 */
export interface DecisionListProps {
  readonly decisions: readonly ProjectedDecision<DecisionView>[];
  readonly onSelect: (id: string) => void;
}

export function DecisionList({ decisions, onSelect }: DecisionListProps): React.JSX.Element {
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {decisions.map((projected) => {
        const decision = projected.shown;
        return (
          <li key={decision.id}>
            <button
              type="button"
              onClick={() => onSelect(decision.id)}
              className="bg-card text-card-foreground hover:bg-accent w-full rounded-md border p-3 text-left shadow-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono text-[10px]">
                  {decision.shortId}
                </span>
                <Badge variant="secondary" className="font-normal">
                  {decision.disposition}
                </Badge>
              </div>
              <div className="mt-1 text-sm leading-snug">{decision.title}</div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
