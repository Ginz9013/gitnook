import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBoard } from '../../src/index.js';
import { initBoard } from '../../src/core/gitattributes.js';
import { diagnose, repair } from '../../src/core/health.js';

// 壞資料的防禦面。資料活在 git 裡、隊友的版本不同步是常態，
// 所以向前相容與黏合行都是**資料安全問題** —— ADR-0001 硬規則 1 與 2。

// ADR-0004：真實檔案系統與真實 git，不使用 in-memory fake。
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-malformed-'));
  // 只設 local 設定，不依賴也不修改使用者的全域 git 設定。
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@nook.invalid'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Nook Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });
  initBoard(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ISSUE = '01JBX7A9Q3';
const LOG = `.gitnook/issues/${ISSUE}.ndjson`;

/** 手工鋪一個 op-log，一行一個 op —— 呼叫端給什麼就寫什麼，包括不合法的形狀。 */
function writeLog(...lines: string[]): void {
  writeFileSync(join(dir, LOG), lines.join('\n') + '\n', 'utf8');
}

const CREATE = `{"id":"01A","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}`;
const STATUS = `{"id":"01B","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}`;
const LABEL = `{"id":"01C","t":3,"a":"k3f9","op":"label.add","v":"bug"}`;

describe('黏合行（spike T2）', () => {
  it('health() 回報 GluedLine，指出檔案與行號', () => {
    // spike T2 的實際輸出形狀：缺 trailing newline 時 union merge 把兩行黏成一行。
    writeLog(CREATE, `${STATUS}${LABEL}`);

    const found = diagnose(dir);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'GluedLine', file: LOG, line: 2 });
  });

  it('reduce() 不崩潰：黏合行以外的 op 照常 fold，整個檔案不會遺失', () => {
    writeLog(CREATE, `${STATUS}${LABEL}`);

    const issue = openBoard({ dir, actor: 'k3f9' }).get(ISSUE);

    // 壞掉的是那一行，不是那張 Issue —— create 仍然生效。
    expect(issue.title).toBe('Fix login redirect');
    // 黏合行內的 op 在修復之前確實不算數，但它們是被「記錄為診斷」而非靜默吞掉。
    expect(issue.status).toBe('backlog');
    expect(issue.labels).toEqual([]);
  });
});

describe('修復黏合行', () => {
  it('還原為多行，且不遺失任何一個 op', () => {
    writeLog(CREATE, `${STATUS}${LABEL}`);

    const repaired = repair(dir);

    expect(repaired).toEqual([{ file: LOG, line: 2, ops: 2 }]);
    // 修復之後這個檔案就完全健康了。
    expect(diagnose(dir)).toEqual([]);
    // 而且被黏住的那兩個 op 現在都生效了 —— 修復不是把壞行刪掉。
    const issue = openBoard({ dir, actor: 'k3f9' }).get(ISSUE);
    expect(issue.title).toBe('Fix login redirect');
    expect(issue.status).toBe('in_progress');
    expect(issue.labels).toEqual(['bug']);
  });

  it('spike T2 的實際形狀：union 同時複製了前一行，修復後靠 dedupe by id 收斂', () => {
    // spike-findings.md T2 逐字記錄的輸出：兩條黏合行，且 b1 被複製了兩次。
    const b1 = `{"id":"b1","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}`;
    const b2 = `{"id":"b2","t":2,"a":"k3f9","op":"label.add","v":"bug"}`;
    const b3 = `{"id":"b3","t":3,"a":"k3f9","op":"comment","body":"safari 才會重現"}`;
    writeLog(`${b1}${b2}`, `${b1}${b3}`);

    const repaired = repair(dir);

    expect(repaired).toEqual([
      { file: LOG, line: 1, ops: 2 },
      { file: LOG, line: 2, ops: 2 },
    ]);
    expect(diagnose(dir)).toEqual([]);
    // 四行、其中 b1 出現兩次。重複的 op 由 reduce 的 dedupe by id 吸收 ——
    // 修復本身不做語意判斷，它只負責把行還原回來。
    const issue = openBoard({ dir, actor: 'k3f9' }).get(ISSUE);
    expect(issue.title).toBe('Fix login redirect');
    expect(issue.labels).toEqual(['bug']);
    expect(issue.comments.map((c) => c.body)).toEqual(['safari 才會重現']);
  });
});

// snapshot 是 spec.md 明講「格式預留、v1 不實作」的 op —— 未來版本的隊友
// 寫出這種行是可預期的常態，不是異常。
const SNAPSHOT = `{"id":"01Z","t":4,"a":"m8q2","op":"snapshot","supersedes":3}`;

