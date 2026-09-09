import type { Diagnostic, DiagnosticKind } from '@/api';

/**
 * 畫面上的一條警示 —— 一條 `Diagnostic` 翻成人讀得懂的一句話加下一步。
 */
export interface BoardAlert {
  /** 是哪一種問題 —— 一種只會有一條，所以它同時是畫面上的 key。 */
  readonly kind: DiagnosticKind;
  /** 我們自己講的那一句：這件事為什麼要緊。 */
  readonly headline: string;
  /** 指到哪裡；說不出來就是 null。 */
  readonly where: string | null;
  /** `diagnose()` 自己說的那句話，原封不動。 */
  readonly said: string;
  /** 同一種問題還有幾條沒列出來；只有一條時是 0。 */
  readonly more: number;
  /** 下一步該打的指令。 */
  readonly fix: string;
}

/**
 * `/api/board-info` 送來的 `Diagnostic`，翻成畫面上該說的那幾條警示。
 *
 * 這是票 B5 裡唯一可判定的規則，所以它住在這裡而不是 `BoardHeader.tsx` 裡 ——
 * 那樣它才測得到（`test/studio/health.test.ts`），同 `board/path.ts`。
 *
 * **core 自己說的那句話原封不動帶著走**（`said`），與我們的話（`headline`）
 * 分開兩格 —— 同 `App.tsx` 的 `StatusBanner` 已經論證過的模型：`diagnose()`
 * 的訊息裡帶著缺的到底是哪一行、黏在一起的是哪個檔案第幾行，那是這一層編不
 * 出來的東西。混成一句就得靠切字串才分得回來，而切字串是猜。
 */
export function boardAlerts(diagnostics: readonly Diagnostic[]): readonly BoardAlert[] {
  const alerts = new Map<DiagnosticKind, BoardAlert>();
  for (const d of diagnostics) {
    // NotAGitRepo 不是警示：nook 不要求 git（AGENT.md）。
    if (d.kind === 'NotAGitRepo') continue;
    // 同一種問題只佔一條：一次沒有 trailing newline 的合併會黏掉整個檔案，
    // 一條一列的話 header 底下會長出幾百條一模一樣的橫幅，把看板推出畫面 ——
    // 而它們的下一步是同一個指令。第一條說得出「長什麼樣」，`more`
    // 說得出「有多大片」，兩者合起來就是人在這一刻需要知道的全部。
    const seen = alerts.get(d.kind);
    if (seen !== undefined) {
      alerts.set(d.kind, { ...seen, more: seen.more + 1 });
      continue;
    }
    const merge = d.kind === 'MissingMergeDriver';
    alerts.set(d.kind, {
      kind: d.kind,
      headline: merge
        ? '這塊 board 的零衝突保證不見了 —— 並行編輯會開始靜默衝突'
        : 'op-log 上有 reducer 讀不動的資料 —— 那幾行的內容現在不算數',
      where: where(d),
      said: d.message,
      more: 0,
      // `init` 補的是 `.gitattributes` 那一行，對已經寫進 op-log 的資料
      // 一點作用都沒有；反過來也一樣。指錯指令的警示條比不講話更糟。
      fix: merge ? 'nook init' : 'nook doctor --fix',
    });
  }
  // `diagnose()` 的順序是它掃描的順序（先 git、再 `.gitattributes`、再逐個
  // op-log），不是嚴重程度的順序。讀的人由上往下讀，而缺了 merge=union 是
  // **接下來每一次合併都會靜默壞掉**（ADR-0001 的唯一單點失效）；黏合行那些
  // 已經發生、而且 `doctor --fix` 修得回來。所以它排第一，其餘維持原順序。
  return [...alerts.values()].sort(
    (a, b) => Number(b.kind === 'MissingMergeDriver') - Number(a.kind === 'MissingMergeDriver'),
  );
}

/**
 * 這一條指到哪裡 —— `.gitattributes`、或 `<op-log>:<行號>`。
 *
 * 行號跟著檔名走：一個 op-log 有上千行，只說檔名等於叫人自己找。兩格都沒有
 * （`diagnose()` 對整塊 board 說的話）就是 null，畫面少畫一格。
 */
function where(d: Diagnostic): string | null {
  if (d.file === undefined) return null;
  return d.line === undefined ? d.file : `${d.file}:${d.line}`;
}
