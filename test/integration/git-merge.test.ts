import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
import { initBoard } from '../../src/core/gitattributes.js';
import { diagnose, repair } from '../../src/core/health.js';

// ADR-0004：**不得以 in-memory fake 取代 git**。這個檔案的全部價值就在於打真實的
// git —— 它把 spike-findings.md 的手工驗證（T1/T3/T4）變成永久的迴歸閘門。
// 四個硬指標之一「並行 merge 零衝突」由此守住。

const repos: string[] = [];

afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface GitResult {
  readonly status: number;
  readonly output: string;
}

/** 不拋出的 git，讓測試能對 exit code 本身下斷言 —— 「exit 0」正是驗收條件。 */
function tryGit(cwd: string, ...args: string[]): GitResult {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function git(cwd: string, ...args: string[]): string {
  const r = tryGit(cwd, ...args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗 (${r.status})：${r.output}`);
  return r.output;
}

/**
 * 一個真實的 git repo，其中已有一個初始化過的 board。
 * 共用資源紀律：獨立 mkdtemp，且**只設 local 設定** ——
 * 不依賴也不修改使用者的全域 git 設定。
 */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nook-gitmerge-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@nook.invalid');
  git(dir, 'config', 'user.name', 'Nook Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  initBoard(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init board');
  return dir;
}

function commitAll(dir: string, message: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

/** 在指定分支上做一件事並提交，結束時回到 main。 */
function onBranch(dir: string, branch: string, message: string, work: () => void): void {
  git(dir, 'checkout', '-q', '-b', branch, 'main');
  work();
  commitAll(dir, message);
  git(dir, 'checkout', '-q', 'main');
}

function logOf(dir: string, id: string): string {
  return readFileSync(join(dir, '.gitnook', 'issues', `${id}.ndjson`), 'utf8');
}

const CONFLICT_MARKERS = ['<<<<<<<', '=======', '>>>>>>>'];

function expectCleanMerge(result: GitResult, log: string): void {
  expect(result.status).toBe(0);
  expect(result.output).not.toMatch(/CONFLICT/);
  for (const marker of CONFLICT_MARKERS) expect(log).not.toContain(marker);
}

describe('兩分支各自變更同一張 Issue', () => {
  it('git merge exit 0、無衝突標記，且雙方變更皆存活', () => {
    // spike T1：核心假設。merge=union 保留雙方所有行，摺疊只看 op 的集合。
    const dir = makeRepo();
    const created = openBoard({ dir, actor: 'aaaa' }).create({ title: 'Fix login redirect' });
    commitAll(dir, 'create issue');

    onBranch(dir, 'feat-a', 'set status', () => {
      openBoard({ dir, actor: 'aaaa' }).apply(created.id, { status: 'in_progress' });
    });
    onBranch(dir, 'feat-b', 'add label', () => {
      openBoard({ dir, actor: 'bbbb' }).apply(created.id, { labels: { add: ['bug'] } });
    });

    git(dir, 'merge', '-q', 'feat-a');
    const merged = tryGit(dir, 'merge', '-q', 'feat-b');

    expectCleanMerge(merged, logOf(dir, created.id));
    const issue = openBoard({ dir, actor: 'aaaa' }).get(created.id);
    expect(issue.status).toBe('in_progress');
    expect(issue.labels).toEqual(['bug']);
    expect(issue.title).toBe('Fix login redirect');
  });
});


describe('rebase 路徑', () => {
  it('git rebase 同樣套用 union：exit 0、無衝突，雙方變更皆存活', () => {
    // spike T4：rebase 是多數團隊的日常，它走的是另一條 merge 程式碼路徑。
    const dir = makeRepo();
    const created = openBoard({ dir, actor: 'aaaa' }).create({ title: 'Fix login redirect' });
    commitAll(dir, 'create issue');

    onBranch(dir, 'feat-a', 'comment on a', () => {
      openBoard({ dir, actor: 'aaaa' }).apply(created.id, { comment: 'safari 才會重現' });
    });
    // main 自己也往前走，rebase 才有東西要重放。
    openBoard({ dir, actor: 'bbbb' }).apply(created.id, { status: 'in_progress' });
    commitAll(dir, 'set status on main');

    git(dir, 'checkout', '-q', 'feat-a');
    const rebased = tryGit(dir, 'rebase', 'main');

    expectCleanMerge(rebased, logOf(dir, created.id));
    const issue = openBoard({ dir, actor: 'aaaa' }).get(created.id);
    expect(issue.status).toBe('in_progress');
    expect(issue.comments.map((c) => c.body)).toEqual(['safari 才會重現']);
  });
});


/**
 * 兩種 actor 排序都必須測到。全序是 (t, a, id)，兩邊的新 op 從同一個祖先分岔、
 * 拿到相同的 t，所以先後完全由 actor 決定：移除方排在新增方**之前**時，一個
 * 完全不看 `seen`、單純「以值移除」的天真實作也會通過 —— 只測單一排序等於沒測。
 * 與 test/core/board.labels.test.ts 的 ACTOR_ORDERS 同一套思路（票 03 已用變異測試證實）。
 */
const ACTOR_ORDERS: readonly (readonly [string, string])[] = [
  ['k3f9', 'm8q2'], // 移除方的 actor 排在新增方之前
  ['zzzz', 'aaaa'], // 移除方的 actor 排在新增方之後
];

describe('add-wins：一邊移除 label，另一邊並行新增同一個 label', () => {
  for (const [remover, adder] of ACTOR_ORDERS) {
    it(`真實 merge 後 bug 存活（移除方 ${remover}、新增方 ${adder}）`, () => {
      const dir = makeRepo();
      const created = openBoard({ dir, actor: remover }).create({
        title: 'Fix login redirect',
        labels: ['bug'],
      });
      commitAll(dir, 'create issue with label');

      onBranch(dir, `rm-${remover}`, 'remove bug', () => {
        openBoard({ dir, actor: remover }).apply(created.id, { labels: { remove: ['bug'] } });
      });
      onBranch(dir, `add-${adder}`, 'add bug again', () => {
        openBoard({ dir, actor: adder }).apply(created.id, { labels: { add: ['bug'] } });
      });

      git(dir, 'merge', '-q', `rm-${remover}`);
      const merged = tryGit(dir, 'merge', '-q', `add-${adder}`);
      expectCleanMerge(merged, logOf(dir, created.id));

      const ops = logOf(dir, created.id)
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const rm = ops.find((o) => o['op'] === 'label.rm')!;
      const add2 = ops.filter((o) => o['op'] === 'label.add').at(-1)!;
      // 前置條件：兩邊的新 op 拿到同一個 t，先後才真的由 actor 決定。
      expect(add2['t']).toBe(rm['t']);
      // add₂ 是並行分支獨立產生的 tag，移除方不可能觀察到它。
      expect(rm['seen']).not.toContain(add2['id']);

      // add-wins：不在 seen 內的並行 add 必須存活。
      expect(openBoard({ dir, actor: remover }).get(created.id).labels).toEqual(['bug']);
    });
  }
});

describe('兩分支並行 set status', () => {
  /** 兩個分支各設一次 status，回傳合併後的 op-log 行。merge 的先後由呼叫端指定。 */
  function race(first: 'low' | 'high'): { lines: string[]; status: string; id: string } {
    const dir = makeRepo();
    const created = openBoard({ dir, actor: 'aaaa' }).create({ title: 'Fix login redirect' });
    commitAll(dir, 'create issue');

    onBranch(dir, 'low', 'review', () => {
      openBoard({ dir, actor: 'aaaa' }).apply(created.id, { status: 'review' });
    });
    onBranch(dir, 'high', 'done', () => {
      openBoard({ dir, actor: 'zzzz' }).apply(created.id, { status: 'done' });
    });

    const second = first === 'low' ? 'high' : 'low';
    git(dir, 'merge', '-q', first);
    const merged = tryGit(dir, 'merge', '-q', second);
    expectCleanMerge(merged, logOf(dir, created.id));

    const lines = logOf(dir, created.id).split('\n').filter((l) => l !== '');
    return { lines, status: openBoard({ dir, actor: 'aaaa' }).get(created.id).status, id: created.id };
  }

  it('結果依 (t, a, id) 確定，且兩個 op 都還留在檔案裡', () => {
    const { lines, status } = race('low');

    // 兩個 set 的 t 相同，決勝落到 actor：'aaaa' < 'zzzz'，全序中最後的那個贏。
    // 期望值取自 ADR-0001 的全序規則，不是執行結果。
    expect(status).toBe('done');
    // union 保留雙方所有行 —— 輸掉的 op 不會被刪除，只是在 fold 中被蓋過。
    const setOps = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((o) => o['op'] === 'set' && o['k'] === 'status');
    expect(setOps.map((o) => o['v']).sort()).toEqual(['done', 'review']);
  });

  it('收斂：merge 的先後順序不改變結果', () => {
    // 這正是零衝突之外的另一半承諾 —— 誰先 merge 誰後 merge，摺疊結果必須相同。
    expect(race('low').status).toBe(race('high').status);
  });
});

describe('兩分支各自新增 comment', () => {
  it('合併後兩則都在，且順序由 (t, a, id) 決定', () => {
    const dir = makeRepo();
    const created = openBoard({ dir, actor: 'aaaa' }).create({ title: 'Fix login redirect' });
    commitAll(dir, 'create issue');

    onBranch(dir, 'talk-a', 'comment a', () => {
      openBoard({ dir, actor: 'aaaa' }).apply(created.id, { comment: 'safari 才會重現' });
    });
    onBranch(dir, 'talk-b', 'comment b', () => {
      openBoard({ dir, actor: 'zzzz' }).apply(created.id, { comment: '已經找到原因了' });
    });

    git(dir, 'merge', '-q', 'talk-a');
    const merged = tryGit(dir, 'merge', '-q', 'talk-b');
    expectCleanMerge(merged, logOf(dir, created.id));

    // Comment 只增不減：並行的兩則都必須存活，一則都不能掉。
    const comments = openBoard({ dir, actor: 'aaaa' }).get(created.id).comments;
    expect(comments.map((c) => c.body)).toEqual(['safari 才會重現', '已經找到原因了']);
    expect(comments.map((c) => c.actor)).toEqual(['aaaa', 'zzzz']);
  });
});

describe('黏合行：union merge 對缺少 trailing newline 的真實反應（spike T2）', () => {
  it('真的黏起來，且 health() 能指認、repair() 能還原', () => {
    // 這是 ADR-0001 硬規則 1 的**反面**：刻意讓寫入者不守紀律，
    // 證明防禦面認得的是 git 真正產生的東西，而不是我們想像的形狀。
    const dir = makeRepo();
    const id = '01JBX7A9Q3';
    const log = join(dir, '.gitnook', 'issues', `${id}.ndjson`);
    const b1 = `{"id":"b1","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}`;
    const b2 = `{"id":"b2","t":2,"a":"k3f9","op":"label.add","v":"bug"}`;
    const b3 = `{"id":"b3","t":3,"a":"m8q2","op":"comment","body":"safari 才會重現"}`;

    writeFileSync(log, b1, 'utf8'); // 沒有 trailing newline
    commitAll(dir, 'base without trailing newline');

    onBranch(dir, 'glue-a', 'append b2', () => appendFileSync(log, b2, 'utf8'));
    onBranch(dir, 'glue-b', 'append b3', () => appendFileSync(log, b3, 'utf8'));

    git(dir, 'merge', '-q', 'glue-a');
    tryGit(dir, 'merge', '-q', 'glue-b');

    // union 把兩邊各自的「最後一行」都留下來，於是黏合行變成兩條，b1 被複製。
    const lines = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
    expect(lines).toEqual([`${b1}${b2}`, `${b1}${b3}`]);

    const before = diagnose(dir).filter((d) => d.kind === 'GluedLine');
    expect(before.map((d) => d.line)).toEqual([1, 2]);

    repair(dir);

    expect(diagnose(dir).filter((d) => d.kind === 'GluedLine')).toEqual([]);
    // 三個 op 一個都沒少。
    const issue = openBoard({ dir, actor: 'k3f9' }).get(id);
    expect(issue.title).toBe('Fix login redirect');
    expect(issue.labels).toEqual(['bug']);
    expect(issue.comments.map((c) => c.body)).toEqual(['safari 才會重現']);
  });
});
