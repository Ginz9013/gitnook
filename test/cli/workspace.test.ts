import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard, initBoard } from '../../src/index.js';
import { dispatchWorkspace } from '../../src/cli/workspace.js';
import type { Io } from '../../src/cli/run.js';
import type { CreateInput, IdSource, Issue } from '../../src/index.js';

// ADR-0004：真實檔案系統，每個測試用例一棵獨立的 mkdtemp 樹。
// Io 沿用 test/cli/run.test.ts 的 capture adapter 手法 —— CLI 測試不得 spawn 子行程。
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nook-workspace-cli-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Capture extends Io {
  out: string;
  err: string;
}

function capture(cwd: string = root): Capture {
  return {
    out: '',
    err: '',
    cwd,
    env: {},
    isTty: false,
    write(text: string) {
      this.out += text;
    },
    writeError(text: string) {
      this.err += text;
    },
    readStdin(): string {
      throw new Error('測試未提供 stdin');
    },
  };
}

const fullId = (prefix: string): string => prefix.padEnd(26, '0');

/** 種子化的 IdSource —— 輸出要能拿來跟手寫的期望值逐字比對。 */
function seeded(issueId: string): IdSource {
  let n = 0;
  return { ulid: () => (n++ === 0 ? issueId : issueId.slice(0, 8) + String(n).padStart(18, '0')) };
}

/** 在 workspace 根目錄底下的某個子路徑建一塊真的 board，回傳它的絕對路徑。 */
function member(...parts: string[]): string {
  const dir = join(root, ...parts);
  initBoard(dir);
  return dir;
}

const createIn = (dir: string, prefix: string, input: CreateInput): Issue =>
  openBoard({ dir, actor: 'test', ids: seeded(fullId(prefix)) }).create(input);

describe('dispatchWorkspace list — 依子專案分組', () => {
  it('兩個子專案各自有 issue，印出兩段，各自標著相對於 workspace 根目錄的路徑', async () => {
    const a = member('pkgs', 'a');
    const b = member('pkgs', 'b');
    createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', { title: 'a 的任務', status: 'queued' } as CreateInput);
    createIn(b, '01JBX8BBBBBBBBBBBBBBBBBBBB', { title: 'b 的任務', status: 'todo' } as CreateInput);

    const io = capture();
    const code = await dispatchWorkspace(['list'], io);

    expect(code).toBe(0);
    expect(io.out).toContain('pkgs/a');
    expect(io.out).toContain('pkgs/b');
    expect(io.out).toContain('a 的任務');
    expect(io.out).toContain('b 的任務');
    // 兩段之間有清楚的視覺分隔 —— renderWorkspaceList 組間空一行。
    const aIndex = io.out.indexOf('pkgs/a');
    const bIndex = io.out.indexOf('pkgs/b');
    expect(io.out.slice(aIndex, bIndex)).toContain('\n\n');
    expect(io.err).toBe('');
  });
});

describe('dispatchWorkspace list — 空 workspace', () => {
  it('完全掃不到任何成員時仍然 exit 0，印出彙整訊息而非報錯', async () => {
    const io = capture();

    const code = await dispatchWorkspace(['list'], io);

    expect(code).toBe(0);
    expect(io.out).toBe('沒有 issue\n');
    expect(io.err).toBe('');
  });
});

