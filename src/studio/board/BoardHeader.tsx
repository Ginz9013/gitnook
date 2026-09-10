import { ListFilter, TriangleAlert, X } from 'lucide-react';

import type { BoardInfo, Status } from '@/api';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { NewIssueForm, useNewIssueEntry } from './NewIssueForm';
import { boardAlerts } from './health';
import type { BoardAlert } from './health';
import { shortenPath } from './path';

/**
 * 看板最上面那一條 —— 這塊 board 是哪一塊，以及在它上面做得到的四件事。
 *
 * **從 `Board.tsx` 抽出來，是因為接下來還有人要往上加東西**：B5（`.gitattributes`
 * 少了 `merge=union` 的警示）與 B6（依 Label 篩選）都落在這裡。而 `Board.tsx`
 * 同時是 DndContext 的持有者 —— 把版面與拖曳機器塞在同一個檔案裡，改其中一邊
 * 的人就得先讀完另一邊。
 *
 * **這裡沒有自動化測試**（spec.md 的測試策略：React 組件不寫測試、不引入
 * jsdom／@testing-library／playwright）。這個檔案裡可判定的規則都被推出去了 ——
 * 「路徑太長時怎麼縮」在 `board/path.ts`、「一條 `Diagnostic` 該不該講、講什麼、
 * 下一步打哪個指令」在 `board/health.ts`，兩份都有測試
 * （`test/studio/header.test.ts`、`test/studio/health.test.ts`）。
 * 剩下的是版面與接線，用看的就對得完。
 *
 * **不放連線狀態。** 它是 `App.tsx` 的 `StatusBanner`：出事才講話的底部橫幅。
 * 常駐在 header 上的話，那顆號誌 99% 的時間都是綠的，於是沒有人會看它 ——
 * 包括真的紅起來的那一次。
 */
export interface BoardHeaderProps {
  /**
   * `/api/board-info` 的產物；**還沒抓到就是 `null`，不要卡住整個看板**。
   * 路徑與分支是「這是哪一塊 board」的說明，不是看板能不能用的前提。
   */
  readonly info: BoardInfo | null;
  /** 現在畫得出來的張數 —— 已經套過「顯示已封存」**與** Label 篩選的那一份。 */
  readonly visibleCount: number;
  readonly archivedCount: number;
  readonly showArchived: boolean;
  readonly onToggleArchived: () => void;
  /**
   * 這塊 board 上出現過的全部 Label（`board/filter.ts` 的 `allLabels`）——
   * 面板列的就是這一份，**依出現順序、沒有排序**。
   *
   * 它是對**整份投影**算的，不是對現在看得見的那一份：否則勾一個 Label 之後
   * 面板自己會縮水，而使用者正要在同一個面板上勾第二個。
   */
  readonly labels: readonly string[];
  /** 目前勾起來的 Label。**多選之間是 AND** —— 空的就是沒有篩選。 */
  readonly selectedLabels: readonly string[];
  readonly onToggleLabel: (label: string) => void;
  readonly onClearLabels: () => void;
  /**
   * Label 篩選**現在藏起來幾張** —— 已經套過「顯示已封存」之後，再被 Label
   * 篩掉的那些。
   *
   * **這一格是這張票真正的驗收條件**（D12）：篩選不持久化，但只要它生效，
   * header 就必須顯眼地說出「篩選中，N 張被隱藏」並給一鍵清除。一個把 Issue
   * 藏起來、又不說自己藏了東西的畫面，是讓人以為自己弄丟資料的最快方法。
   *
   * 不含被「顯示已封存」藏起來的那些 —— 那是另一個維度，它有自己那顆按鈕上
   * 的 `（N）` 在說話。兩個維度各自交代自己藏了什麼，合起來算就沒有人說得出
   * 哪一半是誰藏的。
   */
  readonly hiddenByLabel: number;
  /**
   * 開一張新的 Issue。**不帶 `status`** —— header 這顆問的是「開一張」，不是
   * 「在哪一欄開一張」，落點由 core 的預設回答（`api.ts` 的 `createIssue`）。
   *
   * 票面原本寫的是 `onNew: () => void`。改成這一格，是因為 A8 之後「新增入口」
   * 不只是一顆按鈕：它是按鈕**加上**一條開在旁邊的輸入框，而兩者之間還有一條
   * 焦點規則（`useNewIssueEntry`：表單關掉時焦點回到開它的那顆按鈕）。
   * 只傳一個 `onNew` 就得把那份狀態留在 `Board.tsx` 上，然後把 `ref` 與
   * `aria-expanded` 一路傳下來 —— 少接一條，鍵盤使用者按 Esc 之後焦點就掉回
   * `<body>`，而畫面上看不出任何異狀。
   */
  readonly onCreate: (title: string, status: Status | undefined) => Promise<boolean>;
}

