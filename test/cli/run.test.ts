import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
import { SHORT_ID_MIN } from '../../src/core/ids.js';
import { processIo, run } from '../../src/cli/run.js';
import type { Io } from '../../src/cli/run.js';
import type { CreateInput, IdSource, Issue } from '../../src/index.js';

// ADR-0004：真實檔案系統，每個測試用例一個 mkdtemp 的 cwd。
// Io 是本票唯一的測試 adapter —— CLI 測試不得 spawn 子行程。
let dir: string;
/** 長駐指令（studio）的關閉信號。測試失敗時也一定要收乾淨，否則 vitest 掛住。 */
const running: AbortController[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-cli-'));
});

afterEach(() => {
  for (const stop of running.splice(0)) stop.abort();
  rmSync(dir, { recursive: true, force: true });
});

interface Capture extends Io {
  out: string;
  err: string;
}

/**
 * 捕獲用的 Io。stdin 預設為非 TTY（agent 的實際情境）。
 *
 * `cwd` 預設是 board 的根目錄。傳入一個子目錄即可重現使用者實際的處境 ——
 * 幾乎沒有人是站在 repo 根目錄打指令的。
 */
function capture(
  opts: {
    stdin?: string;
    env?: Record<string, string | undefined>;
    isTty?: boolean;
    signal?: AbortSignal;
    cwd?: string;
  } = {},
): Capture {
  return {
    out: '',
    err: '',
    cwd: opts.cwd ?? dir,
    env: opts.env ?? {},
    isTty: opts.isTty ?? false,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    write(text: string) {
      this.out += text;
    },
    writeError(text: string) {
      this.err += text;
    },
    readStdin() {
      if (opts.stdin === undefined) throw new Error('測試未提供 stdin');
      return opts.stdin;
    },
  };
}

const fullId = (prefix: string): string => prefix.padEnd(26, '0');

/** 種子化的 IdSource —— 輸出要能拿來跟手寫的期望值逐字比對。 */
function seeded(issueId: string): IdSource {
  let n = 0;
  return { ulid: () => (n++ === 0 ? issueId : issueId.slice(0, 8) + String(n).padStart(18, '0')) };
}

const createWith = (prefix: string, input: CreateInput): Issue =>
  openBoard({ dir, actor: 'test', ids: seeded(fullId(prefix)) }).create(input);

describe('init', () => {
  it('建立 .issues/issues/ 與 .gitattributes 的 merge=union 那一行，exit 0', async () => {
    const io = capture();

    const code = await run(['init'], io);

    expect(code).toBe(0);
    expect(existsSync(join(dir, '.issues', 'issues'))).toBe(true);
    expect(readFileSync(join(dir, '.gitattributes'), 'utf8')).toContain(
      '.issues/issues/*.ndjson merge=union',
    );
    expect(io.err).toBe('');
  });
});

describe('new', () => {
  it('建立 Issue 並印出可直接當 ref 用的識別碼', async () => {
    await run(['init'], capture());

    const first = capture();
    expect(await run(['new', 'Fix login redirect'], first)).toBe(0);
    const a = first.out.trim();
    expect(openBoard({ dir }).get(a).title).toBe('Fix login redirect');

    const second = capture();
    expect(await run(['new', 'Add dark mode'], second)).toBe(0);
    const b = second.out.trim();
    expect(openBoard({ dir }).get(b).title).toBe('Add dark mode');

    expect(b).not.toBe(a);
    // ULID 前綴編的是時間的高位：同一個 17 分鐘窗口內建立的 Issue 前 6 碼完全相同。
    // 交付用的 ref 因此不能是 SHORT_ID_MIN 碼 —— 長度見「new 交付的 ref 永久有效」。
    expect(b.length).toBeGreaterThan(SHORT_ID_MIN);
    expect(second.err).toBe('');
  });
});

describe('new 交付的 ref 永久有效', () => {
  it('印出完整的 26 碼 ULID —— 之後再開幾張，第一張的 ref 仍然解析得到', async () => {
    await run(['init'], capture());

    const io = capture();
    expect(await run(['new', 'Fix login redirect'], io)).toBe(0);
    const ref = io.out.trim();

    // 之後才建立、且與第一張共用前 13 碼的 Issue。批次匯入時 40 張會落在同一
    // 毫秒，前綴一路相同 —— 種子化的 IdSource 把那個形狀變成確定的。
    const created = openBoard({ dir }).list({ all: true })[0]!.id;
    for (const tail of ['A', 'B']) {
      openBoard({ dir, actor: 'test', ids: seeded(created.slice(0, 13) + tail.repeat(13)) }) //
        .create({ title: `Later ${tail}` });
    }

    // 短 ID 只在印出的當下無歧義，之後未必 —— 完整的 26 碼才是永久有效的 Ref。
    expect(ref).toHaveLength(26);
    expect(openBoard({ dir }).get(ref).title).toBe('Fix login redirect');
  });
});

