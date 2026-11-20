import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ConflictingGitAttributes,
  NestedBoard,
  ensureGuaranteeRule,
  findNookRoot,
  inspectMergeGuarantee,
} from './gitattributes.js';
import { readNookConfig, writeNookConfig } from './nookConfig.js';
import { OP_LOG_MODULES } from './opLogModules.js';
import type { OpLogModule } from './opLogModules.js';
import { splitGluedLine } from './ops.js';
import {
  AlreadySharedBoard,
  excludeBoard,
  ignoredByGit,
  inspectSharing,
  opLogsTracked,
  overridingRule,
  unexcludeBoard,
} from './sharing.js';
import type { Sharing } from './sharing.js';
import type { Diagnostic } from './types.js';

/**
 * Container：一個 `.gitnook/` 目錄與其中全部 Op-log 模組的單位（CONTEXT.md）。
 *
 * 這個 module 回答整個容器的事 —— init、share、零衝突保證在這個 Sharing 下
 * 需不需要／在不在、每個 Op-log 的逐行健康與修復。**呼叫端從不列舉模組**：
 * 「容器裡有哪些 Op-log」只活在 `OP_LOG_MODULES`，第三種實體只需要在那裡加一筆。
 *
 * 為什麼要收在一起：同一個問題（「這個模組的 merge=union 需要嗎、在嗎」）原本由
 * 五處各自回答，閘門各寫各的 —— private board 上誤報 decisions 缺規則、
 * `share` 只補 Issue 規則，都是其中一處漏改。Sharing 以整個容器為單位，
 * 所以回答它的也只能有一處。
 */

/** init / share 這次替 `.gitattributes` 寫下的一條規則。 */
export interface RuleWrite {
  readonly rule: string;
  /** `created`：.gitattributes 是這次才有的；`added`：補進一個本來就在的檔案。 */
  readonly outcome: 'created' | 'added';
}

export interface InitResult {
  readonly issues: 'created' | 'unchanged';
  readonly decisions: 'created' | 'unchanged';
  /** 這次寫下的 merge=union 規則，依 `OP_LOG_MODULES` 的順序。private 模式恆為空。 */
  readonly rules: readonly RuleWrite[];
  readonly workspace: 'enabled' | 'unchanged';
  readonly sharing: Sharing;
}

/**
 * `nook init [--private] [--workspace]` 的唯一入口 —— 一次把容器裡每個 Op-log
 * 模組都準備好（新建或補齊，冪等），可選擇 private（整個 `.gitnook/` 不進 git
 * 追蹤）與 workspace（遞迴掃描時繼續往下鑽，見 `workspace.ts` 的 `scan()`）。
 *
 * **所有拒絕都排在任何寫入之前**：NestedBoard、private 的 AlreadySharedBoard／
 * NoGitDir、shared 的 ConflictingGitAttributes（每一條規則都先檢查完）。反過來
 * 的話，拒絕會留下一個半初始化的容器，而使用者以為指令失敗了。
 */
