import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBoard } from './board.js';
import { ISSUES_DIR } from './gitattributes.js';
import type { OpenWorkspaceOptions, Workspace, WorkspaceMember } from './types.js';

/** 已知不可能含使用者自建的 .issues/ —— 跳過純粹省時間，見 ADR-0012。 */
const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules']);

/** 同 `findBoardRoot` 的判斷（`gitattributes.ts`），只有一份 `ISSUES_DIR`。 */
const hasBoard = (dir: string): boolean => existsSync(join(dir, ...ISSUES_DIR));

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
    // Dirent 的型別是 lstat 語意：一個指向目錄的 symlink 本身回報
    // isDirectory() === false（isSymbolicLink() 才是 true）。這一條因此
    // 同時擋掉「不是目錄」與「是指向目錄的 symlink」——不追蹤 symlink，
    // 避免環路造成無限遞迴，靠的就是這裡，不必再另外判一次。
    if (!entry.isDirectory()) continue;
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
