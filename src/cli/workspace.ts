import { relative } from 'node:path';
import { isFullRef } from '../core/ids.js';
import { IncompleteRef, IssueDeleted } from '../core/types.js';
import { locateInWorkspace, memberAt, openWorkspace } from '../core/workspace.js';
import { repair } from '../core/health.js';
import { renderTable, renderWorkspaceList } from '../render/table.js';
import { serveWorkspace } from '../server/serveWorkspace.js';
import {
  asChange,
  assembleCreateInput,
  confirmed,
  displayLength,
  errLine,
  formatDiagnostic,
  formatRepaired,
  fromEditor,
  isSettable,
  line,
  longText,
  parseArgs,
  parseLabelTokens,
  SETTABLE,
  UsageError,
  type Args,
  type Field,
  type Io,
} from './run.js';
import type { Filter } from '../core/types.js';
import type { WorkspaceGroup } from '../render/table.js';

/**
 * `nook workspace <list|doctor|...>` 的 argv → Workspace → render → exit code。
 *
 * 跟 `run.ts` 對單一 Board 的既有指令同一個薄度量級 —— 複雜度屬於
 * `openWorkspace()`（核心）與 `renderWorkspaceList()`（呈現），這裡只接線。
 *
 * 目前認得 `list`/`doctor`/`studio`/`new`。
 */
export async function dispatchWorkspace(argv: readonly string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;

  switch (sub) {
    case 'list':
      return cmdList(parseArgs(rest, LIST_FLAGS), io);
    case 'doctor':
      return cmdDoctor(parseArgs(rest, DOCTOR_FLAGS), io);
    case 'studio':
      return cmdStudio(parseArgs(rest, STUDIO_FLAGS), io);
    case 'new':
      return cmdNew(parseArgs(rest, NEW_FLAGS), io);
    case 'set':
      return cmdSet(parseArgs(rest, SET_FLAGS), io);
    case 'mv':
      return cmdMv(parseArgs(rest, NO_FLAGS), io);
    case 'comment':
      return cmdComment(parseArgs(rest, NO_FLAGS), io);
    case 'label':
      return cmdLabel(parseArgs(rest, NO_FLAGS), io);
    case 'rm':
      return cmdRm(parseArgs(rest, RM_FLAGS), io);
  }

  // 同 `run.ts` 的 `unknownCommand`：使用者錯誤只走 UsageError 這一條路徑，
  // 不在這裡另開一份手寫的 errLine + return 1。
  throw new UsageError(
    `unknown workspace subcommand: ${sub ?? ''} (available: list, doctor, studio, new, set, mv, comment, label, rm)`,
  );
}

const LIST_FLAGS: ReadonlySet<string> = new Set(['--all', '--status', '--label', '--json']);
const DOCTOR_FLAGS: ReadonlySet<string> = new Set(['--fix']);
const STUDIO_FLAGS: ReadonlySet<string> = new Set(['--port']);
const NEW_FLAGS: ReadonlySet<string> = new Set(['--in', '--description', '--editor', '--label']);
const SET_FLAGS: ReadonlySet<string> = new Set(['--editor']);
const NO_FLAGS: ReadonlySet<string> = new Set();
const RM_FLAGS: ReadonlySet<string> = new Set(['--yes']);

/**
 * 跨 board 操作要求完整 26 碼 ULID（spec.md Non-goals）。在 `openWorkspace()`
 * 掃描整棵樹之前先擋掉格式錯的輸入 —— 省一次無謂的全樹掃描。
 *
 * `locateInWorkspace()` 內部也做同樣的檢查（defense in depth，保護不透過
 * CLI 的呼叫端）；經過這裡之後，那個內部檢查理應永遠不會在 CLI 這條路徑上
 * 真的觸發。
 *
 * export 供票 04（mv）、05（comment）、06（label）、07（rm）重用 ——
 * 五個指令的 `<ref>` 全部要求完整 ULID，不必各自重寫一次同樣的檢查。
 */
export function requireFullRef(ref: string): string {
  if (!isFullRef(ref)) throw new IncompleteRef(ref);
  return ref;
}

