import { relative } from 'node:path';
import { openWorkspace } from '../core/workspace.js';
import { repair } from '../core/health.js';
import { renderWorkspaceList } from '../render/table.js';
import { serveWorkspace } from '../server/serveWorkspace.js';
import {
  displayLength,
  formatDiagnostic,
  formatRepaired,
  line,
  parseArgs,
  UsageError,
  type Args,
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
 * 目前認得 `list`/`doctor`/`studio`。
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
  }

  // 同 `run.ts` 的 `unknownCommand`：使用者錯誤只走 UsageError 這一條路徑，
  // 不在這裡另開一份手寫的 errLine + return 1。
  throw new UsageError(`未知的 workspace 子指令：${sub ?? ''}（目前只有 list、doctor、studio）`);
}

const LIST_FLAGS: ReadonlySet<string> = new Set(['--all', '--status', '--label', '--json']);
const DOCTOR_FLAGS: ReadonlySet<string> = new Set(['--fix']);
const STUDIO_FLAGS: ReadonlySet<string> = new Set(['--port']);

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
  return rel === '.' ? '. （workspace 根目錄本身也是一個成員 Board）' : rel;
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
    throw new UsageError(`不是合法的 port：${given}`);
  }

  const workspace = openWorkspace({ dir: io.cwd });
  const studio = await serveWorkspace(workspace, port === undefined ? {} : { port });
  line(io, studio.url);

  await untilAborted(io.signal);
  await studio.close();
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