describe('list', () => {
  it('印出緊湊表格到 stdout，且套用預設檢視（隱藏 done）', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued', labels: ['bug'] });
    createWith('01JBXB', { title: 'Add dark mode' });
    createWith('01JBXC', { title: 'Write the spike findings', status: 'done' });
    const io = capture();

    expect(await run(['list'], io)).toBe(0);

    // 期望值依 ADR-0005 的緊湊表格格式手算：欄距兩個空白、最後一欄不補寬、行尾不留空白。
    expect(io.out).toBe(
      '01JBXA  queued   Fix login redirect  [bug]\n' + '01JBXB  backlog  Add dark mode\n',
    );
    expect(io.err).toBe('');
  });
});

/** 表格第一欄就是短 ID —— 過濾行為看的是「哪幾張出現」，不是欄寬。 */
const listed = (out: string): string[] =>
  out.trim() === '' ? [] : out.trim().split('\n').map((l) => l.split('  ')[0]!);

describe('list 的旗標', () => {
  it('--all / --status / --label 翻譯成 Filter，label 可重複且為 AND', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued', labels: ['bug', 'p1'] });
    createWith('01JBXB', { title: 'Add dark mode', status: 'queued', labels: ['bug'] });
    createWith('01JBXC', { title: 'Write the spike findings', status: 'done' });
    openBoard({ dir, actor: 'test' }).apply('01JBXB', { archived: true });

    const all = capture();
    const queued = capture();
    const bugP1 = capture();

    expect(await run(['list', '--all'], all)).toBe(0);
    // status 同樣接受無歧義前綴（spec.md「ID 與 status 皆接受無歧義前綴」）。
    expect(await run(['list', '--status', 'que'], queued)).toBe(0);
    expect(await run(['list', '--label', 'bug', '--label', 'p1'], bugP1)).toBe(0);

    expect(listed(all.out)).toEqual(['01JBXA', '01JBXB', '01JBXC']);
    expect(listed(queued.out)).toEqual(['01JBXA']);
    expect(listed(bugP1.out)).toEqual(['01JBXA']);
  });
});

describe('show', () => {
  it('印出詳情：標頭、description、Comment 時間軸', async () => {
    await run(['init'], capture());
    createWith('01JBXA', {
      title: 'Fix login redirect',
      status: 'queued',
      labels: ['bug'],
      description: 'Only on Safari 17.',
    });
    openBoard({ dir, actor: 'test' }).apply('01JBXA', { comment: 'Reproduced with git 2.50.1' });
    const io = capture();

    expect(await run(['show', '01JBXA'], io)).toBe(0);

    // 期望值依 ADR-0005 的詳情格式手算：空區塊整個略去，區塊之間一個空行。
    expect(io.out).toBe(
      '01JBXA  queued  Fix login redirect  [bug]\n' +
        '\n' +
        'Only on Safari 17.\n' +
        '\n' +
        '- test  Reproduced with git 2.50.1\n',
    );
    expect(io.err).toBe('');
  });
});

describe('--json', () => {
  it('list 與 show 改用 renderJson —— 僅供程式化串接（ADR-0005）', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued', labels: ['bug'] });
    const asList = capture();
    const asOne = capture();

    expect(await run(['list', '--json'], asList)).toBe(0);
    expect(await run(['show', '01JBXA', '--json'], asOne)).toBe(0);

    const expected = {
      id: fullId('01JBXA'),
      title: 'Fix login redirect',
      status: 'queued',
      description: '',
      labels: ['bug'],
      archived: false,
      comments: [],
    };
    // list 給陣列、show 給單一物件 —— 串接端不必為了取一張票去拆陣列。
    expect(JSON.parse(asList.out)).toEqual([expected]);
    expect(JSON.parse(asOne.out)).toEqual(expected);
    expect(asList.out.endsWith('\n')).toBe(true);
  });
});

describe('set', () => {
  it('更新 title / description / status / archived，並回印更新後那一行', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued' });
    const io = capture();

    expect(await run(['set', '01JBXA', 'title', 'Fix the login redirect loop'], io)).toBe(0);
    expect(await run(['set', '01JBXA', 'description', 'Only on Safari 17.'], io)).toBe(0);
    expect(await run(['set', '01JBXA', 'status', 'review'], io)).toBe(0);
    expect(await run(['set', '01JBXA', 'archived', 'true'], io)).toBe(0);

    const issue = openBoard({ dir }).get('01JBXA');
    expect(issue.title).toBe('Fix the login redirect loop');
    expect(issue.description).toBe('Only on Safari 17.');
    expect(issue.status).toBe('review');
    // archived 是可見性，與 done/cancelled 的工作結果正交（ADR-0003），所以是欄位不是 status。
    expect(issue.archived).toBe(true);

    // 回印一行 —— token 預算的 mv/comment 情境即以「更新後那一行」計價（票 07）。
    expect(io.out.trim().split('\n').at(-1)).toBe('01JBXA  review  Fix the login redirect loop');
    expect(io.err).toBe('');
  });
});

describe('mv', () => {
  it('是狀態流轉的捷徑，接受無歧義的 status 前綴，並回印更新後那一行', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued' });
    const io = capture();

    expect(await run(['mv', '01JBXA', 'in_p'], io)).toBe(0);

    expect(openBoard({ dir }).get('01JBXA').status).toBe('in_progress');
    expect(io.out).toBe('01JBXA  in_progress  Fix login redirect\n');
    expect(io.err).toBe('');
  });
});

