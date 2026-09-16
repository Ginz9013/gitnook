import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openBoard } from '../core/board.js';
import { MERGE_RULE, initBoard, inspectMergeGuarantee } from '../core/gitattributes.js';
import { isValidRef } from '../core/ids.js';
import { fieldWrites } from '../core/reduce.js';
import { ignoredByGit, inspectSharing, opLogsTracked, unexcludeBoard } from '../core/sharing.js';
import { IssueDeleted } from '../core/types.js';
import { renderJson } from '../render/json.js';
import { renderSetOps, renderTable } from '../render/table.js';
import {
  UsageError,
  asChange,
  assembleCreateInput,
  boardDir,
  confirmed,
  displayLength,
  errLine,
  fromEditor,
  isSettable,
  line,
  longText,
  parseArgs,
  parseLabelTokens,
  SETTABLE,
} from './run.js';
import type { Args, Field, Io } from './run.js';
import type { Filter } from '../core/types.js';

/**
 * `nook issue <init|new|list|show|history|set|rm|mv|comment|label|share>` 的
 * argv → Board → render → exit code —— 仿 `dispatchWorkspace` 的先例
 * （`cli/workspace.ts`）：`run.ts` 只留一個
 * `case 'issue': return dispatchIssue(rest, io)`。
 *
 * 這十一個函式本體是票 05 之前 `run.ts` 頂層 11 個扁平指令的原樣搬遷 ——
 * 判斷邏輯一行都不改，只調整 import 路徑，以及使用者可見的 usage／錯誤
 * 訊息裡把 `nook <verb>` 換成 `nook issue <verb>`（同票的 acceptance
 * criteria：新指令名稱本身就是這張票的內容，不換字串等於沒搬完）。
 *
 * 這裡自己不接任何錯誤，跟 `dispatchWorkspace` 一樣：使用者錯誤直接往外丟，
 * 由 `run()` 既有的 `USER_ERRORS` 清單接住並轉成 exit 1 / exit 2 —— 那份清單
 * 活在 `run.ts`，不在這裡另開第二條轉譯規則。
 */
export async function dispatchIssue(argv: readonly string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;

  switch (sub) {
    case 'init':
      // 票 01：`nook issue init`／`nook decision init` 整個移除，沒有相容
      // 別名——沿用 `run.ts` 的 `LEGACY_ISSUE_COMMANDS` 那套「明確報錯指向
      // 新路徑」做法，而不是落回下面模糊的 unknown subcommand（那句話只會
      // 讓人以為自己打錯字，去猜一個離題的候選）。
      throw new UsageError(
        '`nook issue init` was removed — run `nook init` instead ' +
          '(it creates both the issue board and the decision log, under .gitnook/)',
      );
    case 'new':
      return cmdNew(parseArgs(rest, NEW_FLAGS), io);
    case 'list':
      return cmdList(parseArgs(rest, LIST_FLAGS), io);
    case 'show':
      return cmdShow(parseArgs(rest, SHOW_FLAGS), io);
    case 'history':
      return cmdHistory(parseArgs(rest, NO_FLAGS), io);
    case 'set':
      return cmdSet(parseArgs(rest, SET_FLAGS), io);
    case 'rm':
      return cmdRm(parseArgs(rest, RM_FLAGS), io);
    case 'mv':
      return cmdMv(parseArgs(rest, NO_FLAGS), io);
    case 'comment':
      return cmdComment(parseArgs(rest, NO_FLAGS), io);
    case 'label':
      return cmdLabel(parseArgs(rest, NO_FLAGS), io);
    case 'share':
      // share 沒有旗標也沒有參數，但仍然過一次 parseArgs：打錯的旗標不得被
      // 靜默吃掉（`nook issue share --privte` 要報錯，而不是悄悄照做）。
      return cmdShare(parseArgs(rest, NO_FLAGS), io);
  }

  // 同 `dispatchWorkspace`/`dispatchDecision` 的既有先例：未知子指令列出可用
  // 清單，不做模糊猜測 —— 那套 Levenshtein「did you mean」留在頂層
  // （`run.ts` 的 `unknownCommand`），不在每一個子命名空間各自複製一份。
  throw new UsageError(
    `unknown issue subcommand: ${sub ?? ''} ` +
      '(available: new, list, show, history, set, rm, mv, comment, label, share)',
  );
}

