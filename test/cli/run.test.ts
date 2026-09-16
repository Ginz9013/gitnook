import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
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

/**
 * PATH 上那支假 git 的內容。**分指令回答** —— 對任何問題都 `exit 0` + `echo true`
 * 的版本會說謊：`check-ignore` 被讀成「這塊 board 被 ignore」、`ls-files` 被讀成
 * 「op-log 已被追蹤」，於是探針會以陽性對照的形式紅掉，而紅的原因與它要量的東西
 * （有沒有真的生出子行程）無關。這一批實際撞過那一次。
 */
const fakeGit = (marker: string): string =>
  `#!/bin/sh\necho "$@" >> "${marker}"\ncase "$1" in\n  rev-parse) echo true ;;\n  *) exit 1 ;;\nesac\n`;

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

describe('exit code 與輸出去向', () => {
  it('成功 0、使用者錯誤 1、內部錯誤 2，錯誤訊息一律寫 stderr', async () => {
    const uninitialized = capture();
    expect(await run(['issue', 'list'], uninitialized)).toBe(1);
    expect(uninitialized.err).not.toBe('');
    expect(uninitialized.out).toBe('');

    await run(['init'], capture());
    const missing = capture();
    expect(await run(['issue', 'show', '01JBZZ'], missing)).toBe(1);
    expect(missing.err).toContain('01JBZZ');
    expect(missing.out).toBe('');

    // 內部錯誤：.gitnook/issues 變成一個檔案，掃描時炸開 —— 這不是使用者打錯字。
    rmSync(join(dir, '.gitnook', 'issues'), { recursive: true });
    writeFileSync(join(dir, '.gitnook', 'issues'), '', 'utf8');
    const broken = capture();
    expect(await run(['issue', 'list'], broken)).toBe(2);
    expect(broken.err).not.toBe('');
    expect(broken.out).toBe('');
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

/**
 * 票 03：找不到 `.gitnook/` 但沿路找到舊版佈局 marker 時，錯誤訊息附上可直接
 * 複製貼上執行的 `git mv` 指令 —— 不自動搬移（nook 從不執行任何會寫入的 git
 * 指令），使用者自己跑。沿用既有 Io capture adapter，不 spawn nook 子行程。
 */
describe('舊版佈局偵測', () => {
  it('只有舊版 .issues/issues/：nook issue list 的錯誤訊息附上對應的 git mv 指令', async () => {
    gitInit();
    mkdirSync(join(dir, '.issues', 'issues'), { recursive: true });

    const io = capture();
    const code = await run(['issue', 'list'], io);

    expect(code).toBe(1);
    expect(io.err).toContain(`git mv "${join(dir, '.issues', 'issues')}" "${join(dir, '.gitnook', 'issues')}"`);
  });
});

describe('doctor', () => {
  it('健康時沉默 exit 0；有 Diagnostic 時逐條印出並 exit 非 0', async () => {
    gitInit();
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });

    const healthy = capture();
    expect(await run(['doctor'], healthy)).toBe(0);
    expect(healthy.out).toBe('');

    // ADR-0001 硬規則 1 的實際產物：缺 trailing newline 時 union merge 把兩行黏成一行。
    const log = join(dir, '.gitnook', 'issues', `${fullId('01JBXA')}.ndjson`);
    const create = '{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}';
    const status = '{"id":"01B","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}';
    const label = '{"id":"01C","t":3,"a":"k3f9","op":"label.add","v":"bug"}';
    writeFileSync(log, `${create}\n${status}${label}\n`, 'utf8');

    const sick = capture();
    expect(await run(['doctor'], sick)).not.toBe(0);
    expect(sick.out).toContain('GluedLine');
    expect(sick.out).toContain(`.gitnook/issues/${fullId('01JBXA')}.ndjson:2`);
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
    // `/` 送的是 SPA 的殼（票 01）—— 看板的內容走 /api/board。
    // 刻意不對殼的內容下斷言：dist/studio/ 在不在會換掉那一頁，而
    // packed-smoke 會在測試中途 `tsup --clean` 把 dist/ 清掉。
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);

    const snapshot = await (await fetch(`${url}/api/board`)).json();
    expect(snapshot.issues.map((i: { title: string }) => i.title)).toContain('Fix login redirect');

    stop.abort();
    expect(await finished).toBe(0);
    await expect(fetch(`${url}/`)).rejects.toThrow();
  });
});

const COMMANDS = ['init', 'issue', 'decision', 'doctor', 'studio', 'workspace'];

describe('--help 與 --version', () => {
  it('--help 與空指令列出全部六個頂層指令並 exit 0，且短到值得每次都讀', async () => {
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

describe('不認得的頂層指令', () => {
  it('打錯頂層指令提示最接近的那個，差太遠就不硬猜', async () => {
    const typo = capture();
    const far = capture();

    expect(await run(['studi'], typo)).toBe(1);
    expect(await run(['zzzzzz'], far)).toBe(1);

    expect(typo.err).toContain('studi');
    expect(typo.err).toContain('studio');
    // 差太遠就不硬猜一個 —— 猜錯比不猜更難查。
    expect(far.err).not.toContain('studio');
    expect(far.err).toContain('--help');
    expect(typo.out).toBe('');
  });
});

/**
 * pre-1.0 的 breaking change（票 05）：11 個扁平 Issue 指令全部搬進
 * `nook issue <verb>`，沒有相容別名（CHANGELOG 的既有政策明講允許）。打舊
 * 指令得到的必須是一句指向新路徑的明確訊息，不是落回「unknown command」
 * 讓人自己去猜那是不是打錯字。
 *
 * **不含 `init`**——它是票 01 之後唯一沒有搬進 `nook issue` 底下的舊扁平指令：
 * `nook init` 本身就是新指令（見「nook init 是唯一的初始化入口」那組測試），
 * 不是「指向新路徑的錯誤」。
 */
describe('舊的扁平指令改成明確的重新導向', () => {
  it('nook <舊指令> 直接指向 nook issue <舊指令>，不是模糊的 unknown command', async () => {
    const verbs = [
      'new', 'list', 'show', 'history', 'set', 'rm', 'mv', 'comment', 'label', 'share',
    ];

    for (const verb of verbs) {
      const io = capture();

      expect(await run([verb], io), verb).toBe(1);

      expect(io.err, verb).toContain(`nook issue ${verb}`);
      expect(io.out, verb).toBe('');
    }
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

describe('doctor --fix', () => {
  it('修復黏合行、重跑診斷，並印出修復了什麼', async () => {
    gitInit();
    await run(['init'], capture());
    createWith('01JBXA', { title: 'Fix login redirect' });

    // 「可修復」的診斷若沒有任何修復途徑，等於只是在指責使用者。
    const log = join(dir, '.gitnook', 'issues', `${fullId('01JBXA')}.ndjson`);
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
    expect(fixed.out).toContain(`.gitnook/issues/${fullId('01JBXA')}.ndjson:2`);
    expect(fixed.out.trimEnd().split('\n')).toHaveLength(1);

    const again = capture();
    expect(await run(['doctor', '--fix'], again)).toBe(0);
    expect(again.out).toBe('');
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
 * 同一個接線缺口的第二處：doctor 直接把 io.cwd 交給 diagnose / repair。
 * 在子目錄執行時它診斷的是一個沒有 op-log 也沒有 .gitattributes 的目錄 ——
 * 真正的問題看不到，而 `--fix` 掃不到任何 op-log，等於**靜默不修**。
 */
describe('doctor 作用在 board 根目錄', () => {
  /** 根目錄的 op-log 被寫成缺 trailing newline 的樣子（ADR-0001 硬規則 1）。 */
  const glue = (): string => {
    const log = join(dir, '.gitnook', 'issues', `${fullId('01JBXA')}.ndjson`);
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
    expect(io.out).toContain(`.gitnook/issues/${fullId('01JBXA')}.ndjson:2`);
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
    expect(io.out).toContain(`.gitnook/issues/${fullId('01JBXA')}.ndjson:2`);
    // 掃不到 op-log 的 --fix 是靜默不修：它會 exit 0 卻什麼都沒動。
    expect(readFileSync(log, 'utf8').trimEnd().split('\n')).toHaveLength(3);
    const issue = openBoard({ dir }).get('01JBXA');
    expect(issue.status).toBe('in_progress');
    expect(issue.labels).toEqual(['bug']);
  });
});

describe('--help 的指令表涵蓋 rm', () => {
  it('列出 rm 與 set 的 deleted 欄位，且仍然短到值得每次都讀', async () => {
    const io = capture();

    expect(await run(['--help'], io)).toBe(0);

    // 藏起一個存在的指令與教一個不存在的指令是同一種錯 —— 而 --help 是
    // AGENT.md 自稱的「語法即時來源」，兩者由 test/agent-doc.test.ts 釘在一起。
    expect(io.out).toContain('rm <ref>');
    expect(io.out).toContain('--yes');
    // 復原就是 set deleted false：不寫出 deleted 這個欄位，那條路等於不存在。
    expect(io.out).toContain('deleted');
    // agent 的 token 成本是硬指標（ADR-0005）。
    expect(Buffer.byteLength(io.out, 'utf8')).toBeLessThan(1024);
  });
});

describe('--help 說得出 --private', () => {
  it('列出旗標本身 —— --help 是語法的即時來源，且仍短到值得每次都讀', async () => {
    const io = capture();

    expect(await run(['--help'], io)).toBe(0);

    // 藏起一個存在的旗標與教一個不存在的指令是同一種錯。
    expect(io.out).toContain('--private');
    // agent 的 token 成本是硬指標（ADR-0005）：--help 每次互動都可能被讀。
    expect(Buffer.byteLength(io.out, 'utf8')).toBeLessThan(1024);
  });
});

/**
 * 藏起一個存在的指令與教一個不存在的指令是同一種錯 —— 而 `--help` 是 AGENT.md
 * 自稱的「語法即時來源」，兩者由 test/agent-doc.test.ts 釘在一起（只改一邊會紅）。
 *
 * `share` 搬進 `nook issue share` 之後不再是頂層指令，打錯字時的模糊建議
 * 因此歸 `nook issue <bad>` 的那條路徑管（`test/cli/issue.test.ts`），這裡只
 * 釘住「--help 藏不住它」這一半。
 */
describe('--help 列出 issue share', () => {
  it('指令表提到 share，而且仍然短到值得每次都讀', async () => {
    const io = capture();

    expect(await run(['--help'], io)).toBe(0);

    expect(io.out).toContain('share');
    // agent 的 token 成本是硬指標（ADR-0005）：--help 每次互動都可能被讀。
    expect(Buffer.byteLength(io.out, 'utf8')).toBeLessThan(1024);
  });
});