describe('comment', () => {
  it('新增一則 Comment，並回印更新後那一行', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued' });
    const io = capture();

    expect(await run(['comment', '01JBXA', 'safari 才會重現'], io)).toBe(0);

    expect(openBoard({ dir }).get('01JBXA').comments.map((c) => c.body)).toEqual([
      'safari 才會重現',
    ]);
    expect(io.out).toBe('01JBXA  queued  Fix login redirect\n');
    expect(io.err).toBe('');
  });
});

/**
 * 回印一行的四條路徑（set / mv / comment / label）與 show 都只拿得到一張
 * Issue。長度若讓渲染層對那個單元素陣列去算，答案永遠是下限 6 —— 而批次
 * 匯入的 Board 上，6 碼前綴會對應到幾十張 Issue。長度是整個 Board 的性質。
 */
describe('顯示用短 ID 一律對整個 Board 算', () => {
  /** 批次匯入的真實形狀：ULID 前 10 碼是時間高位，同一毫秒建立的 Issue 前綴一路相同。 */
  const importBatch = (): void => {
    createWith('01JBX7A9Q3ZA', { title: 'Fix login redirect', status: 'queued' });
    createWith('01JBX7A9Q3ZB', { title: 'Add dark mode', status: 'queued' });
    createWith('01JBX7A9Q3ZC', { title: 'Rename ready to queued', status: 'queued' });
  };

  /** 輸出第一行的第一欄，就是那個 ref。 */
  const printedRef = (out: string): string => out.split('\n')[0]!.split('  ')[0]!;

  it('list 與 mv 在同一塊 Board 上印出等長的短 ID', async () => {
    await run(['init'], capture());
    importBatch();

    const all = capture();
    const moved = capture();
    expect(await run(['list'], all)).toBe(0);
    expect(await run(['mv', '01JBX7A9Q3ZA', 'in_p'], moved)).toBe(0);

    expect(printedRef(moved.out)).toHaveLength(printedRef(all.out).length);
  });

  // show 不在這裡：它只讀被點名的那一個 op-log（票 13），拿不到整塊 Board。
  // 理由與代價寫在 src/cli/run.ts 的 cmdShow 上。
  it('set / mv / comment / label 印出的 ref 都解析得回同一張 Issue', async () => {
    await run(['init'], capture());
    importBatch();

    const runs: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['set', ['set', '01JBX7A9Q3ZA', 'title', 'Fix the login redirect loop']],
      ['mv', ['mv', '01JBX7A9Q3ZA', 'in_p']],
      ['comment', ['comment', '01JBX7A9Q3ZA', 'safari 才會重現']],
      ['label', ['label', '01JBX7A9Q3ZA', '+bug']],
    ];

    for (const [name, argv] of runs) {
      const io = capture();
      expect(await run(argv, io), name).toBe(0);
      // 印出去的 ref 是使用者接著要拿去用的東西。撞號時 get() 會丟 AmbiguousRef。
      expect(openBoard({ dir }).get(printedRef(io.out)).title, name).toBe(
        'Fix the login redirect loop',
      );
    }
  });
});

const LONG = 'Union merge glues two lines together.\nThe reducer must detect the glued line.';

describe('長文輸入：-', () => {
  it('`-` 從 stdin 讀，set description / comment / new --description 三處皆可', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued' });
    // 檔案結尾的換行是檔案的事，不該變成內容的一部分。
    const io = capture({ stdin: `${LONG}\n` });

    expect(await run(['set', '01JBXA', 'description', '-'], io)).toBe(0);
    expect(await run(['comment', '01JBXA', '-'], io)).toBe(0);
    expect(await run(['new', 'Detect glued lines', '--description', '-'], io)).toBe(0);

    const board = openBoard({ dir });
    const issue = board.get('01JBXA');
    expect(issue.description).toBe(LONG);
    expect(issue.comments.map((c) => c.body)).toEqual([LONG]);
    expect(board.list().find((i) => i.title === 'Detect glued lines')?.description).toBe(LONG);
  });
});

describe('長文輸入：--editor', () => {
  it('非 TTY 或沒有 $EDITOR 時報錯而不是卡住，且不留下半個更動', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued' });
    // agent 的實際情境就是非 TTY —— 這裡卡住等於整條管線掛死。
    const headless = capture({ isTty: false, env: { EDITOR: 'vi' } });
    const noEditor = capture({ isTty: true, env: {} });

    expect(await run(['set', '01JBXA', 'description', '--editor'], headless)).toBe(1);
    expect(await run(['new', 'Detect glued lines', '--editor'], noEditor)).toBe(1);

    expect(headless.err).not.toBe('');
    expect(headless.out).toBe('');
    expect(noEditor.err).not.toBe('');
    expect(openBoard({ dir }).get('01JBXA').description).toBe('');
    expect(openBoard({ dir }).list()).toHaveLength(1);
  });
});

