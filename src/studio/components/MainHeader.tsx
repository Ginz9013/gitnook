import type { BoardInfo, Sharing } from '@/api';
import { ThemeToggle } from './ThemeToggle';
import { shortenPath } from '@/board/path';

/**
 * 最上層、跨模組固定的那一條 —— logo、「Git Nook」、board 路徑/分支/actor，
 * 加上 Sharing／Workspace 狀態徽章與主題切換。**不管現在切到哪個視圖都畫
 * 同一條**，因此從 `BoardHeader.tsx` 搬出來：那裡原本是 Issue 專屬的位置，
 * 切到 Decisions 時整條連同這裡的資訊一起消失，而路徑/分支/actor/狀態講的
 * 是「這塊 board 在哪裡、現在是什麼狀態」，跟現在看的是 Issue 還是 Decision
 * 無關。
 *
 * `ThemeToggle` 也從 `BoardHeader.tsx` 的右側動作群搬過來 ——那顆按鈕是
 * 全域偏好，不是 Issue 的功能，留在會被整個取代的模組 header 裡意味著切到
 * Decisions 就切不了主題。
 *
 * **這裡沒有自動化測試**（spec.md 的測試策略：React 組件不寫測試）。
 * 可判定的規則（路徑縮短）在 `board/path.ts`，那裡有測試。
 */
export interface MainHeaderProps {
  /**
   * `/api/board-info` 的產物；**還沒抓到就是 `null`，不要卡住畫面**。
   * 路徑與分支是「這是哪一塊 board」的說明，不是能不能用的前提。
   */
  readonly info: BoardInfo | null;
}

/** 同 `BoardHeader.tsx` 原本的既有理由：mono 小字的可用寬度不大。 */
const MAX_PATH = 48;

export function MainHeader({ info }: MainHeaderProps): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
      {/*
        logo 佔位 —— 一個方塊裡放字標 `gN`（gitnook），日後換成真的圖。
        `aria-hidden`：它旁邊就寫著「Git Nook」，讀出來只會是同一件事講兩次。
      */}
      <div
        aria-hidden
        className="bg-primary text-primary-foreground flex size-10.5 shrink-0 items-center justify-center rounded-md text-sm leading-none font-semibold tracking-tight"
      >
        gN
      </div>

      <div className="flex min-w-0 flex-col justify-center">
        <span className="text-sm leading-tight font-semibold tracking-tight">Git Nook</span>

        {/* board 路徑 · 分支 · actor。`info` 還沒到就整條不畫。 */}
        {info !== null && (
          <p className="text-muted-foreground font-mono text-[11px] leading-tight [overflow-wrap:anywhere]">
            <span aria-label={`board path: ${info.root}`} title={info.root}>
              {shortenPath(info.root, MAX_PATH)}
            </span>
            {info.branch !== null && (
              <>
                <Separator />
                <span aria-label={`branch: ${info.branch}`}>{info.branch}</span>
              </>
            )}
            <Separator />
            <span
              aria-label={`changes you make here are recorded under ${info.actor}; this is not an owner — Nook has no concept of ownership`}
            >
              {info.actor}
            </span>
          </p>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {info !== null && (
          <>
            <StatusPill label={info.sharing === 'private' ? 'Private' : 'Shared'} tone={info.sharing} />
            <StatusPill
              label={info.fromWorkspace ? 'Workspace' : 'Standalone'}
              tone={info.fromWorkspace ? 'workspace' : 'standalone'}
            />
          </>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

/** `StatusPill` 的四種底色，各對應一種狀態；純視覺分類，不是第四種資料。 */
type PillTone = Sharing | 'workspace' | 'standalone';

const PILL_TONE_CLASSES: Record<PillTone, string> = {
  // shared / standalone 是預設狀態，用跟背景融的中性色——不需要被注意到。
  shared: 'bg-muted text-muted-foreground',
  standalone: 'bg-muted text-muted-foreground',
  // private / workspace 是偏離預設的那一側，值得多一點對比讓眼睛抓得到。
  private: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  workspace: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
};

/**
 * 一塊小圓角徽章，畫這塊 board 目前的 Sharing 狀態或這個 studio 是不是
 * workspace 成員。**兩者一律常駐顯示**，不是只在偏離預設值時才出現——
 * 使用者不必先記住「沒寫出來就是 shared / standalone」才看得懂畫面。
 */
function StatusPill({ label, tone }: { readonly label: string; readonly tone: PillTone }): React.JSX.Element {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] leading-tight font-medium whitespace-nowrap ${PILL_TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

/** 那一行 mono 小字裡的分隔點。`aria-hidden`：唸出來是噪音。 */
function Separator(): React.JSX.Element {
  return (
    <span aria-hidden className="px-1.5 opacity-60">
      ·
    </span>
  );
}
