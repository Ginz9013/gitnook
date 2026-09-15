import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from './types.js';
import { MERGE_RULE, inspectMergeGuarantee, DECISIONS_DIR, DECISION_MERGE_RULE, DECISION_LOG_SAMPLE } from './gitattributes.js';
import { OP_KINDS, splitGluedLine } from './ops.js';
import { ignoredByGit, inspectSharing, opLogsTracked, overridingRule } from './sharing.js';

/**
 * 資料健康診斷。彙整成一份 Diagnostic 清單：merge=union 那條唯一支柱是否還在、
 * 黏合行（ADR-0001 硬規則 1）、未知的 op 型別（硬規則 2）、以及真正無法解析的行。
 */
export function diagnose(dir: string): Diagnostic[] {
  const found: Diagnostic[] = [];

  // .gitattributes 只在 git 底下生效，不是 repo 就沒有零衝突保證可言。
  const insideGit = isInsideGitWorkTree(dir);
  if (!insideGit) {
    found.push({
      kind: 'NotAGitRepo',
      message: `${dir} is not inside a git work tree: merge=union will not take effect`,
    });
  }

  // **零衝突保證在 private board 上是「不需要」，不是「缺少」** —— 被 ignore 的
  // op-log 永遠不會 merge。所以這裡的沉默不是壓掉一個真問題，是那個問題在這個
  // 模式下不存在。而 doctor 會進 CI，所以正確行為是沉默，不是換一句溫和的提醒。
  //
  // **兩個條件都成立才沉默。** 只靠 inspectSharing（純 fs 的那一行在不在）就
  // 閉嘴，會在「排除規則在、檔案卻被 git add -f 進去了」時漏掉一個真問題：那塊
  // board 實際上是共享的，而且真的沒有那條規則。index 才是共享狀態的權威
  // （**tracked 勝過 ignore 規則**，理由見 `opLogsTracked`），所以它有否決權。
  // 那種矛盾狀態自己要說什麼話，見下面的 `SharingMismatch`；這裡只保證它不被壓掉。
  //
  // **index 只在 fs 已經答 private 時才問。** `git ls-files` 是一個子行程，而
  // doctor 本來就 spawn 一個 git rev-parse。**這個子行程絕不得進入讀取熱路徑**
  // —— list / show 唯一的問法是純 fs 的 inspectSharing。
  const sharing = inspectSharing(dir);
  const trackedAnyway = sharing === 'private' && opLogsTracked(dir);
  const guaranteeMatters = sharing === 'shared' || trackedAnyway;

  // 已知會有零衝突保證需求的實體 pattern，逐一問 merge=union 齊不齊 ——
  // 不是硬編一個 pattern，日後第三種實體只需要在這裡加一筆。**閘門刻意不共用**：
  // Issue 有 private 模式（沒有 marker 目錄存在與否不代表保證不需要，保證需不需要
  // 問的是 sharing），Decision 沒有（票 01 只支援 shared），所以它的閘門直接是
  // marker 目錄在不在——`.decisions/` 不存在時這個診斷在這個 repo 裡「不存在」，
  // 不是被壓掉的真問題（同 private-mode 的既有哲學）。
  const knownEntities: readonly MergeGuaranteeEntity[] = [
    // 唯一的單點失效：保證不在，資料就會靜默開始衝突（decision legacyRef 0001，`nook decision show 0001`）。
    { active: guaranteeMatters, rule: MERGE_RULE, initHint: 'nook init' },
    // Decision 用同一套機制，這條規則對它同樣成立——只是換一組 rule/sample/init 指令。
    {
      active: existsSync(join(dir, ...DECISIONS_DIR)),
      sample: DECISION_LOG_SAMPLE,
      rule: DECISION_MERGE_RULE,
      initHint: 'nook decision init',
    },
  ];
  for (const entity of knownEntities) {
    found.push(...mergeGuaranteeDiagnostics(dir, entity));
  }

  found.push(...sharingMismatches(dir, sharing, trackedAnyway, insideGit));

  for (const name of opLogNames(dir)) {
    const relative = `${ISSUES_DIR}/${name}`;
    for (const [line, text] of numberedLines(readFileSync(join(dir, ISSUES_DIR, name), 'utf8'))) {
      if (isParsable(text)) {
        // 向前相容是資料安全問題（ADR-0001 硬規則 2）：reducer 靜默忽略未知 op，
        // 所以 doctor 必須把它說出來，否則使用者只會看到欄位莫名其妙沒生效。
        const kind = opKindOf(text);
        if (kind !== null && !OP_KINDS.has(kind)) {
          found.push({
            kind: 'UnknownOp',
            file: relative,
            line,
            message: `unknown op kind ${kind}: the reducer will ignore this line (you may need to upgrade nook)`,
          });
        }
        continue;
      }

      // 黏合行不是壞掉的資料，是還原得回來的資料 —— 分開回報，doctor 才能修復。
      const glued = splitGluedLine(text);
      if (glued !== null) {
        found.push({
          kind: 'GluedLine',
          file: relative,
          line,
          message: `${glued.length} ops glued into one line (a write was missing its trailing newline), repairable: ${excerpt(text)}`,
        });
        continue;
      }

      found.push({
        kind: 'UnparsableLine',
        file: relative,
        line,
        message: `unparsable, the reducer will drop this line: ${excerpt(text)}`,
      });
    }
  }

  return found;
}