describe('exit code 與輸出去向', () => {
  it('成功 0、使用者錯誤 1、內部錯誤 2，錯誤訊息一律寫 stderr', async () => {
    const uninitialized = capture();
    expect(await run(['list'], uninitialized)).toBe(1);
    expect(uninitialized.err).not.toBe('');
    expect(uninitialized.out).toBe('');

    await run(['init'], capture());
    const missing = capture();
    expect(await run(['show', '01JBZZ'], missing)).toBe(1);
    expect(missing.err).toContain('01JBZZ');
    expect(missing.out).toBe('');

    // 內部錯誤：.issues/issues 變成一個檔案，掃描時炸開 —— 這不是使用者打錯字。
    rmSync(join(dir, '.issues', 'issues'), { recursive: true });
    writeFileSync(join(dir, '.issues', 'issues'), '', 'utf8');
    const broken = capture();
    expect(await run(['list'], broken)).toBe(2);
    expect(broken.err).not.toBe('');
    expect(broken.out).toBe('');
  });
});

describe('AmbiguousRef', () => {
  it('訊息列出足以彼此區分的候選短 ID，exit 1', async () => {
    await run(['init'], capture());
    createWith('01JBXA1', { title: 'Fix login redirect' });
    createWith('01JBXA2', { title: 'Add dark mode' });
    const io = capture();

    expect(await run(['show', '01JBXA'], io)).toBe(1);

    // 候選長度自適應：印一堆一模一樣的 6 碼等於沒有回答任何問題。
    expect(io.err).toContain('01JBXA1');
    expect(io.err).toContain('01JBXA2');
    expect(io.out).toBe('');
  });
});

describe('.gitattributes 是唯一的單點失效', () => {
  it('缺失時 list / show 印一行警告到 stderr，但仍正常輸出並 exit 0', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });

    const healthy = capture();
    expect(await run(['list'], healthy)).toBe(0);
    expect(healthy.err).toBe('');

    // 被誤刪時資料會靜默開始衝突 —— 單點失效需要主動監看。
    rmSync(join(dir, '.gitattributes'));
    const listed_ = capture();
    const shown = capture();

    expect(await run(['list'], listed_)).toBe(0);
    expect(await run(['show', '01JBXA'], shown)).toBe(0);

    expect(listed_.err.trimEnd().split('\n')).toHaveLength(1);
    expect(listed_.err).toContain('merge=union');
    expect(shown.err).toContain('merge=union');
    // 警告走 stderr，資料走 stdout —— 管線接得住。
    expect(listed_.out).toBe('01JBXA  backlog  Fix login redirect\n');
  });
});

/**
 * ADR-0004：git 一律真實。這是本檔唯一需要 git repo 的地方 —— 不是 repo 時
 * diagnose 永遠回報 NotAGitRepo，「健康的 board exit 0」那一半就無從驗證。
 * 只設 local 設定，不依賴也不修改使用者的全域 git 設定。
 */
const gitInit = (): void => {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@nook.invalid'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Nook Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });
};

describe('doctor', () => {
  it('健康時沉默 exit 0；有 Diagnostic 時逐條印出並 exit 非 0', async () => {
    gitInit();
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });

    const healthy = capture();
    expect(await run(['doctor'], healthy)).toBe(0);
    expect(healthy.out).toBe('');

    // ADR-0001 硬規則 1 的實際產物：缺 trailing newline 時 union merge 把兩行黏成一行。
    const log = join(dir, '.issues', 'issues', `${fullId('01JBXA')}.ndjson`);
    const create = '{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}';
    const status = '{"id":"01B","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}';
    const label = '{"id":"01C","t":3,"a":"k3f9","op":"label.add","v":"bug"}';
    writeFileSync(log, `${create}\n${status}${label}\n`, 'utf8');

    const sick = capture();
    expect(await run(['doctor'], sick)).not.toBe(0);
    expect(sick.out).toContain('GluedLine');
    expect(sick.out).toContain(`.issues/issues/${fullId('01JBXA')}.ndjson:2`);
    expect(sick.out.trimEnd().split('\n')).toHaveLength(1);
  });
});

