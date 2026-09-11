import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../../src/index.js';
import { locateInWorkspace, memberAt } from '../../src/core/workspace.js';
import {
  AmbiguousWorkspaceRef,
  BoardNotInitialized,
  IncompleteRef,
  NotAWorkspaceMember,
  RefNotFoundInWorkspace,
} from '../../src/core/types.js';

// ADR-0004：打真實檔案系統，不引入 mock fs 抽象層。
// 每個測試用例一棵獨立的 mkdtemp 樹，真實 mkdirSync 造拓撲。
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nook-workspace-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 在暫存樹底下造一層深目錄並回傳它。 */
const under = (...parts: string[]): string => {
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** 在某個目錄底下造出一個看起來合法的 board（`.issues/issues/`）。 */
const board = (dir: string): void => {
  mkdirSync(join(dir, '.issues', 'issues'), { recursive: true });
};

describe('openWorkspace() 沒有任何成員', () => {
  it('不拋錯，members 是空陣列', () => {
    const ws = openWorkspace({ dir: root });

    expect(ws.members).toEqual([]);
  });
});

describe('Workspace.root()', () => {
  it('回傳呼叫時傳入的 dir 的絕對路徑', () => {
    const ws = openWorkspace({ dir: root });

    expect(ws.root()).toBe(root);
  });
});

describe('起始目錄自己是成員', () => {
  it('起始目錄含 .issues/issues/ 時它本身也出現在 members 裡', () => {
    board(root);

    const ws = openWorkspace({ dir: root });

    expect(ws.members.map((m) => m.path)).toEqual([root]);
  });
});

describe('遞迴找出更深處的成員', () => {
  it('找到一個成員就不再往它底下更深處掃', () => {
    const a = under('a');
    board(a);
    board(under('a', 'b'));
    board(under('a', 'b', 'c'));

    const ws = openWorkspace({ dir: root });

    expect(ws.members.map((m) => m.path)).toEqual([a]);
  });
});

describe('跳過 node_modules 與 .git', () => {
  it('刻意造在 node_modules／.git 底下的 .issues/issues/ 不算成員', () => {
    board(under('node_modules', 'foo'));
    board(under('.git', 'foo'));
    const real = under('real');
    board(real);

    const ws = openWorkspace({ dir: root });

    expect(ws.members.map((m) => m.path)).toEqual([real]);
  });
});

describe('不追蹤 symlink', () => {
  it('一個指回上層目錄的環狀 symlink 不會讓掃描卡死或重複列出成員', () => {
    const a = under('a');
    board(a);
    symlinkSync(root, join(a, 'loop'));

    const ws = openWorkspace({ dir: root });

    expect(ws.members.map((m) => m.path)).toEqual([a]);
  });
});

describe('讀某個子目錄失敗時跳過那一支', () => {
  it('不可讀的子目錄不中止整個掃描，其餘部分照常完成', () => {
    const unreadable = under('unreadable');
    chmodSync(unreadable, 0o000);
    const readable = under('readable');
    board(readable);

    try {
      const ws = openWorkspace({ dir: root });

      expect(ws.members.map((m) => m.path)).toEqual([readable]);
    } finally {
      // 恢復權限才能讓 afterEach 的 rmSync 正常清掉這棵樹。
      chmodSync(unreadable, 0o755);
    }
  });
});

describe('members 依 path 字典序排序', () => {
  it('同一棵樹多次呼叫結果穩定', () => {
    const b = under('b');
    board(b);
    const a = under('a');
    board(a);

    const first = openWorkspace({ dir: root }).members.map((m) => m.path);
    const second = openWorkspace({ dir: root }).members.map((m) => m.path);

    expect(first).toEqual([a, b].sort());
    expect(second).toEqual(first);
  });
});

describe('WorkspaceMember.board 是功能完整的 Board', () => {
  it('用它 create() 一張 issue、再用它 list() 讀回來', () => {
    const a = under('a');
    board(a);

    const ws = openWorkspace({ dir: root });
    const member = ws.members.find((m) => m.path === a);

    expect(member).toBeDefined();
    member!.board.create({ title: 'Fix login redirect' });
    expect(member!.board.list().map((i) => i.title)).toEqual(['Fix login redirect']);
  });
});

describe('locateInWorkspace()', () => {
  it('給一個不是完整 26 碼的 ref → IncompleteRef', () => {
    const a = under('a');
    board(a);
    const ws = openWorkspace({ dir: root });

    expect(() => locateInWorkspace(ws, '01JBXA')).toThrow(IncompleteRef);
  });

  it('三個成員都不擁有這個 ref → RefNotFoundInWorkspace，訊息帶出掃過幾個成員', () => {
    const a = under('a');
    const b = under('b');
    const c = under('c');
    board(a);
    board(b);
    board(c);
    const ws = openWorkspace({ dir: root });
    const missing = 'A'.repeat(26);

    let thrown: unknown;
    try {
      locateInWorkspace(ws, missing);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RefNotFoundInWorkspace);
    expect((thrown as RefNotFoundInWorkspace).searchedCount).toBe(3);
  });

  it('三個成員剛好一個擁有 → 回傳 { member, issue }，issue 是完整摺好的 Issue', () => {
    const a = under('a');
    const b = under('b');
    const c = under('c');
    board(a);
    board(b);
    board(c);
    const ws = openWorkspace({ dir: root });
    const owner = ws.members.find((m) => m.path === b)!;
    const created = owner.board.create({ title: 'Fix login redirect' });

    const { member, issue } = locateInWorkspace(ws, created.id);

    expect(member.path).toBe(b);
    expect(issue.title).toBe('Fix login redirect');
  });

  it('人為造出兩個成員各自擁有同一個 ULID 的 op-log → AmbiguousWorkspaceRef，訊息列出兩個成員的路徑', () => {
    const a = under('a');
    const b = under('b');
    board(a);
    board(b);
    const ws = openWorkspace({ dir: root });
    const memberA = ws.members.find((m) => m.path === a)!;
    const created = memberA.board.create({ title: 'Duplicated issue' });

    // 人為把同一個 op-log 檔複製到另一個成員底下，模擬資料被複製過。
    const src = join(a, '.issues', 'issues', `${created.id}.ndjson`);
    const dst = join(b, '.issues', 'issues', `${created.id}.ndjson`);
    cpSync(src, dst);

    let thrown: unknown;
    try {
      locateInWorkspace(ws, created.id);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AmbiguousWorkspaceRef);
    expect((thrown as AmbiguousWorkspaceRef).memberPaths.slice().sort()).toEqual([a, b].sort());
  });

  it('對一個已刪除的 issue 呼叫 → 正常回傳，issue.deleted === true，不拋錯', () => {
    const a = under('a');
    board(a);
    const ws = openWorkspace({ dir: root });
    const member = ws.members.find((m) => m.path === a)!;
    const created = member.board.create({ title: 'To be deleted' });
    member.board.apply(created.id, { deleted: true });

    const { issue } = locateInWorkspace(ws, created.id);

    expect(issue.deleted).toBe(true);
  });
});

describe('memberAt()', () => {
  it('給某個成員底下的子目錄（不是根目錄）→ 正確解析回那個成員', () => {
    const a = under('a');
    board(a);
    const sub = under('a', 'sub', 'deep');
    const ws = openWorkspace({ dir: root });
    const expected = ws.members.find((m) => m.path === a)!;

    const resolved = memberAt(ws, sub);

    expect(resolved).toBe(expected);
  });

  it('給一個完全獨立、有 .issues/ 但不在這個 workspace 掃描範圍內的路徑 → NotAWorkspaceMember', () => {
    const a = under('a');
    board(a);
    const ws = openWorkspace({ dir: a }); // workspace 只掃到 a 自己

    const outside = mkdtempSync(join(tmpdir(), 'nook-outside-'));
    try {
      board(outside);

      expect(() => memberAt(ws, outside)).toThrow(NotAWorkspaceMember);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('給一個完全不是 Board 的路徑 → 既有的 BoardNotInitialized 原樣冒出', () => {
    const a = under('a');
    board(a);
    const ws = openWorkspace({ dir: root });
    const notABoard = under('not-a-board');

    expect(() => memberAt(ws, notABoard)).toThrow(BoardNotInitialized);
  });

  it('回傳的是 workspace.members 裡既有的那個物件（同一個 board 實例）', () => {
    const a = under('a');
    board(a);
    const ws = openWorkspace({ dir: root });
    const expected = ws.members.find((m) => m.path === a)!;

    const resolved = memberAt(ws, a);

    expect(resolved.board).toBe(expected.board);
  });
});
