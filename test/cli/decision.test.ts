import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchDecision } from '../../src/cli/decision.js';
import { openDecisionLog } from '../../src/index.js';
import type { Io } from '../../src/cli/run.js';

// ADR-0004：真實檔案系統，每個測試用例獨立 mkdtemp 的 cwd。
// Io 沿用 test/cli/run.test.ts 的 capture adapter 手法 —— dispatchDecision
// 直接測（同 dispatchWorkspace 的既有先例），不透過 run()。
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-decision-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Capture extends Io {
  out: string;
  err: string;
}

function capture(opts: { cwd?: string } = {}): Capture {
  return {
    out: '',
    err: '',
    cwd: opts.cwd ?? dir,
    env: {},
    isTty: false,
    write(text: string) {
      this.out += text;
    },
    writeError(text: string) {
      this.err += text;
    },
    readStdin() {
      throw new Error('測試未提供 stdin');
    },
  };
}

describe('decision init', () => {
  it('建立 .decisions/decisions/ 與 .gitattributes 的 merge=union 那一行，exit 0', async () => {
    const io = capture();

    const code = await dispatchDecision(['init'], io);

    expect(code).toBe(0);
    expect(existsSync(join(dir, '.decisions', 'decisions'))).toBe(true);
    expect(readFileSync(join(dir, '.gitattributes'), 'utf8')).toContain(
      '.decisions/decisions/*.ndjson merge=union',
    );
    expect(io.err).toBe('');
  });

  it('第二次 init 是 no-op，exit 仍是 0', async () => {
    await dispatchDecision(['init'], capture());

    const again = capture();
    expect(await dispatchDecision(['init'], again)).toBe(0);
    expect(again.err).toBe('');
  });

  it('已存在衝突規則時報錯停止，不靜默覆蓋', async () => {
    writeFileSync(join(dir, '.gitattributes'), '* -merge\n', 'utf8');
    const io = capture();

    const code = await dispatchDecision(['init'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('* -merge');
    expect(existsSync(join(dir, '.decisions', 'decisions'))).toBe(false);
  });
});

describe('decision new', () => {
  it('建立 Decision 並印出完整 26 碼 ULID', async () => {
    await dispatchDecision(['init'], capture());

    const io = capture();
    const code = await dispatchDecision(['new', '--title', 'Use ULIDs for decisions'], io);

    expect(code).toBe(0);
    const ref = io.out.trim();
    expect(ref).toHaveLength(26);
    expect(openDecisionLog({ dir }).get(ref).title).toBe('Use ULIDs for decisions');
    expect(io.err).toBe('');
  });

  it('接受 --body 與 --disposition', async () => {
    await dispatchDecision(['init'], capture());

    const io = capture();
    await dispatchDecision(
      ['new', '--title', 'X', '--body', 'reasoning', '--disposition', 'accepted'],
      io,
    );
    const ref = io.out.trim();

    const decision = openDecisionLog({ dir }).get(ref);
    expect(decision.body).toBe('reasoning');
    expect(decision.disposition).toBe('accepted');
  });

  it('缺少 --title 時是使用者錯誤，exit 1', async () => {
    await dispatchDecision(['init'], capture());

    const io = capture();
    const code = await dispatchDecision(['new'], io);

    expect(code).toBe(1);
    expect(io.err).not.toBe('');
  });

  it('未 init 的目錄回報 DecisionLogNotInitialized 訊息，exit 1', async () => {
    const io = capture();

    const code = await dispatchDecision(['new', '--title', 'X'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('nook decision init');
  });
});

describe('decision show', () => {
  it('印出 title/body/disposition/supersededBy（有值才印）', async () => {
    await dispatchDecision(['init'], capture());
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X', '--body', 'why', '--disposition', 'accepted'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['show', ref], io);

    expect(code).toBe(0);
    expect(io.out).toContain('X');
    expect(io.out).toContain('why');
    expect(io.out).toContain('accepted');
    expect(io.out).not.toContain('supersededBy');
    expect(io.err).toBe('');
  });

  it('印 supersededBy 只在有值時', async () => {
    await dispatchDecision(['init'], capture());
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const log = openDecisionLog({ dir });
    log.apply(ref, { supersededBy: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

    const io = capture();
    await dispatchDecision(['show', ref], io);

    expect(io.out).toContain('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('--json 輸出可被解析回同一個 Decision', async () => {
    await dispatchDecision(['init'], capture());
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X', '--body', 'why'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['show', ref, '--json'], io);

    expect(code).toBe(0);
    const parsed = JSON.parse(io.out);
    expect(parsed.title).toBe('X');
    expect(parsed.body).toBe('why');
    expect(parsed.disposition).toBe('proposed');
  });

  it('找不到的 ref 是使用者錯誤，exit 1', async () => {
    await dispatchDecision(['init'], capture());

    const io = capture();
    const code = await dispatchDecision(['show', '01DOESNOTEXIST00000000000'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('01DOESNOTEXIST00000000000');
  });
});

describe('未知子指令', () => {
  it('是使用者錯誤，exit 1', async () => {
    const io = capture();

    const code = await dispatchDecision(['bogus'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('bogus');
  });
});