/** 長駐指令沒有「結束」可以 await —— 只能等它把該印的印出來。 */
async function waitFor(io: Capture, pattern: RegExp): Promise<string> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const match = io.out.match(pattern);
    if (match !== null) return match[0];
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等不到符合 ${pattern} 的輸出：${JSON.stringify(io.out)}`);
}

describe('studio', () => {
  it('開 server、印出 URL，收到關閉信號後乾淨結束', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });
    const stop = new AbortController();
    running.push(stop);
    const io = capture({ signal: stop.signal });

    // 共用資源紀律：一律綁 port 0 由 OS 指派，不得硬編碼 port。
    const finished = run(['studio', '--port', '0'], io);
    const url = await waitFor(io, /http:\/\/[\d.]+:\d+/);

    // studio 只綁 loopback —— 讓它出現在其他介面上等於把整個 Board 送給同一個網段。
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Fix login redirect');

    stop.abort();
    expect(await finished).toBe(0);
    await expect(fetch(`${url}/`)).rejects.toThrow();
  });
});

const COMMANDS = ['init', 'new', 'list', 'show', 'set', 'mv', 'comment', 'doctor', 'studio'];

describe('--help 與 --version', () => {
  it('--help 與空指令列出全部九個指令並 exit 0，且短到值得每次都讀', async () => {
    const asked = capture();
    const bare = capture();

    expect(await run(['--help'], asked)).toBe(0);
    expect(await run([], bare)).toBe(0);

    for (const command of COMMANDS) expect(asked.out).toContain(command);
    expect(bare.out).toBe(asked.out);
    // CONTEXT.md 的兩條規則必須在使用者第一次讀到的地方出現。
    expect(asked.out).toContain('queued');
    expect(asked.out).toContain('blocked');
    // agent 的 token 成本是硬指標（ADR-0005）。--help 每次互動都可能被讀。
    expect(Buffer.byteLength(asked.out, 'utf8')).toBeLessThan(1024);
    expect(asked.err).toBe('');
  });

  it('--version 印出套件版本並 exit 0', async () => {
    const io = capture();

    expect(await run(['--version'], io)).toBe(0);

    const pkg: unknown = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    expect(io.out).toBe(`${(pkg as { version: string }).version}\n`);
  });
});

describe('不認得的輸入', () => {
  it('未知指令提示最接近的那個、未知旗標直接報錯，都不靜默猜測', async () => {
    await run(['init'], capture());
    const typo = capture();
    const far = capture();
    const badFlag = capture();

    expect(await run(['lst'], typo)).toBe(1);
    expect(await run(['deploy'], far)).toBe(1);
    expect(await run(['list', '--stat', 'done'], badFlag)).toBe(1);

    expect(typo.err).toContain('lst');
    expect(typo.err).toContain('list');
    // 差太遠就不硬猜一個 —— 猜錯比不猜更難查。
    expect(far.err).not.toContain('list');
    expect(far.err).toContain('--help');
    // 靜默吃掉 --stat 會回一份未過濾的清單，而呼叫端以為自己過濾了。
    expect(badFlag.err).toContain('--stat');
    expect(badFlag.out).toBe('');
    expect(typo.out).toBe('');
  });
});

describe('ref 是使用者輸入', () => {
  it('形狀不合法的 ref 由 CLI 擋下並如實說明，合法的則大小寫不敏感', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });

    const traversal = capture();
    const lower = capture();

    // 完整識別碼會被接進檔案路徑。CLI 是第一個接觸點，不假設 core 永遠會擋。
    expect(await run(['show', '../../etc/passwd'], traversal)).toBe(1);
    expect(await run(['show', '01jbxa'], lower)).toBe(0);

    // 「找不到 issue：../../etc/passwd」會暗示這種 issue 有可能存在 —— 它不可能存在。
    expect(traversal.err).toContain('不是合法的 ref');
    expect(traversal.out).toBe('');
    // Ref 大小寫不敏感（CONTEXT.md 的 Ref 定義）。
    expect(lower.out).toContain('Fix login redirect');
  });
});

describe('blocked 必須留 Comment', () => {
  it('轉成 blocked 而 Issue 上沒有任何 Comment 時提醒，但不擋下狀態本身', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'in_progress' });
    createWith('01JBXB', { title: 'Add dark mode', status: 'in_progress' });
    openBoard({ dir, actor: 'test' }).apply('01JBXB', { comment: '等 upstream 修 #123' });

    const silent = capture();
    const explained = capture();

    expect(await run(['mv', '01JBXA', 'blocked'], silent)).toBe(0);
    expect(await run(['mv', '01JBXB', 'blocked'], explained)).toBe(0);

    // 擋下狀態會讓「卡住」這件事整個消失，比缺一則說明更糟 —— 所以是提醒不是錯誤。
    expect(openBoard({ dir }).get('01JBXA').status).toBe('blocked');
    // blocked 遺失的資訊（卡住前在做什麼）只能由 Comment 補上（ADR-0003）。
    expect(silent.err).toContain('comment');
    expect(explained.err).toBe('');
  });
});

describe('真實 process 的 Io adapter', () => {
  it('cwd / env / isTty 取自 process，資料寫 stdout、錯誤寫 stderr', () => {
    const out: string[] = [];
    const err: string[] = [];
    // 唯一被替身取代的是 process 自己的兩個輸出通道 —— 這正是本 adapter 的邊界。
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });

    try {
      const io = processIo();
      io.write('資料');
      io.writeError('警告');

      expect(io.cwd).toBe(process.cwd());
      expect(io.env).toBe(process.env);
      expect(io.isTty).toBe(process.stdin.isTTY === true);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    // 接反了的話，資料會消失在 stderr 而錯誤會污染管線 —— 兩者都無聲。
    expect(out).toEqual(['資料']);
    expect(err).toEqual(['警告']);
  });

  it('接受關閉信號，讓 bin 能把 SIGINT 接給長駐的 studio', () => {
    const stop = new AbortController();

    expect(processIo(stop.signal).signal).toBe(stop.signal);
    expect(processIo().signal).toBeUndefined();
  });
});

describe('尚未 init 的目錄', () => {
  it('只說「不是一個 Nook board」，不再附送一則 .gitattributes 警告', async () => {
    const io = capture();

    expect(await run(['list'], io)).toBe(1);

    // 兩則訊息會讓第一次使用的人以為有兩個問題要修，其實只要跑 nook init。
    expect(io.err.trimEnd().split('\n')).toHaveLength(1);
    expect(io.err).toContain('nook init');
  });
});

describe('label', () => {
  it('一次加上與移除多個 Label，並回印更新後那一行', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', status: 'queued', labels: ['bug', 'ui'] });
    const io = capture();

    // Nook 沒有優先級欄位，優先級用 Label 表達（CONTEXT.md）——
    // 沒有這條 CLI 路徑，`list --label` 就是在過濾一個 CLI 建不出來的東西。
    expect(await run(['label', '01JBXA', '+p1', '-ui'], io)).toBe(0);

    // add-wins OR-Set 的 seen 語意全在 core；呈現順序取自第一個存活 tag 的全序位置。
    expect(openBoard({ dir }).get('01JBXA').labels).toEqual(['bug', 'p1']);
    expect(io.out).toBe('01JBXA  queued  Fix login redirect  [bug,p1]\n');
    expect(io.err).toBe('');
  });
});

describe('label 的 token 形狀', () => {
  it('沒有 + / - 前綴、或空的 label 一律報錯，不猜測意圖', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect', labels: ['bug'] });

    const bare = capture();
    const empty = capture();
    const noTokens = capture();

    expect(await run(['label', '01JBXA', 'bug'], bare)).toBe(1);
    expect(await run(['label', '01JBXA', '+'], empty)).toBe(1);
    expect(await run(['label', '01JBXA'], noTokens)).toBe(1);

    // 票 10 的慣例：不認得的輸入一律拒絕。把 `bug` 當成「移除 ug」是最壞的靜默。
    expect(bare.err).toContain('bug');
    expect(bare.out).toBe('');
    expect(noTokens.err).toContain('用法');
    expect(openBoard({ dir }).get('01JBXA').labels).toEqual(['bug']);
  });
});

describe('new --label', () => {
  it('建立時就掛上 Label，且旗標可重複', async () => {
    await run(['init'], capture());
    const io = capture();

    // 優先級用 Label 表達，所以「開票時就標好 p1」是常態而不是後續補救。
    expect(await run(['new', 'Fix login redirect', '--label', 'bug', '--label', 'p1'], io)).toBe(0);

    expect(openBoard({ dir }).get(io.out.trim()).labels).toEqual(['bug', 'p1']);
    expect(io.err).toBe('');
  });
});

describe('doctor --fix', () => {
  it('修復黏合行、重跑診斷，並印出修復了什麼', async () => {
    gitInit();
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });

    // 「可修復」的診斷若沒有任何修復途徑，等於只是在指責使用者。
    const log = join(dir, '.issues', 'issues', `${fullId('01JBXA')}.ndjson`);
    const create = '{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}';
    const status = '{"id":"01B","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}';
    const label = '{"id":"01C","t":3,"a":"k3f9","op":"label.add","v":"bug"}';
    writeFileSync(log, `${create}\n${status}${label}\n`, 'utf8');

    const fixed = capture();
    expect(await run(['doctor', '--fix'], fixed)).toBe(0);

    // 只拆行、不做語意判斷 —— 被黏住的兩個 Op 都必須完整活下來。
    const issue = openBoard({ dir }).get('01JBXA');
    expect(issue.status).toBe('in_progress');
    expect(issue.labels).toEqual(['bug']);
    // 修好的檔案自己也要守住硬規則 1，否則下一次 merge 又黏起來（ADR-0001）。
    expect(readFileSync(log, 'utf8')).toBe(`${create}\n${status}\n${label}\n`);
    // 重跑診斷後已無 Diagnostic，所以輸出只剩「修了什麼」這一行。
    expect(fixed.out).toContain(`.issues/issues/${fullId('01JBXA')}.ndjson:2`);
    expect(fixed.out.trimEnd().split('\n')).toHaveLength(1);

    const again = capture();
    expect(await run(['doctor', '--fix'], again)).toBe(0);
    expect(again.out).toBe('');
  });
});

describe('單點失效的監看不該把整個 Board 掃一遍', () => {
  it('show 只讀它要的那一張 —— 另一張的 op-log 讀不得也不影響', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });
    // 讀不得的 op-log。全量診斷會在這裡炸開；只問「零衝突保證還在不在」
    // 則只讀 .gitattributes，碰都不會碰到它。
    mkdirSync(join(dir, '.issues', 'issues', `${fullId('01JBXB')}.ndjson`));

    const io = capture();
    // 完整識別碼直達檔案，get() 因此只讀這一個檔。
    expect(await run(['show', fullId('01JBXA')], io)).toBe(0);

    expect(io.out).toBe('01JBXA  backlog  Fix login redirect\n');
    expect(io.err).toBe('');
  });
});

/**
 * 寫完即綠的 guard：行為由上一個切片交付，這裡把它釘住。
 * 探針是 PATH 上的一支假 git —— 不 mock 任何內部協作者，量的是「有沒有真的
 * 生出一個子行程」這個外部可觀察的事實。同一支探針在 doctor 底下必須開火，
 * 否則這個測試就是空的。
 */
describe('list 不再為了一行警告跑一次全量診斷', () => {
  it('list 不 spawn git rev-parse；doctor 才會', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });

    const shim = join(dir, 'shim');
    const marker = join(dir, 'git-calls.txt');
    mkdirSync(shim);
    writeFileSync(join(shim, 'git'), `#!/bin/sh\necho "$@" >> "${marker}"\necho true\n`, {
      mode: 0o755,
    });

    const realPath = process.env.PATH;
    const listing = capture();
    const doctoring = capture();
    process.env.PATH = shim;
    try {
      expect(await run(['list'], listing)).toBe(0);
      // 每次 list 都付一個子行程的錢，直接吃掉冷啟預算（spec.md 四個硬指標）。
      expect(existsSync(marker)).toBe(false);

      // 陽性對照：診斷確實會問 git，所以上面那個 false 不是因為探針壞了。
      expect(await run(['doctor'], doctoring)).toBe(0);
      expect(readFileSync(marker, 'utf8')).toContain('rev-parse');
    } finally {
      process.env.PATH = realPath;
    }

    // 警告本身沒有被拿掉，只是換了個更便宜的問法。
    expect(listing.out).toBe('01JBXA  backlog  Fix login redirect\n');
    expect(listing.err).toBe('');
  });
});

