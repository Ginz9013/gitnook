import type { BoardInfo } from '@/api';
import { ThemeToggle } from './ThemeToggle';
import { shortenPath } from '@/board/path';

/**
 * 最上層、跨模組固定的那一條 —— logo、「Git Nook」、board 路徑/分支/actor，
 * 加上主題切換。**不管現在切到哪個視圖都畫同一條**，因此從 `BoardHeader.tsx`
 * 搬出來：那裡原本是 Issue 專屬的位置，切到 Decisions 時整條連同這裡的資訊
 * 一起消失，而路徑/分支/actor 講的是「這塊 board 在哪裡」，跟現在看的是
 * Issue 還是 Decision 無關。
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

      <div className="ml-auto flex shrink-0 items-center">
        <ThemeToggle />
      </div>
    </header>
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