const NO_FLAGS: ReadonlySet<string> = new Set();
const NEW_FLAGS: ReadonlySet<string> = new Set(['--description', '--editor', '--label']);
const LIST_FLAGS: ReadonlySet<string> = new Set(['--all', '--status', '--label', '--json']);
const SHOW_FLAGS: ReadonlySet<string> = new Set(['--json']);
const SET_FLAGS: ReadonlySet<string> = new Set(['--editor']);
const RM_FLAGS: ReadonlySet<string> = new Set(['--yes']);

/**
 * .gitattributes 是整個零衝突保證的唯一單點失效 —— 被誤刪時資料會靜默開始
 * 衝突。讀取類指令因此主動監看它。警告走 stderr，管線上的資料不受污染。
 *
 * 問的是 inspectMergeGuarantee 而不是 diagnose：這裡只需要知道那一行還在不在，
 * 而完整診斷要再掃一次全部 op-log 並 spawn 一個 git rev-parse —— 對每一次
 * list / show 都收這筆帳，直接吃掉冷啟預算（spec.md 四個硬指標）。
 *
 * **private board 上完全不警告。** 那塊 board 的 op-log 被 $GIT_DIR/info/exclude
 * 排除，永遠不會進 git、也永遠不會 merge，所以零衝突保證在那裡是「不需要」，
 * 不是「缺少」—— 這裡的沉默不是把一個真問題藏起來。反過來說，那句警告在
 * shared board 上永遠不是雜訊（AGENT.md），正因如此它不能在一個它不適用的
 * 模式下繼續噴：噴到使用者學會忽略它，shared board 上真的缺了那一行時就沒有
 * 任何東西攔得住靜默的衝突。
 *
 * 兩個沒有被選的做法：
 * - **fs 與 git 不一致時（排除規則在、op-log 卻被 `git add -f` 進去了）這裡是
 *   盲的。** 問出真相要 `git ls-files`（`opLogsTracked`），而熱路徑不准 spawn
 *   子行程 —— 那是 spec.md 寫明接受的已知限制，說出那件事是 doctor 的工作。
 * - **順序是先問 Sharing。** 反過來（先問保證、缺了才問 Sharing）在健康的
 *   shared board 上更便宜，因為 `&&` 會短路掉 inspectSharing；代價是 private
 *   board 得先去讀一個在那個模式下沒有意義的檔案。多付的那一次 existsSync 加
 *   一個小檔的讀取因此落在 shared board 上，而 private board 在這條路徑上碰都
 *   不碰 .gitattributes。
 */
function warnIfUnguarded(io: Io): void {
  // 兩個問法共用同一塊 board，也只尋根一次 —— 問的是 board 根目錄，不是
  // io.cwd：在子目錄執行時答案必須一樣。純 fs，不 spawn 任何子行程。
  const root = boardDir(io);

  if (inspectSharing(root) === 'private') return;

  // absent 與 conflicting 都表示 op-log 拿不到 union，兩者同樣要警告。
  if (inspectMergeGuarantee(root).kind !== 'union') {
    errLine(io, 'Warning: .gitattributes is missing merge=union, merges will conflict (nook init restores it)');
  }
}

function cmdList(args: Args, io: Io): number {
  const status = args.one('--status');
  const labels = args.all('--label');
  const filter: Filter = {
    ...(args.has('--all') ? { all: true } : {}),
    ...(status === undefined ? {} : { status }),
    ...(labels.length === 0 ? {} : { labels }),
  };

  // 先讀資料：board 根本不存在時，該說的是「先跑 nook init」而不是兩個問題。
  const board = openBoard({ dir: io.cwd });
  const issues = board.list(filter);
  warnIfUnguarded(io);
  // 長度對整塊 Board 算，不是對這份過濾後的結果 —— 預設檢視藏起 archived /
  // done / cancelled，而它們仍然是 board.get() 的候選。對子集算出來的前綴
  // 會在解析端撞號，也就是印出一個打不開的 Ref（ADR-0006）。
  line(io, args.has('--json') ? renderJson(issues) : renderTable(issues, displayLength(board)));
  return 0;
}

/**
 * 讀到一張已刪的 Issue 時該說的那句話。**前半段的字串歸 `IssueDeleted` 所有**
 * —— 手抄一份，兩邊遲早各自漂移，而它們講的是同一件事。
 *
 * 後半段是出路：只說東西沒了，誤刪的人下一步無處可去。它不屬於那個錯誤型別
 * （core 不知道有 CLI 這回事），所以接在這裡。
 */