describe('--help 涵蓋新的指令路徑', () => {
  it('列出 label 的實際語法與 doctor --fix，且仍然短到值得每次都讀', async () => {
    const io = capture();

    expect(await run(['--help'], io)).toBe(0);

    // 說明文件教一個不存在的指令，或藏起一個存在的指令，是同一種錯。
    expect(io.out).toContain('label <ref> +bug -ui');
    expect(io.out).toContain('--fix');
    expect(io.out).toContain('new <title>');
    // agent 的 token 成本是硬指標（ADR-0005）：--help 每次互動都可能被讀。
    expect(Buffer.byteLength(io.out, 'utf8')).toBeLessThan(1024);
  });
});

/**
 * 票 15 讓 core 由子目錄向上尋根，但 CLI 仍直接拿 io.cwd 去問 .gitattributes。
 * 結果是在子目錄執行的每一次 list / show 都印出一則**假警報**。
 *
 * 假警報比噪音更糟：它訓練使用者忽略關於唯一單點失效的警告（ADR-0001），
 * 而那正是最不該被忽略的一則。
 */
describe('單點失效的警告問的是 board 根目錄', () => {
  it('根目錄的 merge=union 還在時，子目錄的 list / show 不發警告', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });
    const deep = join(dir, 'src', 'deep');
    mkdirSync(deep, { recursive: true });

    const listed_ = capture({ cwd: deep });
    const shown = capture({ cwd: deep });

    expect(await run(['list'], listed_)).toBe(0);
    expect(await run(['show', '01JBXA'], shown)).toBe(0);

    // 資料照樣讀得到（尋根在票 15 就對了），錯的只有那一行警告。
    expect(listed_.out).toBe('01JBXA  backlog  Fix login redirect\n');
    expect(listed_.err).toBe('');
    expect(shown.err).toBe('');
  });

  it('探針是活的：根目錄那一行真的被刪掉時，子目錄仍然要警告', async () => {
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });
    const deep = join(dir, 'src', 'deep');
    mkdirSync(deep, { recursive: true });
    rmSync(join(dir, '.gitattributes'));

    const io = capture({ cwd: deep });

    expect(await run(['list'], io)).toBe(0);
    expect(io.err).toContain('merge=union');
  });
});

