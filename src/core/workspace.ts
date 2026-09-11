import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBoard } from './board.js';
import { ISSUES_DIR } from './gitattributes.js';
import { isFullRef } from './ids.js';
import {
  AmbiguousWorkspaceRef,
  IncompleteRef,
  NotAWorkspaceMember,
  RefNotFound,
  RefNotFoundInWorkspace,
} from './types.js';
import type { Issue, OpenWorkspaceOptions, Workspace, WorkspaceMember } from './types.js';

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

/**
 * 在一組成員 Board 裡找出擁有 ref 的那一個。ref 必須是完整 26 碼 ULID ——
 * 跨 board 天生更容易撞號，短前綴在單一 Board 內可能無歧義，兩個獨立
 * board 各自的前綴卻可能剛好相同、指向不同 issue（spec.md Non-goals）。
 */
export function locateInWorkspace(
  workspace: Workspace,
  ref: string,
): { readonly member: WorkspaceMember; readonly issue: Issue } {
  if (!isFullRef(ref)) throw new IncompleteRef(ref);

  const hits: { readonly member: WorkspaceMember; readonly issue: Issue }[] = [];
  for (const member of workspace.members) {
    try {
      // 只接 RefNotFound：對一個完整 26 碼的 ref，board.get() 內部的
      // resolvePrefix() 退化成單純的相等比對（全部 id 都是 26 碼，
      // startsWith 在這個長度下等於 ===），所以單一成員永遠不會對完整
      // ref 拋 AmbiguousRef——「多個成員各自擁有同一個 ref」這件事只可能
      // 發生在成員之間，交給下面的 hits.length 檢查處理，不會從這裡漏進來。
      // 其餘例外（例如成員的 .issues/ 在掃描之後被移走）原樣拋出，不吞。
      hits.push({ member, issue: member.board.get(ref) });
    } catch (err) {
      if (err instanceof RefNotFound) continue;
      throw err;
    }
  }

  if (hits.length === 0) throw new RefNotFoundInWorkspace(ref, workspace.members.length);
  if (hits.length > 1) {
    throw new AmbiguousWorkspaceRef(
      ref,
      hits.map((h) => h.member.path),
    );
  }
  return hits[0]!;
}

/**
 * 驗證某個路徑是否真的屬於這個 workspace，回傳既有的 WorkspaceMember
 * （同一個 board 實例，不是重新 openBoard() 開出來的新實例）。path 不必
 * 剛好是某個成員的根目錄 —— 沿用 openBoard() 既有的向上尋根。
 */
export function memberAt(workspace: Workspace, path: string): WorkspaceMember {
  const resolvedRoot = openBoard({ dir: path }).root();
  const member = workspace.members.find((m) => m.path === resolvedRoot);
  if (member === undefined) throw new NotAWorkspaceMember(resolvedRoot, workspace.root());
  return member;
}