/**
 * fs 與 git 對「這塊 board 共享了嗎」說了不同的話。**一個 kind、三種狀態**，
 * 因為要修的是同一件事：讓兩邊一致。呼叫端把它排在零衝突保證那一條之後 ——
 * 唯一的單點失效仍然排第一，這一條不把它擠下去。
 *
 * 三種狀態的子行程都只在這裡 spawn，而且每一種只問它自己需要的那一個 ——
 * 健康的 board 一個都不多付。讀取熱路徑唯一的問法仍然是純 fs 的 `inspectSharing`
 * （`run.ts` 的 PATH 探針把那條承諾當閘門在守）。
 */
function sharingMismatches(
  dir: string,
  sharing: 'shared' | 'private',
  trackedAnyway: boolean,
  insideGit: boolean,
): Diagnostic[] {
  if (trackedAnyway) {
    return [
      {
        kind: 'SharingMismatch',
        message:
          `the exclude rule is present, but the op-log is already tracked by git: this board is ` +
          `actually shared (a tracked path beats an ignore rule), and it has no zero-conflict ` +
          `guarantee — conflict risk is silently accumulating. Run nook share to make the rule match reality.`,
      },
    ];
  }

  if (!insideGit) return [];

  if (sharing === 'private') {
    // nook 的那一行在（fs 說 private），git 卻說它沒有效果。這是 private mode 裡
    // 唯一一種**三個面都沉默**的失敗 —— init 報告成功、list / show 不警告（它們
    // 只問得到純 fs 的那一行）、doctor 也把 MissingMergeDriver 壓掉了，而 board
    // 整塊在 `git status` 眼前。
    if (ignoredByGit(dir).ignored) return [];

    // **下一步不能是「重跑 init --private」。** 這個狀態最常見的成因是一條優先序
    // 更高的否定規則（committed 的 `!.issues/` 壓過 `$GIT_DIR/info/exclude`），
    // 而那時我們那一行**已經在了** —— `init --private` 會回 unchanged、什麼都不動，
    // 使用者照做之後 doctor 再說一次同一句話，永遠。所以問 git 是誰壓過它，並把
    // 那一行指出來；指不出來時就說指不出來，同 `share` 的做法。
    const rule = overridingRule(dir);
    const why =
      rule === null
        ? `and git cannot point at which rule overrides it — run ` +
          `git check-ignore -v --non-matching "${dir}/.issues" yourself to find it.`
        : `your line is being overridden by ${rule} — remove or adjust that rule (nook only ever ` +
          `touches its own line), then run nook doctor again to confirm.`;
    return [
      {
        kind: 'SharingMismatch',
        message:
          `the exclude rule is present, but git says this board is not ignored: the rule has no ` +
          `effect, so the whole board can enter git — the next git add -A will push it in. ${why}`,
      },
    ];
  }

  // 反向的那一種：nook 沒有寫任何規則，git 卻把 op-log 擋在外面。
  // `ignored` 與 `source` 是兩件事：git 說它 ignore 是事實，而我們有沒有可以引用的
  // 來源是另一回事。**答不出那個形狀就閉嘴** —— 這一條的全部價值就是帶著 git 自己
  // 指出的 `<file>:<line>:<pattern>`，拿一個編不出來的來源拉警報比不講話更糟
  // （doctor 進 CI，而 PATH 上若有一支什麼都答 true 的假 git，它的輸出正好是這個
  // 形狀對不上的樣子）。
  const { ignored, source } = ignoredByGit(dir);
  if (!ignored || source === null) return [];
  return [
    {
      kind: 'SharingMismatch',
      message:
        `there is no exclude rule written by nook, but git is ignoring the op-log: ${source}` +
        `. This board looks shared, but a colleague's clone would be empty. ` +
        `If this is intentional, run nook init --private to record it; ` +
        `if not, remove that ignore rule.`,
    },
  ];
}