/**
 * 同一個接線缺口的第二處：doctor 直接把 io.cwd 交給 diagnose / repair。
 * 在子目錄執行時它診斷的是一個沒有 op-log 也沒有 .gitattributes 的目錄 ——
 * 真正的問題看不到，而 `--fix` 掃不到任何 op-log，等於**靜默不修**。
 */
describe('doctor 作用在 board 根目錄', () => {
  /** 根目錄的 op-log 被寫成缺 trailing newline 的樣子（ADR-0001 硬規則 1）。 */
  const glue = (): string => {
    const log = join(dir, '.issues', 'issues', `${fullId('01JBXA')}.ndjson`);
    const create = '{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}';
    const status = '{"id":"01B","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}';
    const label = '{"id":"01C","t":3,"a":"k3f9","op":"label.add","v":"bug"}';
    writeFileSync(log, `${create}\n${status}${label}\n`, 'utf8');
    return log;
  };

  it('在子目錄診斷的是根目錄那一塊，不是就地的空目錄', async () => {
    gitInit();
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });
    glue();
    const deep = join(dir, 'src', 'deep');
    mkdirSync(deep, { recursive: true });

    const io = capture({ cwd: deep });

    expect(await run(['doctor'], io)).not.toBe(0);
    // 根目錄那一塊真正的問題。
    expect(io.out).toContain('GluedLine');
    expect(io.out).toContain(`.issues/issues/${fullId('01JBXA')}.ndjson:2`);
    // 就地目錄沒有 .gitattributes，問錯目錄就會多出這一則假診斷。
    expect(io.out).not.toContain('MissingMergeDriver');
    expect(io.out.trimEnd().split('\n')).toHaveLength(1);
  });

  it('--fix 在子目錄真的修得到根目錄的 op-log', async () => {
    gitInit();
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });
    const log = glue();
    const deep = join(dir, 'src', 'deep');
    mkdirSync(deep, { recursive: true });

    const io = capture({ cwd: deep });

    expect(await run(['doctor', '--fix'], io)).toBe(0);
    expect(io.out).toContain(`.issues/issues/${fullId('01JBXA')}.ndjson:2`);
    // 掃不到 op-log 的 --fix 是靜默不修：它會 exit 0 卻什麼都沒動。
    expect(readFileSync(log, 'utf8').trimEnd().split('\n')).toHaveLength(3);
    const issue = openBoard({ dir }).get('01JBXA');
    expect(issue.status).toBe('in_progress');
    expect(issue.labels).toEqual(['bug']);
  });
});