describe('dispatchWorkspace list — 篩選旗標套用到每個成員', () => {
  it('預設隱藏 done/cancelled，語意與單一 board 的 list 一致', async () => {
    const a = member('pkgs', 'a');
    createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', { title: '還沒做完', status: 'todo' } as CreateInput);
    createIn(a, '01JBX7CCCCCCCCCCCCCCCCCCCC', { title: '已完成', status: 'done' } as CreateInput);

    const io = capture();
    await dispatchWorkspace(['list'], io);

    expect(io.out).toContain('還沒做完');
    expect(io.out).not.toContain('已完成');
  });

  it('--all 對每個成員各自套用，跟單一 board 一樣不再隱藏 done/cancelled', async () => {
    const a = member('pkgs', 'a');
    createIn(a, '01JBX7CCCCCCCCCCCCCCCCCCCC', { title: '已完成', status: 'done' } as CreateInput);

    const io = capture();
    await dispatchWorkspace(['list', '--all'], io);

    expect(io.out).toContain('已完成');
  });

  it('--status 只留下指定狀態，套用到每個成員', async () => {
    const a = member('pkgs', 'a');
    createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', { title: 'todo 的', status: 'todo' } as CreateInput);
    createIn(a, '01JBX7DDDDDDDDDDDDDDDDDDDD', { title: 'queued 的', status: 'queued' } as CreateInput);

    const io = capture();
    await dispatchWorkspace(['list', '--status', 'queued'], io);

    expect(io.out).toContain('queued 的');
    expect(io.out).not.toContain('todo 的');
  });

  it('--label 是收斂條件（AND），套用到每個成員', async () => {
    const a = member('pkgs', 'a');
    createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '有 bug label',
      status: 'todo',
      labels: ['bug'],
    } as CreateInput);
    createIn(a, '01JBX7EEEEEEEEEEEEEEEEEEEE', {
      title: '沒有 bug label',
      status: 'todo',
    } as CreateInput);

    const io = capture();
    await dispatchWorkspace(['list', '--label', 'bug'], io);

    expect(io.out).toContain('有 bug label');
    expect(io.out).not.toContain('沒有 bug label');
  });
});

describe('dispatchWorkspace list — 篩選後整組為空時的呈現', () => {
  it('某個成員篩選後一張都不剩時，那一組整組不列出', async () => {
    const a = member('pkgs', 'a');
    const b = member('pkgs', 'b');
    createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', { title: 'a 有東西', status: 'todo' } as CreateInput);
    createIn(b, '01JBX7BBBBBBBBBBBBBBBBBBBB', { title: 'b 已完成', status: 'done' } as CreateInput);

    const io = capture();
    await dispatchWorkspace(['list'], io);

    expect(io.out).toContain('pkgs/a');
    expect(io.out).not.toContain('pkgs/b');
  });

  it('全部成員篩選後都是空的，印一句彙整訊息，不是逐組重複', async () => {
    const a = member('pkgs', 'a');
    const b = member('pkgs', 'b');
    createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', { title: 'a 已完成', status: 'done' } as CreateInput);
    createIn(b, '01JBX7BBBBBBBBBBBBBBBBBBBB', { title: 'b 已完成', status: 'done' } as CreateInput);

    const io = capture();
    const code = await dispatchWorkspace(['list'], io);

    expect(code).toBe(0);
    expect(io.out).toBe('沒有 issue\n');
  });
});

describe('dispatchWorkspace list — --json', () => {
  it('輸出可被解析，且看得出哪些 issue 屬於哪個成員路徑', async () => {
    const a = member('pkgs', 'a');
    const b = member('pkgs', 'b');
    createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', { title: 'a 的任務', status: 'todo' } as CreateInput);
    createIn(b, '01JBX7BBBBBBBBBBBBBBBBBBBB', { title: 'b 的任務', status: 'todo' } as CreateInput);

    const io = capture();
    const code = await dispatchWorkspace(['list', '--json'], io);

    expect(code).toBe(0);
    const parsed = JSON.parse(io.out) as Array<{ path: string; issues: Issue[] }>;
    const byPath = new Map(parsed.map((g) => [g.path, g.issues.map((i) => i.title)]));
    expect(byPath.get('pkgs/a')).toEqual(['a 的任務']);
    expect(byPath.get('pkgs/b')).toEqual(['b 的任務']);
  });

  it('篩選後整組為空的成員不出現在 --json 輸出裡', async () => {
    const a = member('pkgs', 'a');
    const b = member('pkgs', 'b');
    createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', { title: 'a 的任務', status: 'todo' } as CreateInput);
    createIn(b, '01JBX7BBBBBBBBBBBBBBBBBBBB', { title: 'b 已完成', status: 'done' } as CreateInput);

    const io = capture();
    await dispatchWorkspace(['list', '--json'], io);

    const parsed = JSON.parse(io.out) as Array<{ path: string }>;
    expect(parsed.map((g) => g.path)).toEqual(['pkgs/a']);
  });
});
