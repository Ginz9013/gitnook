import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard, initBoard } from '../../src/index.js';
import { dispatchWorkspace } from '../../src/cli/workspace.js';
import {
  InvalidStatus,
  IssueDeleted,
  NotAWorkspaceMember,
  RefNotFoundInWorkspace,
} from '../../src/core/types.js';
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

function capture(opts: { cwd?: string; signal?: AbortSignal } = {}): Capture {
  return {
    out: '',
    err: '',
    cwd: opts.cwd ?? root,
    env: {},
    isTty: false,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
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

/**
 * `doctor` 要測的是真實的健康狀態，所以 workspace 根目錄得是一個真的 git work
 * tree（同 test/core/health.test.ts 的手法）—— 沒有 git，`diagnose()` 對每個
 * 成員都會回報 `NotAGitRepo`，「一個成員不健康、其餘健康」就無從造起。只設
 * local 設定，不依賴也不修改使用者的全域 git 設定。
 */
function gitInit(): void {
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@nook.invalid'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Nook Test'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root, stdio: 'ignore' });
}

/** 覆寫掉 initBoard 寫入的 merge=union 那一行 —— 同 health.test.ts 造 MissingMergeDriver 的手法。 */
function breakMergeGuarantee(memberDir: string): void {
  writeFileSync(join(memberDir, '.gitattributes'), '*.png binary\n', 'utf8');
}

