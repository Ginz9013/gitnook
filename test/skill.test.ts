import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, type Io } from '../src/cli/run.js';

/**
 * SKILL.md 是 agent 面的說明。它與 CLI 漂開的失敗是靜默的 —— agent 會照著
 * 一個不存在的指令去做，然後拿到 exit 1。這份測試把兩者釘在一起。
 *
 * 只比對指令名。語法細節刻意不比對：SKILL.md 明說「nook --help 是語法的
 * 即時來源」，在這裡再抄一份就是製造第二個會漂開的地方。
 */
const SKILL = readFileSync(join(__dirname, '..', '.claude', 'skills', 'nook', 'SKILL.md'), 'utf8');

const helpText = (): string => {
  let out = '';
  const io: Io = {
    cwd: process.cwd(),
    env: {},
    write: (t) => (out += t),
    writeError: () => {},
    readStdin: () => '',
    isTty: false,
  };
  run(['--help'], io);
  return out;
};

/**
 * `--help` 的第一個空行之後、第二個空行之前是指令表；其後是語意說明，
 * 那幾行也以小寫字母開頭（queued、blocked、list），不能一併當成指令。
 */
const commandsInHelp = (): Set<string> => {
  const blocks = helpText().trim().split(/\n\s*\n/);
  const table = blocks[1] ?? '';
  return new Set(
    table
      .split('\n')
      .map((l) => /^([a-z]+)\b/.exec(l)?.[1])
      .filter((c): c is string => c !== undefined),
  );
};

/**
 * SKILL.md 只採計「程式碼」中的指令：反引號包起來的，以及 bash 圍籬內的。
 * 散文裡的 “nook itself”、“nook deliberately refuses” 不是指令。
 */
const commandsInSkill = (): Set<string> => {
  const inBackticks = [...SKILL.matchAll(/`nook ([a-z]+)/g)].map((m) => m[1]!);
  const inFences = [...SKILL.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap((m) => [...m[1]!.matchAll(/^nook ([a-z]+)/gm)].map((x) => x[1]!));
  return new Set([...inBackticks, ...inFences]);
};

describe('SKILL.md 與 CLI 不得漂開', () => {
  it('SKILL.md 提到的每一個 nook 指令都真的存在', () => {
    const help = commandsInHelp();
    const unknown = [...commandsInSkill()].filter((c) => !help.has(c));

    expect(unknown, `SKILL.md 教了不存在的指令：${unknown.join(', ')}`).toEqual([]);
  });

  it('每一個 CLI 指令都在 SKILL.md 裡有交代', () => {
    const skill = commandsInSkill();
    const help = commandsInHelp();
    const undocumented = [...help].filter((c) => !skill.has(c));

    expect(undocumented, `CLI 有指令但 SKILL.md 沒提：${undocumented.join(', ')}`).toEqual([]);
  });
});
