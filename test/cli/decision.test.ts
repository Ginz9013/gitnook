import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchDecision } from '../../src/cli/decision.js';
import { openDecisionLog } from '../../src/index.js';
import { deriveActor } from '../../src/core/actor.js';
import { initNook } from '../../src/core/gitattributes.js';
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

function capture(
  opts: { cwd?: string; stdin?: string; env?: Record<string, string | undefined>; isTty?: boolean } = {},
): Capture {
  return {
    out: '',
    err: '',
    cwd: opts.cwd ?? dir,
    env: opts.env ?? {},
    isTty: opts.isTty ?? false,
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

/**
 * 票 01：`nook decision init` 整個移除，`nook init` 是唯一的初始化入口
 * （見 `test/core/gitattributes.test.ts` 的 `initNook` 測試群、
 * `test/cli/run.test.ts` 的 `nook init` 測試群）。這裡只釘住「打了會得到清楚
 * 指向 nook init 的錯誤」這一半，不重複測 init 本身的行為。
 */
describe('decision init 已移除', () => {
  it('清楚指向 nook init，不靜默建出任何東西，exit 1', async () => {
    const io = capture();

    const code = await dispatchDecision(['init'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('nook init');
    expect(io.err).toContain('nook decision init');
    expect(existsSync(join(dir, '.gitnook'))).toBe(false);
    expect(io.out).toBe('');
  });
});

describe('decision new', () => {
  it('建立 Decision 並印出完整 26 碼 ULID', async () => {
    initNook(dir);

    const io = capture();
    const code = await dispatchDecision(['new', '--title', 'Use ULIDs for decisions'], io);

    expect(code).toBe(0);
    const ref = io.out.trim();
    expect(ref).toHaveLength(26);
    expect(openDecisionLog({ dir }).get(ref).title).toBe('Use ULIDs for decisions');
    expect(io.err).toBe('');
  });

  it('接受 --body 與 --disposition', async () => {
    initNook(dir);

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
    initNook(dir);

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
  it('印出 compact header（shortId／disposition／title）＋body 區塊，同票 08 的 ADR-0005 版面', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X', '--body', 'why', '--disposition', 'accepted'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['show', ref], io);

    expect(code).toBe(0);
    expect(io.out).toBe(`${ref.slice(0, 6)}  accepted  X\n\nwhy\n`);
    expect(io.err).toBe('');
  });

  it('body 為空時 header 一行就是全部輸出，不留空 body 區塊', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    await dispatchDecision(['show', ref], io);

    expect(io.out).toBe(`${ref.slice(0, 6)}  proposed  X\n`);
  });

  it('印 supersededBy 只在有值時', async () => {
    initNook(dir);
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
    initNook(dir);
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
    initNook(dir);

    const io = capture();
    const code = await dispatchDecision(['show', '01DOESNOTEXIST00000000000'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('01DOESNOTEXIST00000000000');
  });
});

describe('decision list', () => {
  it('空的 Decision Log 印出空表格訊息，而非報錯', async () => {
    initNook(dir);

    const io = capture();
    const code = await dispatchDecision(['list'], io);

    expect(code).toBe(0);
    expect(io.out.trim()).toBe('no decisions');
    expect(io.err).toBe('');
  });

  it('印出全部 Decision 的 ref/title/disposition，可用 grep 找到特定決策', async () => {
    initNook(dir);
    const a = capture();
    await dispatchDecision(['new', '--title', 'Use ULIDs for decisions', '--disposition', 'accepted'], a);
    const refA = a.out.trim();
    const b = capture();
    await dispatchDecision(['new', '--title', 'Adopt oplog'], b);

    const io = capture();
    const code = await dispatchDecision(['list'], io);

    expect(code).toBe(0);
    expect(io.out).toContain(refA.slice(0, 6));
    expect(io.out).toContain('Use ULIDs for decisions');
    expect(io.out).toContain('accepted');
    expect(io.out).toContain('Adopt oplog');
    expect(io.out).toContain('proposed');
    expect(io.err).toBe('');
  });

  it('--disposition 接受無歧義前綴，只回傳符合的 Decision', async () => {
    initNook(dir);
    await dispatchDecision(
      ['new', '--title', 'Accepted one', '--disposition', 'accepted'],
      capture(),
    );
    await dispatchDecision(['new', '--title', 'Still proposed'], capture());

    const io = capture();
    const code = await dispatchDecision(['list', '--disposition', 'acc'], io);

    expect(code).toBe(0);
    expect(io.out).toContain('Accepted one');
    expect(io.out).not.toContain('Still proposed');
  });

  it('--disposition 給不合法值時是使用者錯誤，exit 1', async () => {
    initNook(dir);

    const io = capture();
    const code = await dispatchDecision(['list', '--disposition', 'bogus'], io);

    expect(code).toBe(1);
    expect(io.err).not.toBe('');
  });

  it('--json 輸出可被解析為陣列，鍵依字母排序', async () => {
    initNook(dir);
    await dispatchDecision(['new', '--title', 'X', '--body', 'why'], capture());

    const io = capture();
    const code = await dispatchDecision(['list', '--json'], io);

    expect(code).toBe(0);
    const parsed = JSON.parse(io.out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('X');
    expect(parsed[0].body).toBe('why');
    expect(Object.keys(parsed[0])).toEqual([...Object.keys(parsed[0])].sort());
  });
});

describe('decision set', () => {
  it('title：更新後回印那一列，同 nook set 既有的回印風格', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'Old title'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['set', ref, 'title', 'New title'], io);

    expect(code).toBe(0);
    expect(io.out).toContain('New title');
    expect(openDecisionLog({ dir }).get(ref).title).toBe('New title');
    expect(io.err).toBe('');
  });

  it('body：接受直接值與 stdin 的 -，語意同 nook set', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const direct = capture();
    await dispatchDecision(['set', ref, 'body', 'reasoning'], direct);
    expect(openDecisionLog({ dir }).get(ref).body).toBe('reasoning');

    const viaStdin = capture({ stdin: 'from stdin\n' });
    await dispatchDecision(['set', ref, 'body', '-'], viaStdin);
    expect(openDecisionLog({ dir }).get(ref).body).toBe('from stdin');
  });

  it('body --editor：非 TTY 時報錯，不留下半個更動', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X', '--body', 'original'], newIo);
    const ref = newIo.out.trim();

    const io = capture({ isTty: false, env: { EDITOR: 'vi' } });
    const code = await dispatchDecision(['set', ref, 'body', '--editor'], io);

    expect(code).toBe(1);
    expect(io.err).not.toBe('');
    expect(openDecisionLog({ dir }).get(ref).body).toBe('original');
  });

  it('disposition：接受無歧義前綴', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['set', ref, 'disposition', 'acc'], io);

    expect(code).toBe(0);
    expect(openDecisionLog({ dir }).get(ref).disposition).toBe('accepted');
  });

  it('disposition：不合法值拋 InvalidDisposition，訊息列出四個合法值，exit 1', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['set', ref, 'disposition', 'bogus'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('proposed');
    expect(io.err).toContain('accepted');
    expect(io.err).toContain('superseded');
    expect(io.err).toContain('rejected');
  });

  it('supersededBy：只驗證 ref 形狀，不驗證目標存在', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(
      ['set', ref, 'supersededBy', '01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      io,
    );

    expect(code).toBe(0);
    expect(openDecisionLog({ dir }).get(ref).supersededBy).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('不存在的欄位名（Issue 的 status 不是 Decision 的）→ UsageError，列出四個合法欄位名，exit 1', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['set', ref, 'status', 'done'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('title, body, disposition, supersededBy');
  });

  it('不存在的 ref → DecisionNotFound，exit 1', async () => {
    initNook(dir);

    const io = capture();
    const code = await dispatchDecision(
      ['set', '01DOESNOTEXIST00000000000', 'title', 'X'],
      io,
    );

    expect(code).toBe(1);
    expect(io.err).toContain('01DOESNOTEXIST00000000000');
  });

  it('有歧義的前綴 → AmbiguousDecisionRef，exit 1', async () => {
    initNook(dir);
    const a = capture();
    await dispatchDecision(['new', '--title', 'A'], a);
    const b = capture();
    await dispatchDecision(['new', '--title', 'B'], b);
    const shared = a.out.trim().slice(0, 6);

    const io = capture();
    const code = await dispatchDecision(['set', shared, 'title', 'X'], io);

    expect(code).toBe(1);
    expect(io.err).toContain(shared);
  });
});

/**
 * 票 04：`nook decision history`——唯讀，看得到就手動 `nook decision set`
 * 貼回去，不做 restore（同票 09 對 Issue `history` 的先例，見 spec.md）。
 */
describe('decision history', () => {
  it('不帶欄位時列出全部欄位的寫入，create 折成 title 的第一筆', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'Use ULIDs'], newIo);
    const ref = newIo.out.trim();
    await dispatchDecision(['set', ref, 'body', 'because sortable'], capture());
    await dispatchDecision(['set', ref, 'disposition', 'accepted'], capture());
    const actor = deriveActor(dir);

    const io = capture();
    const code = await dispatchDecision(['history', ref], io);

    expect(code).toBe(0);
    expect(io.out).toBe(
      `1  ${actor}  title        Use ULIDs\n` +
        `2  ${actor}  body         because sortable\n` +
        `3  ${actor}  disposition  accepted\n`,
    );
    expect(io.err).toBe('');
  });

  it('帶欄位時只列該欄位的寫入', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();
    await dispatchDecision(['set', ref, 'disposition', 'accepted'], capture());
    await dispatchDecision(['set', ref, 'disposition', 'rejected'], capture());
    const actor = deriveActor(dir);

    const io = capture();
    const code = await dispatchDecision(['history', ref, 'disposition'], io);

    expect(code).toBe(0);
    expect(io.out).toBe(`2  ${actor}  disposition  accepted\n` + `3  ${actor}  disposition  rejected\n`);
  });

  it('一次都沒被寫過的欄位印出簡短訊息，而不是空表頭', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['history', ref, 'body'], io);

    expect(code).toBe(0);
    expect(io.out).toBe('no set ops\n');
  });

  it('打錯欄位名是使用者錯誤，exit 1，不靜默回空清單', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();

    const io = capture();
    const code = await dispatchDecision(['history', ref, 'bogusfield'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('bogusfield');
    expect(io.out).toBe('');
  });

  it('legacyRef 不是 set 可寫的欄位，但寫過之後 history 兩種查法都看得到（不一致是 bug）', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X'], newIo);
    const ref = newIo.out.trim();
    // legacyRef 只在遷移當下由 core 直接寫入（票 07 的做法），CLI 的 set 不曝露它。
    openDecisionLog({ dir }).apply(ref, { legacyRef: '0009' });
    const actor = deriveActor(dir);

    const allIo = capture();
    const allCode = await dispatchDecision(['history', ref], allIo);
    const scoped = capture();
    const scopedCode = await dispatchDecision(['history', ref, 'legacyRef'], scoped);

    expect(allCode).toBe(0);
    expect(allIo.out).toContain(`${actor}  legacyRef  0009`);
    expect(scopedCode).toBe(0);
    expect(scoped.out).toBe(`2  ${actor}  legacyRef  0009\n`);
  });

  it('唯讀：跑完之後 op-log 一個 byte 都沒變', async () => {
    initNook(dir);
    const newIo = capture();
    await dispatchDecision(['new', '--title', 'X', '--body', 'y'], newIo);
    const ref = newIo.out.trim();
    const log = join(dir, '.gitnook', 'decisions', `${ref}.ndjson`);
    const before = readFileSync(log, 'utf8');

    expect(await dispatchDecision(['history', ref], capture())).toBe(0);
    expect(await dispatchDecision(['history', ref, 'body'], capture())).toBe(0);

    expect(readFileSync(log, 'utf8')).toBe(before);
  });

  it('不存在的 ref → DecisionNotFound，exit 1', async () => {
    initNook(dir);

    const io = capture();
    const code = await dispatchDecision(['history', '01DOESNOTEXIST00000000000'], io);

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
