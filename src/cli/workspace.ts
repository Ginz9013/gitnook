import { relative } from 'node:path';
import { openWorkspace } from '../core/workspace.js';
import { renderWorkspaceList } from '../render/table.js';
import { displayLength, line, parseArgs, UsageError, type Args, type Io } from './run.js';
import type { Filter } from '../core/types.js';
import type { WorkspaceGroup } from '../render/table.js';

/**
 * `nook workspace <list|...>` 的 argv → Workspace → render → exit code。
 *
 * 跟 `run.ts` 對單一 Board 的既有指令同一個薄度量級 —— 複雜度屬於
 * `openWorkspace()`（核心）與 `renderWorkspaceList()`（呈現），這裡只接線。
 *
 * 目前只認得 `list`；`doctor`/`studio` 是後續票（03/04）的範圍。
 */
export async function dispatchWorkspace(argv: readonly string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;

  switch (sub) {
    case 'list':
      return cmdList(parseArgs(rest, LIST_FLAGS), io);
  }

  // 同 `run.ts` 的 `unknownCommand`：使用者錯誤只走 UsageError 這一條路徑，
  // 不在這裡另開一份手寫的 errLine + return 1。
  throw new UsageError(`未知的 workspace 子指令：${sub ?? ''}（目前只有 list）`);
}

const LIST_FLAGS: ReadonlySet<string> = new Set(['--all', '--status', '--label', '--json']);

/**
 * 一個成員路徑相對於 workspace 根目錄的顯示形式。成員本身就是根目錄時
 * `relative()` 回傳空字串 —— 印一個空字串等於沒有標頭，改印 `.`。
 */
const relativeGroupPath = (root: string, path: string): string => {
  const rel = relative(root, path);
  return rel === '' ? '.' : rel;
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
