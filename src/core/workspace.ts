import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBoard } from './board.js';
import type { OpenWorkspaceOptions, Workspace, WorkspaceMember } from './types.js';

/** 已知不可能含使用者自建的 .issues/ —— 跳過純粹省時間，見 ADR-0012。 */
const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules']);

const hasBoard = (dir: string): boolean => existsSync(join(dir, '.issues', 'issues'));

/**
 * 遞迴掃描 dir 找出全部成員路徑。找到一個成員就不再往它底下更深處掃 ——
 * 那一支的搜尋在此停止，不會有巢狀更深處的 Board 被重複列進來。
 */
function scan(dir: string, members: string[]): void {
  if (hasBoard(dir)) {
    members.push(dir);
    return;
  }

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // 讀某個子目錄失敗（例如 EACCES）時跳過那一支，不中止整個掃描。
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // withFileTypes 篩掉 symlink：不追蹤 symlink 目錄，避免環路造成無限遞迴。
    if (entry.isSymbolicLink()) continue;
    if (SKIPPED_DIR_NAMES.has(entry.name)) continue;
    scan(join(dir, entry.name), members);
  }
}

export function openWorkspace(opts: OpenWorkspaceOptions = {}): Workspace {
  const root = resolve(opts.dir ?? process.cwd());

  const paths: string[] = [];
  scan(root, paths);
  paths.sort();

  const members: readonly WorkspaceMember[] = paths.map((path) => ({
    path,
    board: openBoard({ dir: path }),
  }));

  return {
    members,
    root(): string {
      return root;
    },
  };
}