export function initNook(
  dir: string,
  opts?: { readonly sharing?: Sharing; readonly workspace?: boolean },
): InitResult {
  const here = resolve(dir);

  const enclosing = findNookRoot(here);
  if (enclosing.found && enclosing.root !== here) throw new NestedBoard(here, enclosing.root);

  // 預設值收在一處：`undefined`、`{}`、`{ sharing: 'shared' }` 是同一件事的三種
  // 寫法，分散比對會讓日後多出來的第三個 Sharing 值靜默走進 shared 那一條。
  const sharing: Sharing = opts?.sharing ?? 'shared';

  if (sharing === 'private') {
    // op-log 已被追蹤就是「這塊 board 已經共享出去了」，而 **index 勝過 ignore
    // 規則**：照寫排除規則是一個完全沒有效果的動作（理由見 `opLogsTracked`）。
    // 這是 init 這條路徑唯一 spawn git 的地方。
    //
    // 刻意**完全不碰 .gitattributes**，連讀都不讀：被 ignore 的 op-log 永遠不會
    // merge，所以 merge 規則在這個模式下無意義，既有的 conflicting 規則同樣無意義。
    if (opLogsTracked(here)) throw new AlreadySharedBoard(here);
    // 不在 git work tree 內時這裡丟 NoGitDir，同樣在 mkdir 之前。
    excludeBoard(here);
    return {
      ...createModuleDirs(here),
      rules: [],
      workspace: applyWorkspace(here, opts?.workspace),
      sharing: 'private',
    };
  }

  const file = join(here, '.gitattributes');
  for (const module of OP_LOG_MODULES) {
    const guarantee = inspectMergeGuarantee(here, module.sample);
    if (guarantee.kind === 'conflicting') {
      throw new ConflictingGitAttributes(file, guarantee.line, guarantee.rule, module.rule);
    }
  }

  // 「建立」還是「補進」是相對於**這一次 init 之前**的檔案說的：檔案是這次才有的，
  // 裡面每一條都是我建的，不是第一條建、其餘補。
  const fileExisted = existsSync(file);
  const dirs = createModuleDirs(here);
  const rules: RuleWrite[] = [];
  for (const module of OP_LOG_MODULES) {
    // 各自冪等寫入自己的規則 —— 不合併成一條 glob：每個模組是一個獨立的保證。
    if (ensureGuaranteeRule(here, module.rule, module.sample) === 'unchanged') continue;
    rules.push({ rule: module.rule, outcome: fileExisted ? 'added' : 'created' });
  }

  return { ...dirs, rules, workspace: applyWorkspace(here, opts?.workspace), sharing: 'shared' };
}

/**
 * @deprecated 用 `initNook` —— 這個名字是 Issue 還是容器裡唯一一種 Op-log 時
 * 留下的公開 export。現在它與 `initNook` 做同一件事（容器裡**每個**模組都建、
 * 每條規則都寫），因為 Sharing 以整個容器為單位，只初始化一半的容器不是一個
 * 合法狀態。下一個 minor 版移除。
 */
export function initBoard(dir: string, opts?: { readonly sharing?: Sharing }): void {
  initNook(dir, opts);
}

function createModuleDirs(here: string): Pick<InitResult, 'issues' | 'decisions'> {
  const [issues, decisions] = OP_LOG_MODULES.map((module) => {
    const path = join(here, ...module.dir);
    const existed = existsSync(path);
    mkdirSync(path, { recursive: true });
    return existed ? ('unchanged' as const) : ('created' as const);
  });
  return { issues: issues!, decisions: decisions! };
}

/**
 * `.gitnook/config.json` 的 `workspace` 位元 —— **additive-only**：`true`
 * 確保為 `true`，`undefined` 不動既有值，沒有「設回 false」的路徑。
 */
function applyWorkspace(here: string, workspace: boolean | undefined): 'enabled' | 'unchanged' {
  if (workspace !== true) return 'unchanged';
  const current = readNookConfig(here);
  if (current.workspace === true) return 'unchanged';
  writeNookConfig(here, { ...current, workspace: true });
  return 'enabled';
}

export interface ShareResult {
  /** nook 自己寫進 `$GIT_DIR/info/exclude` 的那一行這次被拿掉了。 */
  readonly unexcluded: boolean;
  /** 這次補上的 merge=union 規則。 */
  readonly rules: readonly RuleWrite[];
  /** share **之前** op-log 就已經在 index 裡 —— 那時不該再叫使用者 `git add`／`commit`。 */
  readonly alreadyTracked: boolean;
  /** nook 做完自己那一半之後，git 是否**仍然**在 ignore 這個容器（以及是哪一條規則）。 */
  readonly stillIgnored: { readonly ignored: boolean; readonly source: string | null };
}

