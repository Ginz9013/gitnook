import { useState } from 'react';
import { XIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { addLabelChange, removeLabelChange } from './changes';
import type { DrawerChange } from './changes';

export interface LabelEditorProps {
  readonly labels: readonly string[];
  /** 這份集合還在飛（尚未被伺服器確認）。 */
  readonly pending: boolean;
  readonly onSubmit: (change: DrawerChange | undefined) => boolean;
}

/**
 * Label 的增減。add 與 remove 各自是一份 Change，因為它們是兩個獨立的意圖 ——
 * core 對 remove 會去查「此刻觀察到的全部 add tag」（add-wins），把兩者塞進
 * 同一份 Change 只會讓那個語意更難讀。
 */
export function LabelEditor({ labels, pending, onSubmit }: LabelEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState('');

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', pending && 'opacity-70')}>
      {labels.map((label) => (
        <Badge key={label} variant="secondary" className="gap-1 pr-1">
          {label}
          <button
            type="button"
            aria-label={`移除 label ${label}`}
            className="hover:text-destructive rounded-xs opacity-60 hover:opacity-100"
            onClick={() => onSubmit(removeLabelChange(label))}
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}

      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          // 空字串與已經掛著的 label 都判定為「沒有東西要送」（changes.ts）——
          // op-log 是 append-only，重複的 add 會永久留在 .ndjson 裡。
          if (onSubmit(addLabelChange(draft, labels))) setDraft('');
        }}
      >
        <input
          value={draft}
          aria-label="新增 label"
          placeholder="+ label"
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-6 w-24 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-[3px]"
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" size="sm" variant="ghost" className="h-6 px-2 text-xs">
          新增
        </Button>
      </form>
    </div>
  );
}