/**
 * 一個成員路徑相對於 workspace 根目錄的顯示形式。成員本身就是根目錄時
 * `relative()` 回傳空字串 —— 印一個空字串等於沒有標頭，改印 `.`。
 */
const relativeGroupPath = (root: string, path: string): string => {
  const rel = relative(root, path);
  return rel === '' ? '.' : rel;
};

/**
 * `doctor` 專用的成員標籤：一個 diagnostic 前面孤零零一個 `.`，讀起來容易被
 * 誤會成「workspace 這個工具自己的問題」，而不是「根目錄那個 Board 的問題」
 * ——`list` 的分組表頭底下接著一串 issue，上下文夠，不需要這條加註。
 */
const doctorLabel = (root: string, path: string): string => {
  const rel = relativeGroupPath(root, path);
  return rel === '.' ? '. (the workspace root itself is also a member board)' : rel;
};

/**
 * `list`：沿用 `Filter` 型別，對每個成員各呼叫一次 `member.board.list(filter)`——
 * 篩選語意與單一 Board 的 `nook list` 完全一致（含預設隱藏 done/cancelled/archived），
 * 因為呼叫的是同一個 `Board.list()`，這裡不重新實作任何篩選邏輯。
 *
 * 每個成員的短 ID 顯示長度各自對**該成員自己**的 `refs()` 算 —— 同 CLI 對單一
 * Board 的既有規則（`displayLength`），不跨成員合算，因為每個成員完全維持自己
 * 的獨立性（CONTEXT.md 的 Workspace 詞條）。
 *
 * 空清單的成員整組略過不印：`--json` 與預設表格輸出都套用同一份過濾，
 * 兩者不該對「這個成員有沒有東西可看」給出不同答案。
 */
function cmdList(args: Args, io: Io): number {
  const status = args.one('--status');
  const labels = args.all('--label');
  const filter: Filter = {
    ...(args.has('--all') ? { all: true } : {}),
    ...(status === undefined ? {} : { status }),
    ...(labels.length === 0 ? {} : { labels }),
  };

  const workspace = openWorkspace({ dir: io.cwd });
  const root = workspace.root();

  const groups: WorkspaceGroup[] = workspace.members.map((member) => ({
    path: relativeGroupPath(root, member.path),
    issues: member.board.list(filter),
    shortIdLen: displayLength(member.board),
  }));

  if (args.has('--json')) {
    const nonEmpty = groups.filter((g) => g.issues.length > 0);
    line(io, JSON.stringify(nonEmpty.map((g) => ({ path: g.path, issues: g.issues }))));
  } else {
    line(io, renderWorkspaceList(groups));
  }
  return 0;
}

/**
 * `doctor`：對每個成員各跑一次既有、未經修改的 `member.board.health()` ——
 * 診斷邏輯完全屬於 `src/core/health.ts`，這裡只逐一呼叫並在輸出前加上該成員的
 * 相對路徑，讓每一行都清楚標出是哪個成員的 diagnostic（不會讓人誤以為是母
 * 資料夾自己的問題——`doctorLabel` 特別處理了根目錄自己也是一個成員的情況）。
 * 任一個成員不健康就整個指令 exit 1；全部健康時完全沉默 ——同單一 Board
 * `doctor` 的既有慣例（沒消息就是好消息），因為呼叫的正是同一個 `health()`。
 * 兩行的措辭（`formatDiagnostic`/`formatRepaired`）從 `run.ts` 重用，不重打
 * 一份可能漂開的副本。
 *
 * `--fix` 對**每一個**成員都呼叫既有、未經修改的 `repair(member.path)`——同
 * 單一 Board `cmdDoctor` 的既有寫法：`repair()` 對沒有黏合行的成員本來就是
 * no-op（回傳空陣列、不印任何東西），效果等同「只對有 diagnostic 的成員修」，
 * 不必在呼叫前先自己判斷一次「這個成員需不需要修」——那個判斷本來就屬於
 * `repair()` 自己。修完才問 `health()`：`diagnose()` 每次都重新讀檔，不會拿到
 * 修復前的舊答案。
 */