/**
 * 在既有 board 的子目錄再 init 會把 board 切成兩塊 —— core 已經擋下它（票 15），
 * 但 CLI 把它歸成「nook 的 bug」那一類：exit 2，訊息還被冠上 `NestedBoard: ` 前綴。
 *
 * 這是使用者自己修得好的錯誤（cd 到根目錄，或什麼都不做），所以它屬於
 * USER_ERRORS：exit 1，訊息原樣呈現。
 */
describe('在 board 底下再 init', () => {
  it('是使用者修得好的錯誤：exit 1，訊息不帶內部型別名前綴', async () => {
    await run(['init'], capture());
    const deep = join(dir, 'src', 'deep');
    mkdirSync(deep, { recursive: true });

    const io = capture({ cwd: deep });

    expect(await run(['init'], io)).toBe(1);
    // 錯誤名只有在「這是 nook 的 bug，請回報」時才有意義。
    expect(io.err).not.toContain('NestedBoard:');
    // 訊息本身必須說清楚為什麼被擋下，以及那塊 board 在哪。
    expect(io.err).toContain(dir);
    expect(io.err).toContain('切成兩塊');
    // 被擋下就是什麼都不做。
    expect(existsSync(join(deep, '.issues'))).toBe(false);
    expect(io.out).toBe('');
  });
});

/**
 * ADR-0006 的「同源但尚未修的一處」：`list` 對**過濾後**的集合算長度，而解析是
 * 對整塊 Board 做的 —— 於是 `list` 印出的 ref 可能被 `show` 判為有歧義。
 * `show` 則相反：它拿不到整塊 Board，只好一律印 SHORT_ID_MIN 碼。
 *
 * 票 15 的 `board.refs()`（只列目錄、不摺疊）讓兩邊都能對整塊 Board 算長度，
 * 且不違反票 13 的效能保證。
 */
describe('短 ID 的長度對整塊 Board 算', () => {
  /** 輸出第一行的第一欄，就是那個 ref。 */
  const refOf = (out: string): string => out.split('\n')[0]!.split('  ')[0]!;

  it('list 印出的 ref 解析得回同一張 —— 被預設隱藏的 Issue 也是候選', async () => {
    await run(['init'], capture());
    createWith('01JBX7A9Q3ZA', { title: 'Fix login redirect' });
    // done 不出現在預設檢視裡，但它在 board.get() 的候選集合內。
    createWith('01JBX7A9Q3ZB', { title: 'Choose NDJSON layout', status: 'done' });

    const io = capture();
    expect(await run(['list'], io)).toBe(0);

    // 對過濾後的一張算長度會得到 6 碼，而那個前綴在整塊 Board 上對應到兩張。
    expect(openBoard({ dir }).get(refOf(io.out)).title).toBe('Fix login redirect');
  });

  it('list 與 show 印出等長的短 ID', async () => {
    await run(['init'], capture());
    // 批次匯入的真實形狀：同一毫秒建立的 Issue 前綴一路相同（ADR-0006）。
    createWith('01JBX7A9Q3ZA', { title: 'Fix login redirect' });
    createWith('01JBX7A9Q3ZB', { title: 'Add dark mode' });
    createWith('01JBX7A9Q3ZC', { title: 'Rename ready to queued' });

    const all = capture();
    const shown = capture();
    expect(await run(['list'], all)).toBe(0);
    expect(await run(['show', fullId('01JBX7A9Q3ZA')], shown)).toBe(0);

    // 同一塊 Board 的同一個顯示用表示法，兩條路徑不該給出不同的答案。
    expect(refOf(shown.out)).toHaveLength(refOf(all.out).length);
    expect(openBoard({ dir }).get(refOf(shown.out)).title).toBe('Fix login redirect');
  });
});

/**
 * 公開面。
 *
 * spec.md 的 Design contract 寫的是「`src/index.ts` 公開匯出（僅 openBoard 與
 * 型別）」。對 library-first 的產品，**加一個匯出是相容的、拿掉一個不是** ——
 * 所以公開面必須是一份被刻意列出、會隨改動變紅的清單，而不是「順手 export
 * 一下讓別的模組取用」累積出來的結果。同一個 package 內的模組本來就可以直接
 * `import { renderTable } from '../render/table.js'`，那不需要經過公開面。
 *
 * 本測試落在 CLI 的測試檔裡，是因為本次工作的測試寫入範圍只到這三個檔；
 * 它真正的位置是一個獨立的 test/index.test.ts。
 */
