import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from './types.js';
import { MERGE_RULE, inspectMergeGuarantee } from './gitattributes.js';
import { OP_KINDS, splitGluedLine } from './ops.js';
import { ignoredByGit, inspectSharing, opLogsTracked } from './sharing.js';

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
      message: `${dir} 不在 git work tree 內：merge=union 不會生效`,
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

  // 唯一的單點失效：保證不在，資料就會靜默開始衝突（docs/adr/0001）。
  if (guaranteeMatters) {
    const guarantee = inspectMergeGuarantee(dir);
    if (guarantee.kind === 'absent') {
      found.push({
        kind: 'MissingMergeDriver',
        file: '.gitattributes',
        message: `缺少零衝突保證：${MERGE_RULE}（執行 nook init 補回）`,
      });
    } else if (guarantee.kind === 'conflicting') {
      found.push({
        kind: 'MissingMergeDriver',
        file: '.gitattributes',
        line: guarantee.line,
        message: `這一行讓 op-log 拿不到 merge=union：${guarantee.rule}`,
      });
    }
  }

  // fs 與 git 對「這塊 board 共享了嗎」說了不同的話。一個 kind、兩種狀態，
  // 因為要修的是同一件事：讓兩邊一致。**排在保證那一條之後** —— 唯一的單點
  // 失效仍然排第一，這一條不把它擠下去。
  if (trackedAnyway) {
    found.push({
      kind: 'SharingMismatch',
      message:
        `排除規則在，op-log 卻已經被 git 追蹤：這塊 board 實際上是共享的` +
        `（被追蹤的路徑勝過 ignore 規則），而且沒有零衝突保證 —— 正在靜默累積衝突風險。` +
        `執行 nook share 讓規則與事實一致。`,
    });
  } else if (sharing === 'private' && insideGit) {
    // 第三種：nook 的那一行在（fs 說 private），git 卻說它沒有效果。這是 private
    // mode 裡唯一一種**三個面都沉默**的失敗 —— init 報告成功、list / show 不警告
    // （它們只問得到純 fs 的那一行）、doctor 也把 MissingMergeDriver 壓掉了，而
    // board 整塊在 `git status` 眼前。
    //
    // **這個子行程只在這裡 spawn。** 讀取熱路徑唯一的問法仍然是純 fs 的
    // `inspectSharing`（`run.ts` 的 PATH 探針把那條承諾當閘門在守）。
    if (!ignoredByGit(dir).ignored) {
      found.push({
        kind: 'SharingMismatch',
        message:
          `排除規則在，git 卻說這塊 board 沒有被 ignore：規則沒有效果，` +
          `所以整塊 board 進得了 git —— 下一次 git add -A 就會把它推出去。` +
          `執行 nook init --private 重寫那條規則。`,
      });
    }
  } else if (sharing === 'shared' && insideGit) {
    // 反向的那一種：nook 沒有寫任何規則，git 卻把 op-log 擋在外面。
    // `ignored` 與 `source` 是兩件事：git 說它 ignore 是事實，而我們有沒有可以
    // 引用的來源是另一回事。**答不出那個形狀就閉嘴** —— 這一條的全部價值就是帶著
    // git 自己指出的 `<file>:<line>:<pattern>`，拿一個編不出來的來源拉警報比不
    // 講話更糟（doctor 進 CI，而 PATH 上若有一支什麼都答 true 的假 git，它的輸出
    // 正好是這個形狀對不上的樣子）。
    const { ignored, source } = ignoredByGit(dir);
    if (ignored && source !== null) {
      found.push({
        kind: 'SharingMismatch',
        message:
          `沒有 nook 寫的排除規則，git 卻 ignore 了 op-log：${source}` +
          `。這塊 board 看起來是共享的，同事 clone 下來卻會是空的。` +
          `如果這是刻意的，執行 nook init --private 把它記下來；` +
          `不是的話，把那一條 ignore 規則拿掉。`,
      });
    }
  }

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
            message: `未知的 op 型別 ${kind}：reducer 會忽略這一行（可能需要升級 nook）`,
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
          message: `${glued.length} 個 op 被黏成一行（寫入時缺少 trailing newline），可修復：${excerpt(text)}`,
        });
        continue;
      }

      found.push({
        kind: 'UnparsableLine',
        file: relative,
        line,
        message: `無法解析，reducer 會丟棄這一行：${excerpt(text)}`,
      });
    }
  }

  return found;
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