/**
 * 「已知實體 pattern 清單」裡的一筆——`inspectMergeGuarantee` 需要知道的那三件事
 * （比對用的 sample、報告用的 rule 文字、修復指令），加上這一筆現在算不算數
 * （`active`：Issue 問 sharing，Decision 問 marker 目錄在不在，見呼叫端）。
 */
interface MergeGuaranteeEntity {
  readonly active: boolean;
  /** undefined 時 `inspectMergeGuarantee` 用它自己的預設 sample（Issue 那條）。 */
  readonly sample?: string;
  readonly rule: string;
  readonly initHint: string;
}

/** 一筆實體的零衝突保證診斷；`active` 是 false 或保證本來就在時回傳 []。 */
function mergeGuaranteeDiagnostics(dir: string, entity: MergeGuaranteeEntity): Diagnostic[] {
  if (!entity.active) return [];

  const guarantee = inspectMergeGuarantee(dir, entity.sample);
  if (guarantee.kind === 'union') return [];
  if (guarantee.kind === 'absent') {
    return [
      {
        kind: 'MissingMergeDriver',
        file: '.gitattributes',
        message: `missing the zero-conflict guarantee: ${entity.rule} (run ${entity.initHint} to restore it)`,
      },
    ];
  }
  return [
    {
      kind: 'MissingMergeDriver',
      file: '.gitattributes',
      line: guarantee.line,
      message: `this line keeps the op-log from getting merge=union: ${guarantee.rule}`,
    },
  ];
}

/** 一條被還原回來的黏合行。 */
export interface Repair {
  readonly file: string;
  readonly line: number;
  /** 這一行還原出幾個 op。 */
  readonly ops: number;
}

/**
 * 把黏合行還原成多行。**只拆行，不做任何語意判斷** ——
 * union merge 複製出來的重複 op 交給 reduce 的 dedupe by id 吸收，
 * 修復不該替使用者決定哪個 op 該留下。
 */
export function repair(dir: string): Repair[] {
  const done: Repair[] = [];

  for (const name of opLogNames(dir)) {
    const path = join(dir, ISSUES_DIR, name);
    const relative = `${ISSUES_DIR}/${name}`;
    const out: string[] = [];
    let changed = false;

    for (const [line, text] of numberedLines(readFileSync(path, 'utf8'))) {
      const glued = isParsable(text) ? null : splitGluedLine(text);
      if (glued === null) {
        out.push(text);
        continue;
      }
      out.push(...glued);
      done.push({ file: relative, line, ops: glued.length });
      changed = true;
    }

    // 修好的檔案自己也必須守住硬規則 1，否則下一次 merge 又黏起來。
    if (changed) writeFileSync(path, out.map((l) => `${l}\n`).join(''), 'utf8');
  }

  return done;
}

const ISSUES_DIR = '.issues/issues';

function opLogNames(dir: string): string[] {
  const path = join(dir, ISSUES_DIR);
  if (!existsSync(path)) return [];
  // 排序讓 doctor 的輸出穩定，不隨檔案系統的回傳順序漂移。
  return readdirSync(path).filter((name) => name.endsWith('.ndjson')).sort();
}

/** 以 1 為起點編號；尾端換行後的空字串不是一行。 */
function numberedLines(content: string): Array<[number, string]> {
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((text, i) => [i + 1, text]);
}

/**
 * 刻意不借用 ops.parseLine：那裡的職責是「取出 Op」，日後收緊成只認識已知 Op 型別時，
 * 未知 Op 會被誤報成無法解析 —— 而未知 Op 是另一種 Diagnostic（票 05）。
 */
function isParsable(text: string): boolean {
  if (text.trim() === '') return true;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** 已知可解析的行的 op 欄位。不是物件、或 op 不是字串時回傳 null。 */
function opKindOf(text: string): string | null {
  if (text.trim() === '') return null;
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const op = (parsed as { op?: unknown }).op;
  return typeof op === 'string' ? op : null;
}

function excerpt(text: string): string {
  return text.length <= 60 ? text : `${text.slice(0, 60)}…`;
}

function isInsideGitWorkTree(dir: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}