function cmdDoctor(args: Args, io: Io): number {
  const workspace = openWorkspace({ dir: io.cwd });
  const root = workspace.root();
  let unhealthy = false;

  for (const member of workspace.members) {
    const path = doctorLabel(root, member.path);

    if (args.has('--fix')) {
      for (const fixed of repair(member.path)) {
        line(io, `${path}  ${formatRepaired(fixed)}`);
      }
    }

    const found = member.board.health();
    if (found.length > 0) unhealthy = true;
    for (const d of found) {
      line(io, `${path}  ${formatDiagnostic(d)}`);
    }
  }

  return unhealthy ? 1 : 0;
}

/**
 * `studio`：`--port` 給 landing server；`serveWorkspace()` 幫每個成員各自的
 * 子 studio 挑自己的 ephemeral port（同 `run.ts` 的 `cmdStudio` 對單一 Board
 * 的既有寫法——這裡開的是 landing page，不是某一塊 Board 自己的 studio）。
 */
async function cmdStudio(args: Args, io: Io): Promise<number> {
  const given = args.one('--port');
  const port = given === undefined ? undefined : Number(given);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new UsageError(`not a valid port: ${given}`);
  }

  const workspace = openWorkspace({ dir: io.cwd });
  const studio = await serveWorkspace(workspace, port === undefined ? {} : { port });
  line(io, studio.url);

  await untilAborted(io.signal);
  await studio.close();
  return 0;
}

/**
 * `new`：跟單一 Board 的 `nook new`（`run.ts` 的 `cmdNew`）同一份組裝邏輯——
 * `--editor`/`--description`/`--label` 一字不改地重用，差別只在目標 board
 * 從哪裡來：這裡靠 `--in <path>` 與既有、未經修改的 `memberAt()` 解析出
 * 正確的成員，而不是對 `io.cwd` 開一塊新的 Board。
 *
 * `--in` 必填 —— spec.md 的 Non-goals：不支援 cwd 自動推斷，人已經站在某個
 * 成員裡的話，直接用單一 Board 的 `nook new` 更直接。
 *
 * 印的是不帶成員路徑裝飾的純 ULID，同單一 Board `new` 的既有慣例 ——
 * spec.md 的 Domain decisions：只有 `rm` 標成員路徑，`new` 每次只印一筆
 * 結果，使用者剛剛才主動指定了 `--in`，落在哪個成員早在預期內。
 */
function cmdNew(args: Args, io: Io): number {
  const title = args.positional[0];
  const usage = 'usage: nook workspace new <title> --in <path>';
  if (title === undefined) throw new UsageError(usage);

  const at = args.one('--in');
  if (at === undefined) throw new UsageError(`${usage} (--in is required, no fallback to cwd)`);

  const workspace = openWorkspace({ dir: io.cwd });
  const target = memberAt(workspace, at);

  // 欄位組裝跟單一 Board 版本的 `nook new` 一字不差，重用 `run.ts` 的
  // `assembleCreateInput`——差別只在目標 board 從 `--in` 解析出來，不是
  // `io.cwd`。
  const input = assembleCreateInput(title, args, io);
  const issue = target.board.create(input);
  line(io, issue.id);
  return 0;
}

/**
 * `set`：跟單一 Board 的 `nook set`（`run.ts` 的 `cmdSet`）同一份欄位驗證與
 * 組裝邏輯（`asChange`/`SETTABLE`/`isSettable`/`--editor` 語意）一字不改地
 * 重用，差別只在目標 board 從哪裡來 —— 這裡靠 `requireFullRef()` 與既有、
 * 未經修改的 `locateInWorkspace()` 找出擁有 `<ref>` 的成員，而不是對 `io.cwd`
 * 開一塊 Board。
 *
 * 印的是不帶成員路徑裝飾的那一行（`renderTable`），同 `new` —— spec.md 的
 * Domain decisions：只有 `rm` 標成員路徑，`set` 每次只印一筆結果，使用者
 * 剛剛才主動指定了 `<ref>`，落在哪個成員早在預期內。
 */
