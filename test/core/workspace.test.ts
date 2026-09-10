import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../../src/index.js';

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