function deletedMessage(ref: string): string {
  return `${new IssueDeleted(ref).message} (nook history ${ref} recovers what was written; nook set ${ref} deleted false undoes this)`;
}

/**
 * `show` 與 `list` 印的是同一個顯示用表示法，所以長度也必須一樣 —— 對整塊
 * Board 算。`board.refs()` 只列目錄、不摺疊任何 Op-log，因此票 13 的效能保證
 * （「單點失效的監看不該把整個 Board 掃一遍」守住）仍然成立：詳情這條路徑
 * 只會讀被點名的那一個 op-log。
 */
function cmdShow(args: Args, io: Io): number {
  const board = openBoard({ dir: io.cwd });
  const ref = requireRef(args.positional[0] ?? '');
  const issue = board.get(ref);

  // `board.get()` 對已刪的 Issue 不拋（ADR-0009），正是為了讓這裡分得出
  // 「被刪了」與「找不到」—— 兩者要修的東西完全不同。訊息必須帶出撈得回來
  // 的方法：只說東西沒了，誤刪的人下一步無處可去。
  // 擺在 warnIfUnguarded 之前 —— 一個問題就講一個問題（同尚未 init 的目錄）。
  if (issue.deleted) {
    errLine(io, deletedMessage(ref));
    return 1;
  }

  warnIfUnguarded(io);
  // 單一物件而非長度 1 的陣列 —— 串接端不必為了取一張 Issue 去拆陣列。
  line(io, args.has('--json') ? renderJson(issue) : renderTable(issue, displayLength(board)));
  return 0;
}

/**
 * 一張 Issue 的 Op-log 中的 set Op —— 每一次對 LWW 欄位的寫入，誰寫的、
 * 在哪個 lamport `t`、寫成什麼。
 *
 * 存在的理由只有一個：`description` 是 LWW，並行編輯時摺疊只留一份，敗方的
 * 文字完整躺在檔案裡卻沒有任何指令拿得回來。看得到就手動 copy 回 `nook set`
 * 拿得回來 —— **刻意不做 restore**，那是 append 一個新 Op 把舊值寫回去，不是
 * 「回到過去」，語意值得單獨定。
 *
 * 只列對 LWW 欄位的寫入：`create` 折成 title 的第一次寫入（core 的 `fieldWrites`），
 * label 是 OR-Set、comment 只增不減，兩者都不會弄丟東西，而 comment 在 `show`
 * 就看得到。
 * **本指令唯讀，不 append 任何 Op。**
 */
function cmdHistory(args: Args, io: Io): number {
  const [ref, field] = args.positional;
  if (ref === undefined) throw new UsageError('usage: nook issue history <ref> [<field>]');
  requireRef(ref);
  // 打錯欄位名而靜默回一份空清單，等於告訴呼叫端「那個欄位從沒被寫過」——
  // 而他正是在找一份被蓋掉的舊值。同 `set` 與未知旗標的慣例：不靜默猜測。
  if (field !== undefined && !isSettable(field)) {
    throw new UsageError(`not a queryable field: ${field} (available: ${SETTABLE.join(', ')})`);
  }

  const board = openBoard({ dir: io.cwd });
  // 摺疊與篩選都在 core，**與 `GET /api/history/<ref>` 是同一份** —— 兩邊各留一份
  // 就是票 B9 的成因。順序沿用 `opLog` 的全序，這裡與 core 都不再碰它。
  const ops = fieldWrites(board.opLog(ref), field);
  // 同 list / show：單點失效的監看擺在讀完之後，board 不存在時該說的是
  // 「先跑 nook init」而不是兩個問題。
  warnIfUnguarded(io);
  line(io, renderSetOps(ops));
  return 0;
}

/**
 * 長文的兩條路之一：`-` 表示從 stdin 讀（`nook issue set X description - < bug.md`）
 * —— agent 的正解，零 shell 跳脫問題。這裡直接沿用 `run.ts` 的 `longText`，
 * 那個函式已經自己處理了這件事，不必重寫。
 */

/**
 * 兩個 boolean 欄位。`yes` 被靜默讀成真值，就是一次沒有人打算下達的刪除。
 * 沿用 `run.ts` 的 `BOOLEAN_FIELDS`——這裡不重寫一份可能漂開的副本。
 */

