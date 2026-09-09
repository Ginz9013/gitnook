import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';

// ADR-0004：真實檔案系統 + 每個測試用例獨立 mkdtemp，不使用 in-memory fake。
let dir: string;
const issuesDir = (): string => join(dir, '.issues', 'issues');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-oplog-'));
  mkdirSync(issuesDir(), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ISSUE = '01JBX7A9Q30000000000000000';

/** union merge 會把兩邊的行任意交錯 —— 直接寫檔即模擬其結果。 */
function writeLog(lines: readonly string[]): void {
  writeFileSync(join(issuesDir(), `${ISSUE}.ndjson`), lines.join('\n') + '\n', 'utf8');
}

/**
 * description 是 LWW：兩個 Actor 並行改同一張 Issue，摺疊後只剩一份，
 * 敗方的版本仍完整躺在 Op-log 裡（v1 spec 的 Risks 記為已知缺口）。
 * 沒有這個方法，那份文字就沒有任何介面拿得回來。
 */
describe('Board.opLog', () => {
  it('拿得到被 LWW 蓋掉的那一份 description —— get() 只看得到勝方', () => {
    writeLog([
      '{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}',
      '{"id":"01B","t":2,"a":"k3f9","op":"set","k":"description","v":"alice 寫的那一份"}',
      '{"id":"01C","t":3,"a":"m8q2","op":"set","k":"description","v":"bob 寫的那一份"}',
    ]);
    const board = openBoard({ dir });

    expect(board.get(ISSUE).description).toBe('bob 寫的那一份');
    expect(board.opLog(ISSUE)).toEqual([
      { id: '01A', t: 1, a: 'k3f9', op: 'create', title: 'Fix login redirect' },
      { id: '01B', t: 2, a: 'k3f9', op: 'set', k: 'description', v: 'alice 寫的那一份' },
      { id: '01C', t: 3, a: 'm8q2', op: 'set', k: 'description', v: 'bob 寫的那一份' },
    ]);
  });

  /**
   * 排序是 core 的責任，只有一份（ADR-0001 的 (t, a, id) 全序）。這裡不重抄
   * 一份期望的比較器，而是要求 opLog 與 reduce 摺出來的時間軸逐項相同 ——
   * 任何人在第二個地方另寫一份排序（commit 463343d 的成因），這條就會紅。
   */
  it('與 reduce 同一個全序：檔案行順序無關，同 id 的重複行只留 reduce 折的那一個', () => {
    // union merge 把兩邊的行任意交錯，並可能保留同 id 但內容不同的兩行（spike T3）。
    writeLog([
      '{"id":"01C","t":3,"a":"m8q2","op":"comment","body":"third"}',
      '{"id":"01B","t":5,"a":"k3f9","op":"comment","body":"merge 留下的重複行"}',
      '{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}',
      '{"id":"01D","t":3,"a":"k3f9","op":"comment","body":"second"}',
      '{"id":"01B","t":2,"a":"k3f9","op":"comment","body":"first"}',
    ]);
    const board = openBoard({ dir });

    const log = board.opLog(ISSUE);

    // t 相同時由 actor 決勝（k3f9 < m8q2），故 01D 排在 01C 之前。
    expect(log.map((o) => o.id)).toEqual(['01A', '01B', '01D', '01C']);
    expect(log.filter((o) => o.op === 'comment')).toEqual(
      board.get(ISSUE).comments.map((c) => ({ id: c.id, t: c.t, a: c.actor, op: 'comment', body: c.body })),
    );
  });
});