/**
 * private → shared：冪等補齊每個模組的 merge=union、拿掉 nook 借的那一行，
 * 然後回報 git 是否仍然擋著。**不跑任何會寫入的 git 指令** —— 把容器交給整個
 * 團隊是一個社交決定，`git add` 屬於使用者。
 *
 * **順序是先 init、後移除排除規則。** 反過來的話，撞上 ConflictingGitAttributes
 * 的使用者會得到一個 git 看得見、卻沒有零衝突保證的容器，而他以為指令失敗了。
 */
export function shareNook(root: string): ShareResult {
  // **這一題只有 index 答得準**，而且必須在任何寫入之前問。
  const alreadyTracked = opLogsTracked(root);
  const { rules } = initNook(root);
  const unexcluded = unexcludeBoard(root) === 'removed';
  // 問的是 git 自己：那套 pattern 與優先序規則只有它說得準。
  const stillIgnored = ignoredByGit(root);
  return { unexcluded, rules, alreadyTracked, stillIgnored };
}

/**
 * 讀取熱路徑的零衝突保證檢查：**純 fs，絕不 spawn git**（list / show 的冷啟預算）。
 * 回傳缺了（absent 或被蓋掉）的每一條規則；private 容器恆為空 —— 被 ignore 的
 * op-log 永遠不會 merge，保證在那裡是「不需要」，不是「缺少」。
 *
 * fs 與 git 不一致（排除規則在、op-log 卻被 `git add -f` 進去）時這裡是盲的；
 * 說出那件事是 doctor（`diagnoseContainer`）的工作。
 */
export function missingMergeRules(root: string): string[] {
  if (inspectSharing(root) === 'private') return [];
  return activeModules(root)
    .filter((module) => inspectMergeGuarantee(root, module.sample).kind !== 'union')
    .map((module) => module.rule);
}

/**
 * 保證要對哪些模組負責：marker 目錄在的那些。**還不是容器時（一個模組目錄都
 * 沒有）算全部** —— doctor 在還沒 init 的目錄也該答得出「缺少 merge=union」，
 * 而 `nook init` 會一次補齊全部，所以那時缺的就是全部。
 */
function activeModules(root: string): readonly OpLogModule[] {
  const present = OP_LOG_MODULES.filter((module) => existsSync(join(root, ...module.dir)));
  return present.length === 0 ? OP_LOG_MODULES : present;
}

/**
 * doctor 的容器診斷，依序：每個模組的零衝突保證、Sharing 的 fs／git 不一致、
 * 每個 Op-log 的逐行健康（黏合行、未知 op、無法解析的行）。唯一的單點失效排第一。
 */
export function diagnoseContainer(dir: string, opts: { readonly insideGit: boolean }): Diagnostic[] {
  const { sharing, trackedAnyway, guaranteeMatters } = guaranteeScope(dir);
  const modules = activeModules(dir);
  return [
    ...(guaranteeMatters ? modules.flatMap((module) => guaranteeDiagnostics(dir, module)) : []),
    ...sharingMismatches(dir, sharing, trackedAnyway, opts.insideGit),
    ...modules.flatMap((module) => opLogDiagnostics(dir, module)),
  ];
}

/**
 * 單一模組的診斷（`DecisionLog.health()` 用）：該模組的零衝突保證（同一個
 * Sharing 閘門）與逐行健康。Sharing 不一致是整個容器的事，不屬於任何一個模組，
 * 不在這裡回報 —— 那是 `diagnoseContainer` 的事。
 */
export function diagnoseModule(dir: string, module: OpLogModule): Diagnostic[] {
  return [
    ...(guaranteeScope(dir).guaranteeMatters ? guaranteeDiagnostics(dir, module) : []),
    ...opLogDiagnostics(dir, module),
  ];
}