/** 一份黏合行 —— 同 health.test.ts，`repair()` 有東西可修才測得出 --fix 的效果。 */
function writeGluedOpLog(memberDir: string, id: string): void {
  const create = '{"id":"a1","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}';
  const setOp = '{"id":"a2","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}';
  const label = '{"id":"a3","t":3,"a":"k3f9","op":"label.add","v":"bug"}';
  // 第 2 行是黏合行（缺 trailing newline 造成的兩個 op 黏一起）。
  writeFileSync(
    join(memberDir, '.issues', 'issues', `${id}.ndjson`),
    `${create}\n${setOp}${label}\n`,
    'utf8',
  );
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

describe('dispatchWorkspace doctor — 全部成員健康', () => {
  it('完全沉默，exit 0（同單一 Board doctor 的既有慣例）', async () => {
    gitInit();
    member('pkgs', 'a');
    member('pkgs', 'b');

    const io = capture();
    const code = await dispatchWorkspace(['doctor'], io);

    expect(code).toBe(0);
    expect(io.out).toBe('');
    expect(io.err).toBe('');
  });
});

describe('dispatchWorkspace doctor — 空 workspace', () => {
  it('掃不到任何成員時沉默、exit 0', async () => {
    gitInit();

    const io = capture();
    const code = await dispatchWorkspace(['doctor'], io);

    expect(code).toBe(0);
    expect(io.out).toBe('');
    expect(io.err).toBe('');
  });
});

describe('dispatchWorkspace doctor — 一個成員不健康', () => {
  it('印出那個成員的路徑與 diagnostic，其餘健康的成員不印任何東西，exit 1', async () => {
    gitInit();
    const a = member('pkgs', 'a');
    member('pkgs', 'b');
    breakMergeGuarantee(a);

    const io = capture();
    const code = await dispatchWorkspace(['doctor'], io);

    expect(code).toBe(1);
    expect(io.out).toContain('pkgs/a');
    expect(io.out).toContain('MissingMergeDriver');
    expect(io.out).not.toContain('pkgs/b');
  });
});

describe('dispatchWorkspace doctor — workspace 根目錄自己也是一個成員', () => {
  it('那一行不是孤零零一個 . ，清楚標出是根目錄那個成員 Board 的問題', async () => {
    gitInit();
    member(); // 根目錄自己 init 一塊 board
    breakMergeGuarantee(root);

    const io = capture();
    const code = await dispatchWorkspace(['doctor'], io);

    expect(code).toBe(1);
    expect(io.out).toContain('MissingMergeDriver');
    // 不是裸的一個點：那樣讀起來像「workspace 這個工具自己」的問題。
    expect(io.out).not.toMatch(/^\.\s{2}MissingMergeDriver/m);
    expect(io.out).toContain('workspace 根目錄本身');
  });
});

describe('dispatchWorkspace doctor --fix', () => {
  it('對每個有 diagnostic 的成員各自呼叫既有 repair()，印出對應的 Repaired 行', async () => {
    gitInit();
    const a = member('pkgs', 'a');
    member('pkgs', 'b');
    writeGluedOpLog(a, '01SEED00000000000000000001');

    const io = capture();
    const code = await dispatchWorkspace(['doctor', '--fix'], io);

    expect(io.out).toContain('pkgs/a');
    expect(io.out).toContain('Repaired');
    expect(io.out).not.toContain('pkgs/b');
    // 修完之後那條 GluedLine 不該再出現 —— --fix 修的是真正的檔案。
    expect(code).toBe(0);
  });
});

/** 長駐指令（studio）的關閉信號。測試失敗時也一定要收乾淨，否則 vitest 掛住。 */
const running: AbortController[] = [];

afterEach(() => {
  for (const stop of running.splice(0)) stop.abort();
});

/** 同 test/cli/run.test.ts 的手法：輪詢 capture 的 stdout 直到符合某個樣式。 */
async function waitFor(io: Capture, pattern: RegExp): Promise<string> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const match = io.out.match(pattern);
    if (match !== null) return match[0];
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等不到符合 ${pattern} 的輸出：${JSON.stringify(io.out)}`);
}

describe('dispatchWorkspace new — 缺少 --in', () => {
  it('拋出 UsageError，訊息講清楚用法', async () => {
    member('pkgs', 'a');
    const io = capture();

    await expect(dispatchWorkspace(['new', 'Fix login redirect'], io)).rejects.toThrow(/--in/);
  });
});

describe('dispatchWorkspace new — 成功建立在正確的成員底下', () => {
  it('印出完整 26 碼 ULID，且只有目標成員的 board 有變化', async () => {
    const a = member('pkgs', 'a');
    const b = member('pkgs', 'b');
    const io = capture();

    const code = await dispatchWorkspace(['new', 'Fix login redirect', '--in', a], io);

    expect(code).toBe(0);
    const ref = io.out.trim();
    expect(ref).toHaveLength(26);
    expect(openBoard({ dir: a }).get(ref).title).toBe('Fix login redirect');
    expect(openBoard({ dir: b }).list({ all: true })).toEqual([]);
    expect(io.err).toBe('');
  });
});

describe('dispatchWorkspace new — --in 指向成員底下的子目錄', () => {
  it('沿用既有向上尋根，仍然解析到正確的成員', async () => {
    const a = member('pkgs', 'a');
    const sub = join(a, 'src', 'nested');
    mkdirSync(sub, { recursive: true });
    const io = capture();

    const code = await dispatchWorkspace(['new', 'Fix login redirect', '--in', sub], io);

    expect(code).toBe(0);
    const ref = io.out.trim();
    expect(openBoard({ dir: a }).get(ref).title).toBe('Fix login redirect');
  });
});

describe('dispatchWorkspace new — --in 指向 workspace 掃描範圍外的路徑', () => {
  it('即使那裡真的有一塊 Board，也拋出 NotAWorkspaceMember', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'nook-workspace-outside-'));
    initBoard(outside);
    try {
      const io = capture();

      await expect(
        dispatchWorkspace(['new', 'Fix login redirect', '--in', outside], io),
      ).rejects.toThrow(NotAWorkspaceMember);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('dispatchWorkspace new — --description/--label/--editor 語意同單一 Board', () => {
  it('--description 與 --label 組裝進 CreateInput', async () => {
    const a = member('pkgs', 'a');
    const io = capture();

    const code = await dispatchWorkspace(
      ['new', 'Fix login redirect', '--in', a, '--description', 'body', '--label', 'bug'],
      io,
    );

    expect(code).toBe(0);
    const ref = io.out.trim();
    const issue = openBoard({ dir: a }).get(ref);
    expect(issue.description).toBe('body');
    expect(issue.labels).toEqual(['bug']);
  });

  it('--editor 在非 TTY 時報錯，不留下半個更動', async () => {
    const a = member('pkgs', 'a');
    const io = capture();

    await expect(
      dispatchWorkspace(['new', 'Fix login redirect', '--in', a, '--editor'], io),
    ).rejects.toThrow(/--editor/);
    expect(openBoard({ dir: a }).list({ all: true })).toEqual([]);
  });
});

describe('dispatchWorkspace set — 完整 ULID 對到正確的成員', () => {
  it('該欄位被正確更新，其餘成員完全不受影響，回印更新後那一行且不帶成員路徑裝飾', async () => {
    const a = member('pkgs', 'a');
    const b = member('pkgs', 'b');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);
    createIn(b, '01JBX7BBBBBBBBBBBBBBBBBBBB', { title: 'b 的任務', status: 'todo' } as CreateInput);

    const io = capture();
    const code = await dispatchWorkspace(['set', issue.id, 'title', '新標題'], io);

    expect(code).toBe(0);
    expect(openBoard({ dir: a }).get(issue.id).title).toBe('新標題');
    expect(openBoard({ dir: b }).get('01JBX7BBBBBBBBBBBBBBBBBBBB').title).toBe('b 的任務');
    expect(io.out).toContain('新標題');
    expect(io.out).not.toContain('pkgs/a');
    expect(io.err).toBe('');
  });
});

describe('dispatchWorkspace set — 短前綴拒絕', () => {
  it('即使在該成員裡其實無歧義，也拒絕並清楚說明跨 board 操作需要完整 ULID', async () => {
    const a = member('pkgs', 'a');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);
    const shortRef = issue.id.slice(0, 8);

    const io = capture();

    await expect(dispatchWorkspace(['set', shortRef, 'title', '新標題'], io)).rejects.toThrow(
      /完整.*ULID/,
    );
    expect(openBoard({ dir: a }).get(issue.id).title).toBe('原本標題');
  });
});

describe('dispatchWorkspace set — 沒有成員擁有這個 ref', () => {
  it('拋出 RefNotFoundInWorkspace', async () => {
    member('pkgs', 'a');
    member('pkgs', 'b');
    const io = capture();

    await expect(
      dispatchWorkspace(['set', 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ', 'title', '新標題'], io),
    ).rejects.toThrow(RefNotFoundInWorkspace);
  });
});

describe('dispatchWorkspace set — --editor 語意同單一 Board', () => {
  it('非 TTY 時報錯，不留下半個更動', async () => {
    const a = member('pkgs', 'a');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);

    const io = capture();

    await expect(
      dispatchWorkspace(['set', issue.id, 'description', 'ignored', '--editor'], io),
    ).rejects.toThrow(/--editor/);
    expect(openBoard({ dir: a }).get(issue.id).description).toBe('');
  });
});

describe('dispatchWorkspace set — 非法欄位', () => {
  it('拋出跟單一 Board 版本一致的錯誤訊息', async () => {
    const a = member('pkgs', 'a');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);

    const io = capture();

    await expect(dispatchWorkspace(['set', issue.id, 'priority', 'high'], io)).rejects.toThrow(
      '不是可寫的欄位：priority（可用：title, description, status, archived, deleted）',
    );
  });
});

describe('dispatchWorkspace set — 對已刪除的 issue 寫入', () => {
  it('deleted 之外的欄位寫入時，既有的 IssueDeleted 原樣冒出', async () => {
    const a = member('pkgs', 'a');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);
    openBoard({ dir: a }).apply(issue.id, { deleted: true });

    const io = capture();

    await expect(
      dispatchWorkspace(['set', issue.id, 'title', '新標題'], io),
    ).rejects.toThrow(IssueDeleted);
  });
});

describe('dispatchWorkspace mv — 完整 ULID 對到正確的成員', () => {
  it('status 被正確更新，其餘成員不受影響', async () => {
    const a = member('pkgs', 'a');
    const b = member('pkgs', 'b');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);
    createIn(b, '01JBX7BBBBBBBBBBBBBBBBBBBB', { title: 'b 的任務', status: 'todo' } as CreateInput);

    const io = capture();
    const code = await dispatchWorkspace(['mv', issue.id, 'queued'], io);

    expect(code).toBe(0);
    expect(openBoard({ dir: a }).get(issue.id).status).toBe('queued');
    expect(openBoard({ dir: b }).get('01JBX7BBBBBBBBBBBBBBBBBBBB').status).toBe('todo');
    expect(io.out).toContain('queued');
    expect(io.err).toBe('');
  });
});

describe('dispatchWorkspace mv — status 接受無歧義前綴', () => {
  it('"que" 解析成 "queued"，同單一 Board 版本', async () => {
    const a = member('pkgs', 'a');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);

    const io = capture();
    const code = await dispatchWorkspace(['mv', issue.id, 'que'], io);

    expect(code).toBe(0);
    expect(openBoard({ dir: a }).get(issue.id).status).toBe('queued');
  });
});

describe('dispatchWorkspace mv — 短前綴拒絕', () => {
  it('即使在該成員裡其實無歧義，也拒絕並清楚說明跨 board 操作需要完整 ULID', async () => {
    const a = member('pkgs', 'a');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);
    const shortRef = issue.id.slice(0, 8);

    const io = capture();

    await expect(dispatchWorkspace(['mv', shortRef, 'queued'], io)).rejects.toThrow(/完整.*ULID/);
    expect(openBoard({ dir: a }).get(issue.id).status).toBe('todo');
  });
});

describe('dispatchWorkspace mv — 沒有成員擁有這個 ref', () => {
  it('拋出 RefNotFoundInWorkspace', async () => {
    member('pkgs', 'a');
    member('pkgs', 'b');
    const io = capture();

    await expect(
      dispatchWorkspace(['mv', 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ', 'queued'], io),
    ).rejects.toThrow(RefNotFoundInWorkspace);
  });
});

describe('dispatchWorkspace mv — 不合法的 status', () => {
  it('既有的 InvalidStatus 原樣冒出', async () => {
    const a = member('pkgs', 'a');
    const issue = createIn(a, '01JBX7AAAAAAAAAAAAAAAAAAAA', {
      title: '原本標題',
      status: 'todo',
    } as CreateInput);

    const io = capture();

    await expect(dispatchWorkspace(['mv', issue.id, 'not-a-status'], io)).rejects.toThrow(
      InvalidStatus,
    );
  });
});

describe('dispatchWorkspace studio — --port 參數解析', () => {
  it('不是合法的 port 時報 UsageError，不啟動任何 server', async () => {
    const io = capture();

    await expect(dispatchWorkspace(['studio', '--port', 'nope'], io)).rejects.toThrow(/port/);
  });

  it('port 超出合法範圍時報 UsageError', async () => {
    const io = capture();

    await expect(dispatchWorkspace(['studio', '--port', '99999'], io)).rejects.toThrow(/port/);
  });
});

describe('dispatchWorkspace studio — 開 landing server、收到關閉信號後乾淨結束', () => {
  it('印出 landing page 的 URL，/ 列出全部成員；關閉信號後 URL 連不上', async () => {
    member('pkgs', 'a');
    member('pkgs', 'b');
    const stop = new AbortController();
    running.push(stop);
    const io = capture({ signal: stop.signal });

    // 共用資源紀律：一律綁 port 0 由 OS 指派，不得硬編碼 port。
    const finished = dispatchWorkspace(['studio', '--port', '0'], io);
    const url = await waitFor(io, /http:\/\/[\d.]+:\d+/);

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(join(root, 'pkgs', 'a'));
    expect(html).toContain(join(root, 'pkgs', 'b'));

    stop.abort();
    expect(await finished).toBe(0);
    await expect(fetch(`${url}/`)).rejects.toThrow();
  });
});