function cmdSet(args: Args, io: Io): number {
  const [ref, field, value] = args.positional;
  const usage = 'usage: nook issue set <ref> <title|description|status|archived|deleted> <value|->';
  if (ref === undefined || field === undefined) throw new UsageError(usage);
  requireRef(ref);
  if (!(SETTABLE as readonly string[]).includes(field)) {
    throw new UsageError(`not a writable field: ${field} (available: ${SETTABLE.join(', ')})`);
  }

  const board = openBoard({ dir: io.cwd });

  let text: string;
  if (args.has('--editor')) {
    // 以現值開場 —— 編輯既有的 description 才是這條路的實際用途。
    const current = board.get(ref);
    text = fromEditor(io, field === 'title' || field === 'description' ? current[field] : '');
  } else {
    if (value === undefined) throw new UsageError(usage);
    text = longText(value, io);
  }

  const updated = board.apply(ref, asChange(field as Field, text));
  // 回印更新後那一行 —— 呼叫端不必再跑一次 show 才知道結果。
  line(io, renderTable([updated], displayLength(board)));
  return 0;
}

/**
 * 刪除。定義是「`set <ref> deleted true` **加上一次確認**」—— 不是第二條
 * 路徑，是一層安全包裝，所以寫入仍然只經過 `board.apply` 那一個決定點。
 *
 * 檔案永遠不 unlink：留下的是一個墓碑欄位（ADR-0009）。modify/delete 是
 * merge=union 不涵蓋的固有衝突，而零衝突是這個工具的第一句話。
 */
function cmdRm(args: Args, io: Io): number {
  const [ref] = args.positional;
  if (ref === undefined) throw new UsageError('usage: nook issue rm <ref> [--yes]');
  requireRef(ref);

  const board = openBoard({ dir: io.cwd });
  const target = board.get(ref);

  // 已經刪掉了。問「真的要刪嗎」是在為一次**不可能落地的寫入**要求一個決定 ——
  // 答了 y 之後拿到的仍然是 `board.apply` 丟出來的 `IssueDeleted`。
  //
  // 這是**讀取側的呈現判斷**，與上面 `cmdShow` 的同一類：`board.get()` 對已刪的
  // Issue 不拋（ADR-0009），CLI 因此讀得到這一格，決定的只是「要不要開口問」。
  // **寫入安全那個決定點仍然只有 `board.apply` 一個**，這裡沒有第二份守門 ——
  // 把它拿掉，刪除照樣擋得住，只是訊息回到那句不好的。
  if (target.deleted) {
    errLine(io, deletedMessage(ref));
    return 1;
  }

  // 守門在任何寫入之前。
  if (!args.has('--yes') && !confirmed(io, target.title)) return 1;

  board.apply(ref, { deleted: true });
  // 回印的不是更新後那一行 —— 一張已刪的 Issue 印成普通的一列，看起來會像
  // 什麼都沒發生。說出刪掉的是哪一張，同 init 的「動詞 + 對象」。
  line(io, `Deleted  ${target.id.slice(0, displayLength(board))}  ${target.title}`);
  return 0;
}

/**
 * 一張 Issue 的生命週期會用上四次以上，因頻率而回本 ——
 * `set <ref> status <value>` 的捷徑。
 */
function cmdMv(args: Args, io: Io): number {
  const [ref, status] = args.positional;
  if (ref === undefined || status === undefined) throw new UsageError('usage: nook issue mv <ref> <status>');
  requireRef(ref);

  const board = openBoard({ dir: io.cwd });
  const updated = board.apply(ref, { status });
  line(io, renderTable([updated], displayLength(board)));
  return 0;
}

/**
 * Ref 是使用者輸入，而完整識別碼會被接進檔案路徑。core 目前也擋，但 CLI 是
 * 第一個接觸點 —— 而且「找不到 issue：../../etc/passwd」會暗示這種 issue
 * 有可能存在。它不可能存在。
 */
function requireRef(ref: string): string {
  if (!isValidRef(ref)) throw new UsageError(`not a valid ref: ${ref}`);
  return ref;
}