/**
 * 零衝突保證在這個容器上需不需要 —— **全部閘門只有這一份。**
 *
 * 在 private 容器上它是「不需要」，不是「缺少」：被 ignore 的 op-log 永遠不會
 * merge，而 doctor 會進 CI，所以正確行為是沉默。**兩個條件都成立才沉默** ——
 * 只靠 inspectSharing（純 fs 的那一行在不在）就閉嘴，會在「排除規則在、檔案卻被
 * `git add -f` 進去了」時漏掉一個真問題：index 才是共享狀態的權威（**tracked
 * 勝過 ignore 規則**，理由見 `opLogsTracked`），所以它有否決權。**index 只在 fs
 * 已經答 private 時才問** —— 健康的 shared 容器一個子行程都不多付。
 */
function guaranteeScope(dir: string): {
  readonly sharing: Sharing;
  readonly trackedAnyway: boolean;
  readonly guaranteeMatters: boolean;
} {
  const sharing = inspectSharing(dir);
  const trackedAnyway = sharing === 'private' && opLogsTracked(dir);
  return { sharing, trackedAnyway, guaranteeMatters: sharing === 'shared' || trackedAnyway };
}

function guaranteeDiagnostics(dir: string, module: OpLogModule): Diagnostic[] {
  const guarantee = inspectMergeGuarantee(dir, module.sample);
  if (guarantee.kind === 'union') return [];
  if (guarantee.kind === 'absent') {
    return [
      {
        kind: 'MissingMergeDriver',
        file: '.gitattributes',
        message: `missing the zero-conflict guarantee: ${module.rule} (run nook init to restore it)`,
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

function opLogDiagnostics(dir: string, module: OpLogModule): Diagnostic[] {
  const found: Diagnostic[] = [];
  for (const name of opLogNames(dir, module)) {
    const relative = `${module.path}/${name}`;
    for (const [line, text] of numberedLines(readFileSync(join(dir, ...module.dir, name), 'utf8'))) {
      if (isParsable(text)) {
        // 向前相容是資料安全問題（ADR-0001 硬規則 2）：reducer 靜默忽略未知 op，
        // 所以 doctor 必須把它說出來，否則使用者只會看到欄位莫名其妙沒生效。
        const kind = opKindOf(text);
        if (kind !== null && !module.opKinds.has(kind)) {
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
    // 更高的否定規則（committed 的 `!.gitnook/` 壓過 `$GIT_DIR/info/exclude`），
    // 而那時我們那一行**已經在了** —— `init --private` 會回 unchanged、什麼都不動，
    // 使用者照做之後 doctor 再說一次同一句話，永遠。所以問 git 是誰壓過它，並把
    // 那一行指出來；指不出來時就說指不出來，同 `share` 的做法。
    const rule = overridingRule(dir);
    const why =
      rule === null
        ? `and git cannot point at which rule overrides it — run ` +
          `git check-ignore -v --non-matching "${dir}/.gitnook" yourself to find it.`
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


/** 一條被還原回來的黏合行。 */
export interface Repair {
  readonly file: string;
  readonly line: number;
  /** 這一行還原出幾個 op。 */
  readonly ops: number;
}

/**
 * 把容器裡每個 Op-log 的黏合行還原成多行。**只拆行，不做任何語意判斷** ——
 * union merge 複製出來的重複 op 交給 reduce 的 dedupe by id 吸收，
 * 修復不該替使用者決定哪個 op 該留下。
 */
export function repair(dir: string): Repair[] {
  const done: Repair[] = [];

  for (const module of OP_LOG_MODULES) {
    for (const name of opLogNames(dir, module)) {
      const path = join(dir, ...module.dir, name);
      const relative = `${module.path}/${name}`;
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
  }

  return done;
}

function opLogNames(dir: string, module: OpLogModule): string[] {
  const path = join(dir, ...module.dir);
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
 * 未知 Op 會被誤報成無法解析 —— 而未知 Op 是另一種 Diagnostic。
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