describe('未知的 op 型別（ADR-0001 硬規則 2）', () => {
  it('health() 以 OP_KINDS 認定未知 op，回報 UnknownOp 與行號', () => {
    writeLog(CREATE, SNAPSHOT, STATUS);

    const found = diagnose(dir);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'UnknownOp', file: LOG, line: 2 });
    // 訊息要指名是哪一種 op，否則使用者無從判斷該升級還是該修資料。
    expect(found[0]!.message).toContain('snapshot');
  });

  it('reduce() 忽略未知 op 而非崩潰，同檔案的其他 op 仍正確 fold', () => {
    writeLog(CREATE, SNAPSHOT, STATUS);

    const issue = openBoard({ dir, actor: 'k3f9' }).get(ISSUE);

    expect(issue.title).toBe('Fix login redirect');
    expect(issue.status).toBe('in_progress');
  });

  it('已知 op 帶未知欄位時仍正確 fold', () => {
    // 未來版本替 set 加了欄位，舊版讀到必須照常運作而不是整張票讀不出來。
    writeLog(CREATE, `{"id":"01D","t":4,"a":"k3f9","op":"set","k":"status","v":"review","reason":"新版加的欄位"}`);

    expect(openBoard({ dir, actor: 'k3f9' }).get(ISSUE).status).toBe('review');
  });
});

/**
 * ⚠️ 這裡刻意不使用 `seen: 'bug'`。字串**是可迭代的** ——
 * 少了 Array.isArray 守衛也只會逐字迭代 'b','u','g'，既不崩潰、label 也照樣存活，
 * 測試會形同虛設（票 03 的發現）。下面三種形狀都是真正不可迭代的。
 */
const NON_ITERABLE_SEEN: readonly (readonly [string, string])[] = [
  ['數字', `{"id":"01R","t":4,"a":"k3f9","op":"label.rm","v":"bug","seen":42}`],
  ['null', `{"id":"01R","t":4,"a":"k3f9","op":"label.rm","v":"bug","seen":null}`],
  ['整個欄位缺漏', `{"id":"01R","t":4,"a":"k3f9","op":"label.rm","v":"bug"}`],
];

describe('label.rm 的 seen 不是陣列', () => {
  for (const [shape, rm] of NON_ITERABLE_SEEN) {
    it(`seen 是${shape}時，reduce() 不崩潰且該 rm 被忽略`, () => {
      writeLog(CREATE, LABEL, rm);

      // 點名不了任何 add tag 的 rm 不能移除任何東西 —— add-wins。
      expect(openBoard({ dir, actor: 'k3f9' }).get(ISSUE).labels).toEqual(['bug']);
    });
  }
});

describe('未知的 set 欄位（ADR-0009 的向前相容方向）', () => {
  // 一份含 `set deleted=true` 的 op-log 傳到還沒更新的 nook 手上時，`deleted`
  // 對它就是一個未知欄位。這裡用一個這個版本也不認得的 k 模擬那個處境。
  const UNKNOWN_FIELD = `{"id":"01E","t":5,"a":"m8q2","op":"set","k":"未知","v":1}`;

  it('未知欄位被忽略而非崩潰，同檔案的其他 op 仍正確 fold', () => {
    writeLog(CREATE, UNKNOWN_FIELD, STATUS);

    const issue = openBoard({ dir, actor: 'k3f9' }).get(ISSUE);

    expect(issue.title).toBe('Fix login redirect');
    expect(issue.status).toBe('in_progress');
  });

  it('那張 Issue 對舊版仍然看得見 —— 失敗的方向是多看見，不是東西不見了', () => {
    writeLog(CREATE, UNKNOWN_FIELD);

    // ADR-0009：多看見一張已被刪除的 Issue 是可以解釋的雜訊；
    // 少看見一張還在的 Issue 不是。
    expect(openBoard({ dir, actor: 'k3f9' }).list().map((i) => i.id)).toEqual([ISSUE]);
  });
});

/**
 * deleted 的值不是 boolean 的三種形狀。字串 `"true"` 是其中最兇的一個 ——
 * 少了 typeof 守衛時它為真，而 `"false"` 同樣為真，於是一張還在的 Issue
 * 會從整塊 board 上消失（連 --all 都看不到）。
 */
const NON_BOOLEAN_DELETED: readonly (readonly [string, string])[] = [
  ['字串', `{"id":"01F","t":5,"a":"m8q2","op":"set","k":"deleted","v":"true"}`],
  ['數字', `{"id":"01F","t":5,"a":"m8q2","op":"set","k":"deleted","v":1}`],
  ['null', `{"id":"01F","t":5,"a":"m8q2","op":"set","k":"deleted","v":null}`],
];

describe('deleted 的值不是 boolean', () => {
  for (const [shape, line] of NON_BOOLEAN_DELETED) {
    it(`v 是${shape}時忽略該 op，那張 Issue 不會消失`, () => {
      writeLog(CREATE, line);

      // 同 archived 既有的守衛：型別不符一律忽略（ADR-0001 硬規則 2）。
      const board = openBoard({ dir, actor: 'k3f9' });
      expect(board.get(ISSUE).deleted).toBe(false);
      expect(board.list().map((i) => i.id)).toEqual([ISSUE]);
    });
  }
});