/** Comment 是 Nook 中唯一的討論載體，人與 agent 共用。只增不減。 */
function cmdComment(args: Args, io: Io): number {
  const [ref, body] = args.positional;
  if (ref === undefined || body === undefined) throw new UsageError('usage: nook issue comment <ref> <body>');
  requireRef(ref);

  const board = openBoard({ dir: io.cwd });
  const updated = board.apply(ref, { comment: longText(body, io) });
  line(io, renderTable([updated], displayLength(board)));
  return 0;
}

/**
 * Nook 沒有優先級欄位 —— 優先級用 Label 表達（CONTEXT.md）。`+bug -ui` 的寫法
 * 讓加與減在同一行說完，而不是兩個子指令。
 *
 * token 的解析邏輯本身在 `run.ts` 的 `parseLabelTokens()`——這裡只接線。
 */
function cmdLabel(args: Args, io: Io): number {
  const [ref, ...tokens] = args.positional;
  if (ref === undefined || tokens.length === 0) {
    throw new UsageError('usage: nook issue label <ref> +<label> -<label>');
  }
  requireRef(ref);

  const { add, remove } = parseLabelTokens(tokens);

  const board = openBoard({ dir: io.cwd });
  const updated = board.apply(ref, { labels: { add, remove } });
  line(io, renderTable([updated], displayLength(board)));
  return 0;
}

/**
 * `.gitattributes` 的那一行這次發生了什麼事，講成一行字。
 *
 * **狀態必須在 initBoard 之前讀完**，所以這個函式回傳的是一個「等著被印」的
 * closure 而不是自己印 —— 寫完再讀，看到的永遠是它剛寫完的結果，三種結果會全部
 * 塌成「本來就在」。`init` 與 `share` 共用它：補一行進別人的檔案與整個檔案都是我
 * 建的，是兩件不同的事，而這句話的措辭在兩個指令裡必須一樣（改一處就要改兩處的
 * 那種重複，正是會漂開的那種）。
 */
function guaranteeLine(dir: string): (io: Io) => void {
  const guarded = inspectMergeGuarantee(dir).kind === 'union';
  const existed = existsSync(join(dir, '.gitattributes'));
  return (io) => {
    if (guarded) return;
    // 動詞補到等寬，路徑才對得起來。
    line(io, `${existed ? 'Added  ' : 'Created'}  .gitattributes  ${MERGE_RULE}`);
  };
}

/**
 * private → shared 的升級路徑：拿掉 nook 借的那一行、冪等補回 MERGE_RULE，然後
 * 把**使用者自己**要跑的 git 指令印出來。
 *
 * nook 沒有任何一個會寫入的 git 指令，`git add` 也不會是第一個 —— 把一塊 board
 * 交給整個團隊是一個社交決定（spec.md：private mode 買到的是社交足跡為零），
 * 而那個決定連同它的 commit message 都屬於使用者。
 *
 * **順序是先 initBoard、後移除排除規則。** 反過來的話，撞上
 * ConflictingGitAttributes 的使用者會得到一塊 git 看得見、卻沒有零衝突保證的
 * board，而他以為指令失敗了 —— 同 `initBoard` private 那條路「拒絕不留痕跡」的
 * 紀律。這也是為什麼那條檢查不在這裡重寫一份：它已經在 initBoard 裡，而且排在
 * 它自己的任何寫入之前。
 */