function cmdSet(args: Args, io: Io): number {
  const [ref, field, value] = args.positional;
  const usage = 'usage: nook workspace set <ref> <title|description|status|archived|deleted> <value|->';
  if (ref === undefined || field === undefined) throw new UsageError(usage);
  requireFullRef(ref);
  if (!isSettable(field)) {
    throw new UsageError(`not a writable field: ${field} (available: ${SETTABLE.join(', ')})`);
  }

  const workspace = openWorkspace({ dir: io.cwd });
  const { member, issue } = locateInWorkspace(workspace, ref);

  let text: string;
  if (args.has('--editor')) {
    // 以現值開場 —— 同單一 Board 版本，編輯既有的 description 才是這條路的
    // 實際用途。
    text = fromEditor(io, field === 'title' || field === 'description' ? issue[field] : '');
  } else {
    if (value === undefined) throw new UsageError(usage);
    text = longText(value, io);
  }

  const updated = member.board.apply(ref, asChange(field as Field, text));
  line(io, renderTable([updated], displayLength(member.board)));
  return 0;
}

/**
 * `mv`：`set <ref> status <value>` 的捷徑 —— 跟單一 Board 的 `nook mv`
 * （`run.ts` 的 `cmdMv`）同一個關係，只是目標 board 從哪裡來換成
 * `requireFullRef()` + 既有、未經修改的 `locateInWorkspace()`。
 *
 * `<status>` 的前綴解析（`que` → `queued`）完全交給 `member.board.apply()`
 * 內部既有、未經修改的 `resolveStatus()` —— 這裡只把使用者輸入的原始字串
 * 傳過去，不做任何自己的猜測；不合法的 status 讓既有的 `InvalidStatus`
 * 原樣冒出。
 *
 * 印的是不帶成員路徑裝飾的那一行，同 `set`。
 */
function cmdMv(args: Args, io: Io): number {
  const [ref, status] = args.positional;
  if (ref === undefined || status === undefined) {
    throw new UsageError('usage: nook workspace mv <ref> <status>');
  }
  requireFullRef(ref);

  const workspace = openWorkspace({ dir: io.cwd });
  const { member } = locateInWorkspace(workspace, ref);

  const updated = member.board.apply(ref, { status });
  line(io, renderTable([updated], displayLength(member.board)));
  return 0;
}

/**
 * `comment`：跟單一 Board 的 `nook comment`（`run.ts` 的 `cmdComment`）同一份
 * 組裝邏輯 —— 差別只在目標 board 從哪裡來，這裡靠既有、未經修改的
 * `locateInWorkspace()` 找出擁有 `<ref>` 的成員，而不是對 `io.cwd` 開一塊
 * Board。
 *
 * 印的是不帶成員路徑裝飾的那一行，同 `set`/`mv`。
 */
function cmdComment(args: Args, io: Io): number {
  const [ref, body] = args.positional;
  if (ref === undefined || body === undefined) {
    throw new UsageError('usage: nook workspace comment <ref> <body>');
  }
  requireFullRef(ref);

  const workspace = openWorkspace({ dir: io.cwd });
  const { member } = locateInWorkspace(workspace, ref);

  const updated = member.board.apply(ref, { comment: longText(body, io) });
  line(io, renderTable([updated], displayLength(member.board)));
  return 0;
}

/**
 * `label`：跟單一 Board 的 `nook label`（`run.ts` 的 `cmdLabel`）同一份 token
 * 解析邏輯（`parseLabelTokens`）一字不改地重用，差別只在目標 board 從哪裡來 ——
 * 這裡靠 `requireFullRef()` 與既有、未經修改的 `locateInWorkspace()` 找出擁有
 * `<ref>` 的成員，而不是對 `io.cwd` 開一塊 Board。
 *
 * 印的是不帶成員路徑裝飾的那一行，同 `set`/`mv`/`comment`。
 */