/**
 * 路徑縮到幾個字。
 *
 * 沒有可以引用的權威值，這是一個版面判斷：mono 小字 48 個字約 300px，而
 * header 上這一行的左邊只有 logo 與文字 logo。取大一點，因為縮掉的每一段都是
 * 使用者本來看得到的資訊 —— 縮短的目的是不要擠掉右邊那四個動作，不是好看。
 */
const MAX_PATH = 48;

export function BoardHeader({
  info,
  visibleCount,
  archivedCount,
  showArchived,
  onToggleArchived,
  labels,
  selectedLabels,
  onToggleLabel,
  onClearLabels,
  hiddenByLabel,
  onCreate,
}: BoardHeaderProps): React.JSX.Element {
  // 新增入口的開關與焦點。**住在這裡而不是 `Board.tsx`**：八欄各自還有一個，
  // 各自獨立開合，而這一個屬於 header（`NewIssueForm.tsx` 的 `useNewIssueEntry`）。
  const entry = useNewIssueEntry();

  // 這塊 board 的資料健康 —— `/api/board-info` 已經把 `diagnostics` 送來了
  // （票 B1），這裡只是把它翻成人讀得懂的話（`board/health.ts`）。
  // `info` 還沒到就是空的，健康的 board 也是空的：**沒事就一個字都不畫**。
  const alerts = boardAlerts(info?.diagnostics ?? []);

  /** 篩選現在生效中嗎。空的 `selectedLabels` 就是沒有篩選（`matchesLabels` 同一條）。 */
  const filtering = selectedLabels.length > 0;

  return (
    // `<header>` 而已 —— **不要再包一層 landmark**。`Board.tsx` 的 `<main>` 已經
    // 有 `aria-label="Nook 看板"`，那是焦點的最後退路（`board/focus.ts`）：多一個
    // landmark 會讓那條退路把使用者丟到一個沒有名字的地方。
    <header className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center gap-3">
        {/*
          logo 佔位 —— 一個方塊裡放字標 `gN`（gitnook），日後換成真的圖。
          `aria-hidden` 連同裡面那兩個字母：它旁邊就寫著「Git Nook」，讀出來
          只會是同一件事講兩次，而 `gN` 唸起來還更糟。

          方塊是 `size-10.5`（42px = 原本 `size-7` 的 1.5 倍）。**它現在比旁邊
          那兩行字（36px）高，於是這一列的高度由它決定** —— `BoardSkeleton`
          裡的方塊必須是同一個尺寸，否則資料到達時整條看板會往下跳 6px。
        */}
        <div
          aria-hidden
          className="bg-primary text-primary-foreground flex size-10.5 shrink-0 items-center justify-center rounded-md text-sm leading-none font-semibold tracking-tight"
        >
          gN
        </div>

        <div className="flex min-w-0 flex-col justify-center">
          <span className="text-sm leading-tight font-semibold tracking-tight">Git Nook</span>

          {/*
            board 路徑 · 分支 · actor。`info` 還沒到就整條不畫 —— 佔位的骨架比
            空白更吵，而它遲到的那幾十毫秒沒有人在等。
          */}
          {info !== null && (
            // `overflow-wrap: anywhere`：視窗窄到這一行擺不下時，它折到第二行，
            // **而不是壓在右邊那組動作底下**（`min-w-0` 讓這一塊縮得比內容小，
            // 縮小之後不折行的文字會整條溢出去）。路徑是一個沒有空白的長字串，
            // 所以只有 `anywhere` 折得動它 —— 而折行不會丟掉任何一段，
            // 從尾端裁掉才會（那正是 `shortenPath` 存在的理由）。
            <p className="text-muted-foreground font-mono text-[11px] leading-tight [overflow-wrap:anywhere]">
              {/*
                看得到的是縮過的，唸出來與滑過去的是完整的那一條 —— 縮短是版面的
                事，不該讓螢幕閱讀器與滑鼠使用者也拿不到真正的路徑。
              */}
              <span aria-label={`board 路徑：${info.root}`} title={info.root}>
                {shortenPath(info.root, MAX_PATH)}
              </span>
              {/*
                分支說不出來（不是 git repo、detached HEAD、還沒有第一次提交）時
                **整格不畫**，而不是寫一個破折號：那三種情況都是正常的工作狀態，
                畫面上多一格「分支：—」只會讓人以為出了事。
              */}
              {info.branch !== null && (
                <>
                  <Separator />
                  <span aria-label={`分支：${info.branch}`}>{info.branch}</span>
                </>
              )}
              <Separator />
              {/*
                Actor 一定要有可及的說明，而且 `title` 不夠 —— 鍵盤與螢幕閱讀器
                使用者碰不到 hover。它**不是負責人**：Nook 沒有負責人的概念
                （CONTEXT.md），這個名字的意思是「你在這裡寫的每一個 op 記在誰
                身上」（ADR-0007）。少了這句話，畫面上一個孤零零的人名只會被讀成
                「這塊板子是他的」。
              */}
              <span
                aria-label={`你在這裡寫的變更都記在 ${info.actor} 名下；這不是負責人，Nook 沒有負責人的概念`}
              >
                {info.actor}
              </span>
            </p>
          )}
        </div>

        {/* 左邊那一塊有多長由路徑決定，所以右邊那組靠 `ml-auto` 推過去。 */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">{visibleCount} 張 Issue</span>

          <Button {...entry.trigger} type="button" size="sm">
            新增 Issue
          </Button>

          {/*
            依 Label 篩選（B6）。**一張 Label 都沒有的 board 上不畫它** —— 同
            下面那顆「顯示已封存」的理由：不要在畫面上放一個按下去只會開出一片
            空白的東西。

            用 `DropdownMenuCheckboxItem` 而不是自己做一個面板：多選、鍵盤操作、
            `aria-checked` 與焦點迴圈 Radix 都處理好了，而這個檔案沒有自動化
            測試（見上面），所以自己寫的每一條互動都只能用看的驗收。
          */}
          {labels.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={filtering ? 'default' : 'ghost'}
                  size="sm"
                  aria-label={
                    filtering
                      ? `依 Label 篩選，篩選中：${selectedLabels.join('、')}`
                      : '依 Label 篩選'
                  }
                >
                  <ListFilter aria-hidden className="size-4" />
                  篩選
                  {/*
                    勾了幾個。**數字畫在按鈕上**，因為面板關起來之後它是唯一
                    還留在畫面上的痕跡 —— 下面那條說明列講的是「藏了幾張」，
                    那是另一件事。
                  */}
                  {filtering && `（${selectedLabels.length}）`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                <DropdownMenuLabel>依 Label 篩選（越加越窄）</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {labels.map((label) => (
                  <DropdownMenuCheckboxItem
                    key={label}
                    checked={selectedLabels.includes(label)}
                    // 勾一個不該把面板關掉 —— 多選的意思就是接著還要勾第二個。
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => onToggleLabel(label)}
                  >
                    <span className="[overflow-wrap:anywhere]">{label}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/*
            一張都沒有封存過的 board 上，這顆按鈕切的是一個空集合。不畫它不是省
            空間，是不要在畫面上放一個按下去什麼都不會發生的東西。
          */}
          {archivedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={showArchived}
              onClick={onToggleArchived}
            >
              {showArchived ? '隱藏已封存' : `顯示已封存（${archivedCount}）`}
            </Button>
          )}

          {/*
            主題切換從右上角那個 `fixed` 的殼搬進來（`main.tsx`）。那是批 A 知情的
            兩步：批 A 要能切主題，而 header 是這張票的事。
          */}
          <ThemeToggle />
        </div>
      </div>

      {/*
        表單開在整條 header 的下面一列而不是按鈕旁邊：右邊那組動作橫向已經滿了，
        硬塞一條輸入框進去會把主題切換擠出畫面。`useNewIssueEntry` 交出的是兩塊
        零件（trigger 與 close）而不是一個組件，正是為了讓呼叫端這樣擺。
      */}
      {entry.open && (
        <NewIssueForm onCreate={onCreate} onCancel={entry.close} className="w-72 self-end" />
      )}

      {/*
        **篩選中的那條說明 —— 這張票真正的驗收條件**（D12），不是上面那個面板。

        篩選不持久化，所以它活不過重新整理；但只要它生效，畫面上就少了東西，
        而少掉的東西看起來與「不見了」一模一樣。這條說明把三件事同時講出來：
        正在篩什麼、藏了幾張、以及怎麼還原。

        `role="status"` 而不是 `role="alert"`：這是使用者自己按出來的狀態，
        不是壞消息 —— `alert` 會打斷正在唸的內容，而下面那條 `.gitattributes`
        的警示才該有那個權力。
      */}
      {filtering && (
        <div
          role="status"
          className="border-primary bg-primary/10 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-sm"
        >
          <ListFilter aria-hidden className="text-primary size-4 shrink-0" />
          <span className="font-medium">篩選中</span>
          <span className="[overflow-wrap:anywhere]">
            {/*
              「以及」不是「或」—— 多選之間是 AND（`filter.ts`）。把它寫在畫面上，
              使用者才不會把兩個勾勾讀成「這兩種都給我看」。
            */}
            同時帶著 <span className="font-mono font-semibold">{selectedLabels.join(' + ')}</span>
          </span>
          {/*
            **藏了幾張**。一張都沒藏時照樣講（「沒有藏起任何一張」）——
            只在 N > 0 時出現的話，使用者會學會「沒看到這句就是沒在篩選」，
            而那正好是這條說明最需要否認的事。
          */}
          <span className="text-muted-foreground">
            {hiddenByLabel > 0
              ? `${hiddenByLabel} 張被隱藏`
              : '沒有藏起任何一張（另外被封存藏起來的不算在內）'}
          </span>
          {/*
            一鍵清除。`ml-auto` 推到最右邊，跟上面那組動作對齊 —— 出路要永遠
            在同一個地方。
          */}
          <Button variant="outline" size="sm" className="ml-auto" onClick={onClearLabels}>
            <X aria-hidden className="size-4" />
            清除篩選
          </Button>
        </div>
      )}

      {/*
        資料健康的警示條。**只在有問題時出現** —— 一個永遠在那裡的健康指示器
        99% 的時間都是綠的，於是沒有人會讀它，包括真的紅起來的那一次
        （同一個理由讓連線狀態留在 `App.tsx` 的底部橫幅，見上面的註解）。

        排在整條 header 的最下面：它出現時會把看板往下推，而那正是要的效果 ——
        `.gitattributes` 少了 `merge=union` 是整個系統的唯一單點失效（ADR-0001），
        資料正在靜默地走向衝突，那件事比再多看兩張卡片重要。
      */}
      {alerts.map((alert) => (
        <AlertBar key={alert.kind} alert={alert} />
      ))}
    </header>
  );
}

/**
 * 一條警示 —— 我們的一句話、`diagnose()` 的原話、以及下一步那個指令。
 *
 * 三件事分三行而不是併成一句：**下一步是使用者要打的字**，它得看得出來是一段
 * 指令而不是散文的一部分。`said` 用 mono，因為它裡面帶著檔名、行號與
 * `.issues/issues/*.ndjson merge=union` 那一行 —— 那些是原文，不是描述。
 *
 * `role="alert"`：這件事不能等到使用者剛好往上看才發現。dnd-kit 的拖曳播報有
 * 自己的 live region，而這一條只在開場那份 `/api/board-info` 到達時出現一次
 * （`App.tsx` 不把它放進輪詢迴圈），插不到拖曳的隊。
 */
function AlertBar({ alert }: { readonly alert: BoardAlert }): React.JSX.Element {
  return (
    <div
      role="alert"
      className="bg-destructive text-destructive-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{alert.headline}</span>
        <span className="font-mono text-xs [overflow-wrap:anywhere] opacity-90">
          {alert.where !== null && `${alert.where}　`}
          {alert.said}
          {/*
            同一種問題只列第一條（`health.ts`）。剩下幾條要說出來，否則修完
            第一條的人會以為修完了 —— `nook doctor` 印的是全部。
          */}
          {alert.more > 0 && `（另外還有 ${alert.more} 條同樣的問題）`}
        </span>
        <span className="text-xs">
          下一步：在 repo 根目錄跑 <code className="font-mono font-semibold">{alert.fix}</code>
        </span>
      </div>
    </div>
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