function cmdShare(args: Args, io: Io): number {
  // `nook issue share 01JBXA` —— 想共享「一張 issue」的人會這樣打，而 share
  // 是整塊 board 的動作。靜默吃掉那個引數等於把一次全 board 升級回報成他要的
  // 那件事。doctor / studio 的寬鬆不轉移過來：它們**接受**參數，share 一個都不收，
  // 所以位置引數在這裡明確是打錯了。
  const stray = args.positional[0];
  if (stray !== undefined) {
    throw new UsageError(`share takes no arguments (the whole board upgrades together): ${stray}`);
  }

  // 不是一塊 board 時該說的是「不是一個 Nook board」，而不是對著一個空目錄回報
  // 升級成功。尋根與那句話都已經在 Board 上，這裡不寫第二份。
  const root = openBoard({ dir: io.cwd }).root();

  // 狀態在寫入之前讀完 —— 之後再讀，看到的是它剛寫完的結果（同 cmdInit）。
  const sayGuarantee = guaranteeLine(root);
  const guarded = inspectMergeGuarantee(root).kind === 'union';
  // **這一題只有 index 答得準**，而它決定的是下面那句 `git add` 該不該印：
  // 「意圖共享但從來沒 commit」要那一步，「早就 commit 出去了」不要。share 是
  // spec.md 列出的三個准 spawn git 的指令之一。
  const alreadyOut = opLogsTracked(root);

  initBoard(root);
  const removed = unexcludeBoard(root) === 'removed';

  // nook 做完自己那一半之後，git **仍然**可能在 ignore 這塊 board（committed 的
  // `.gitignore` 也有一條是最常見的形狀）。問的是 git 自己（`ignoredByGit`）：那套
  // pattern 與優先序規則只有它說得準，而它順手指出的 `<file>:<line>:<pattern>`
  // 正是使用者要去改的那一行。
  //
  // **必須在印任何一行之前問完。** 否則第一行已經承諾「從現在起會進 git」，而
  // 下一行才說 git 還在擋 —— 先承諾再收回比直接說不行更糟。
  const blocked = ignoredByGit(root);

  if (removed) {
    line(
      io,
      blocked.ignored
        ? 'Removed  the line from $GIT_DIR/info/exclude (but see below: git is still ignoring this board)'
        : 'Shared  .gitnook/  removed from $GIT_DIR/info/exclude (this board will enter git from now on)',
    );
  }
  sayGuarantee(io);
  // 三件事都本來就對了才是 no-op。沉默在這裡會與成功長得一模一樣，而使用者問的
  // 正是「這次到底有沒有動到東西」—— 同 init 說話、doctor 沉默的那條分界。
  if (!removed && guarded) line(io, 'Unchanged  this board is already shared; nothing was touched');

  if (blocked.ignored) {
    // 那時 `git add` 會被拒絕，所以照樣印出那條指令等於叫使用者去撞牆，而回 0
    // 等於騙他升級完成了 —— 同事的 clone 仍然會是空的。
    //
    // source 是 null 時仍然要開口（git 說了它 ignore，那是事實），只是說不出是
    // 哪一條 —— 兩件事分開，使用者才不會以為 nook 在亂猜。
    errLine(
      io,
      blocked.source === null
        ? `git is still ignoring this board, so git add would be rejected, but git did not point at ` +
            `which rule. Run git check-ignore -v "${root}/.gitnook" yourself to find it, remove it, then run nook issue share again.`
        : `git is still ignoring this board: the rule ${blocked.source} is still blocking it, so git add would be rejected. ` +
            `Remove that line yourself (nook never edits your .gitignore), then run nook issue share again.`,
    );
    return 1;
  }

  // **op-log 早就在 index 裡時就不印這三行。** `git commit` 不是冪等的：使用者
  // 手上有沒 commit 的 issue 編輯時，上面那條 git add 會把它們一起 stage，然後
  // 落在一個謊報的訊息底下；什麼都沒待 commit 時它直接失敗。而「這次沒有動到任何
  // 東西」緊接著「請自己執行」本身就是自相矛盾的一對。
  if (alreadyOut) return 0;

  // 指令帶完整路徑：board 可能不在 repo 根目錄（`/services/api/.gitnook/` 是支援
  // 且被測試的形狀），那時貼上一條相對指令的人會在錯的目錄下執行它，而 git 只會
  // 說 pathspec 沒命中 —— 同 AlreadySharedBoard 訊息的理由。
  line(io, 'Next  nook runs no git command that writes; run these yourself:');
  line(io, `  git add "${root}/.gitnook" "${root}/.gitattributes"`);
  line(io, '  git commit -m "Share the nook board"');
  return 0;
}

function cmdNew(args: Args, io: Io): number {
  const title = args.positional[0];
  if (title === undefined) throw new UsageError('usage: nook issue new <title>');

  const input = assembleCreateInput(title, args, io);
  const issue = openBoard({ dir: io.cwd }).create(input);
  // 印完整的 26 碼 ULID 而非短 ID —— 那是唯一**永久有效**的 Ref。短 ID 只在
  // 印出的當下無歧義：ULID 前綴編的是時間高位，下一張 Issue 就可能延伸同一個
  // 前綴，把剛交出去的 ref 變成有歧義的。`new` 的輸出會被存進變數、寫進腳本、
  // 貼進 commit message，它必須在那之後仍然指得到同一張 Issue。
  line(io, issue.id);
  return 0;
}
