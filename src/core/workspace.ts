import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBoard } from './board.js';
import { lazyDecisionLog } from './decisionLog.js';
import { readNookConfig } from './nookConfig.js';
import { isFullRef } from './ids.js';
import {
  AmbiguousWorkspaceRef,
  IncompleteRef,
  NotAWorkspaceMember,
  RefNotFound,
  RefNotFoundInWorkspace,
} from './types.js';
import type { Issue, OpenWorkspaceOptions, Workspace, WorkspaceMember } from './types.js';
import { AmbiguousDecisionWorkspaceRef, DecisionNotFound, DecisionRefNotFoundInWorkspace } from './decisionTypes.js';
import type { Decision } from './decisionTypes.js';

/** 已知不可能含使用者自建的 .gitnook/ —— 跳過純粹省時間，見 ADR-0012。 */
const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules']);

/**
 * 票 04：只問 `.gitnook/` 這個容器目錄存不存在，不分別問 issues／decisions
 * 兩個子目錄——一個只 init 過 decision 側的目錄（legacy 過渡期，或先手動只
 * 跑過一半）照樣是一個 workspace 成員，`board`／`decisionLog` 各自有沒有初
 * 始化是它們自己的事。
 */
const hasBoard = (dir: string): boolean => existsSync(join(dir, '.gitnook'));

/**
 * 這個 board 有沒有在 `.gitnook/config.json` 宣告自己也是一個 workspace 節點
 * ——`true` 時 `scan()` 會繼續往它底下鑽（見 `scan()` 的呼叫端）。
 *
 * 疊在 `readNookConfig()`（`nookConfig.ts`）上：檔案不存在或格式錯誤一律安全
 * 失敗成 `{}`，`workspace` 讀不到就是 falsy——這是這個承諾在 `scan()` 這個熱
 * 路徑上真的成立的地方，一個壞掉的 config.json 不會讓整趟掃描掛掉，只會讓
 * 那一支維持既有的「找到就停」。
 */
function isWorkspaceRoot(dir: string): boolean {
  return readNookConfig(dir).workspace === true;
}

/**
 * 遞迴掃描 dir 找出全部成員路徑。找到一個成員預設不再往它底下更深處掃——
 * 那一支的搜尋在此停止，不會有巢狀更深處的 Board 被重複列進來。**除非**這個
 * board 自己透過 `.gitnook/config.json` 的 `workspace: true` 宣告「我也是一個
 * workspace 節點」，此時繼續往下鑽，子目錄裡遇到的 board 遞迴套用同一條規則
 * ——這個特性掛在 board 自己身上，不特殊化呼叫端傳入的那個 root。
 */
function scan(dir: string, members: string[]): void {
  if (hasBoard(dir)) {
    members.push(dir);
    if (!isWorkspaceRoot(dir)) return;
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

  const members: readonly WorkspaceMember[] = paths.map((path) => {
    const board = openBoard({ dir: path });
    return { path, board, decisionLog: lazyDecisionLog(board) };
  });

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
 * 對稱於 `locateInWorkspace()`，但找的是 Decision：在一組成員的 `decisionLog`
 * 裡找出擁有 ref 的那一個。ref 同樣必須是完整 26 碼 ULID（理由同
 * `locateInWorkspace()`）。不重用 issue 側的 `RefNotFoundInWorkspace`/
 * `AmbiguousWorkspaceRef`——兩者各自的呼叫端只需要 catch 各自的型別，硬共用
 * 只會讓呼叫端多一次「這其實是哪一種 ref」的判斷。
 */
export function locateDecisionInWorkspace(
  workspace: Workspace,
  ref: string,
): { readonly member: WorkspaceMember; readonly decision: Decision } {
  if (!isFullRef(ref)) throw new IncompleteRef(ref);

  const hits: { readonly member: WorkspaceMember; readonly decision: Decision }[] = [];
  for (const member of workspace.members) {
    try {
      // 只接 DecisionNotFound：同 locateInWorkspace() 的既有推理，完整 26 碼
      // ref 讓單一成員的 resolve() 永遠不會丟 AmbiguousDecisionRef——「多個
      // 成員各自擁有同一個 ref」只可能發生在成員之間，交給下面的
      // hits.length 檢查處理。其餘例外原樣拋出，不吞。
      hits.push({ member, decision: member.decisionLog.get(ref) });
    } catch (err) {
      if (err instanceof DecisionNotFound) continue;
      throw err;
    }
  }

  if (hits.length === 0) throw new DecisionRefNotFoundInWorkspace(ref, workspace.members.length);
  if (hits.length > 1) {
    throw new AmbiguousDecisionWorkspaceRef(
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