function cmdLabel(args: Args, io: Io): number {
  const [ref, ...tokens] = args.positional;
  if (ref === undefined || tokens.length === 0) {
    throw new UsageError('usage: nook workspace label <ref> +<label> -<label>');
  }
  requireFullRef(ref);

  const { add, remove } = parseLabelTokens(tokens);

  const workspace = openWorkspace({ dir: io.cwd });
  const { member } = locateInWorkspace(workspace, ref);

  const updated = member.board.apply(ref, { labels: { add, remove } });
  line(io, renderTable([updated], displayLength(member.board)));
  return 0;
}

/**
 * 讀到一張已刪的 issue 時，`rm` 該說的那句話。**不是**重用 `run.ts` 的
 * `deletedMessage` —— 那句話指向單一 Board 的 `nook set`/`nook history`，
 * 而這裡復原要用 workspace 版的 `nook workspace set <ref> deleted false`，
 * 看歷史則沒有 workspace 版的 `history`，得先 `cd` 進那個成員再跑
 * `nook history <ref>`。兩句話講的是同一件事、但語意真的不同，所以是新函式
 * 不是共用一份措辭。
 *
 * 前半段仍然借 `IssueDeleted` 自己的 message —— 那句話本身歸那個型別所有，
 * 手抄一份會漂移。
 */
function workspaceDeletedMessage(ref: string, memberPath: string): string {
  return (
    `${new IssueDeleted(ref).message}` +
    ` (cd ${memberPath} then run nook history ${ref} to recover what was written; ` +
    `nook workspace set ${ref} deleted false undoes this)`
  );
}

/**
 * `rm`：跟單一 Board 的 `nook rm`（`run.ts` 的 `cmdRm`）同一個定義 ——
 * 「`set <ref> deleted true` 加上一次確認」，寫入仍然只經過 `member.board.apply`
 * 這一個決定點。差別只在目標 board 從哪裡來（`requireFullRef()` + 既有、未經
 * 修改的 `locateInWorkspace()`），以及這是這條鏈唯一一個確認句與最終輸出都
 * 標示成員路徑的指令 —— spec.md 的 Domain decisions：刪除的救援步驟需要先
 * 知道是哪個成員，其餘五個指令使用者剛剛才主動指定了 `<ref>`，落在哪個成員
 * 早在預期內。
 *
 * 確認句重用既有、未經修改的 `confirmed(io, title)`（`run.ts`）——不改它的
 * 簽章，只是把組好帶成員路徑的字串當 `title` 傳進去。非 TTY、或 TTY 但這個
 * `Io` 沒有 `readLine` 時的拒絕邏輯因此完全繼承，這裡不必重寫。
 */
function cmdRm(args: Args, io: Io): number {
  const [ref] = args.positional;
  if (ref === undefined) throw new UsageError('usage: nook workspace rm <ref> [--yes]');
  requireFullRef(ref);

  const workspace = openWorkspace({ dir: io.cwd });
  const { member, issue } = locateInWorkspace(workspace, ref);
  const relPath = relativeGroupPath(workspace.root(), member.path);

  // 已經刪掉了。問「真的要刪嗎」是在為一次不可能落地的寫入要求一個決定 ——
  // 同單一 Board 版本的既有規則。
  if (issue.deleted) {
    errLine(io, workspaceDeletedMessage(ref, relPath));
    return 1;
  }

  // 守門在任何寫入之前。組好的標題把成員路徑一起帶進 y/N 問句。
  if (!args.has('--yes') && !confirmed(io, `${issue.title} under ${relPath}`)) return 1;

  member.board.apply(ref, { deleted: true });
  // 印正規化後的 issue.id，不是使用者輸入的 ref 原文——同單一 Board 版本的
  // cmdRm（印 target.id），ref 大小寫不敏感，使用者輸入的大小寫不一定是
  // 正規化後的樣子。
  line(io, `Deleted  ${relPath}  ${issue.id.slice(0, displayLength(member.board))}  ${issue.title}`);
  return 0;
}

/**
 * 同 `run.ts` 的 `untilAborted`（未 export，寫入範圍不包含 run.ts，故在此
 * 保留一份小小的複本）——長駐指令等關閉信號，沒有信號就永遠不回。
 */
function untilAborted(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return new Promise<void>(() => {});
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
