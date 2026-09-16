import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDecisionLog } from '../../src/core/decisionLog.js';
import { initDecisionRoot } from '../../src/core/gitattributes.js';
import {
  DecisionLogNotInitialized,
  DecisionNotFound,
  AmbiguousDecisionRef,
  InvalidDisposition,
} from '../../src/core/decisionTypes.js';

// ADR-0004：真實檔案系統，每個測試用例獨立 mkdtemp，不引入 mock。
let dir: string;
const decisionsDir = () => join(dir, '.gitnook', 'decisions');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-decision-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('create', () => {
  it('寫出一個恰好含 create + set op、且以換行結尾的 op-log', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });

    log.create({ title: 'Use ULIDs for decisions', body: 'because they sort by time', disposition: 'accepted' });

    const files = readdirSync(decisionsDir());
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}\.ndjson$/);

    const raw = readFileSync(join(decisionsDir(), files[0]!), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);

    const lines = raw.split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ op: 'create', title: 'Use ULIDs for decisions', t: 1 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ op: 'set', k: 'body', v: 'because they sort by time', t: 2 });
    expect(JSON.parse(lines[2]!)).toMatchObject({ op: 'set', k: 'disposition', v: 'accepted', t: 3 });
  });

  it('未指定 disposition 時預設 proposed，op-log 不多寫一行', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });

    const decision = log.create({ title: 'A bare decision' });

    expect(decision.disposition).toBe('proposed');
    const raw = readFileSync(join(decisionsDir(), `${decision.id}.ndjson`), 'utf8');
    expect(raw.split('\n').filter((l) => l !== '')).toHaveLength(1);
  });

  it('disposition 接受無歧義前綴', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });

    const decision = log.create({ title: 'X', disposition: 'acc' });

    expect(decision.disposition).toBe('accepted');
  });

  it('不合法的 disposition 拋 InvalidDisposition，不留下半成品檔案', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });

    expect(() => log.create({ title: 'X', disposition: 'bogus' })).toThrow(InvalidDisposition);
    expect(readdirSync(decisionsDir())).toHaveLength(0);
  });
});

describe('get', () => {
  it('以完整 ULID 讀回摺疊後的 Decision', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    const created = log.create({ title: 'Use ULIDs for decisions' });

    const found = log.get(created.id);

    expect(found).toEqual(created);
    expect(found.title).toBe('Use ULIDs for decisions');
    expect(found.disposition).toBe('proposed');
    expect(found.body).toBe('');
  });

  it('以無歧義前綴讀回同一個 Decision', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    const created = log.create({ title: 'X' });

    expect(log.get(created.id.slice(0, 10))).toEqual(created);
  });

  it('找不到的 ref 拋 DecisionNotFound', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });

    expect(() => log.get('01DOESNOTEXIST0000000000')).toThrow(DecisionNotFound);
  });

  it('有歧義的前綴拋 AmbiguousDecisionRef', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    log.create({ title: 'A' });
    log.create({ title: 'B' });

    // 兩個 ULID 的第一碼幾乎必然相同（同一個 17 分鐘窗口的時間高位），
    // 一碼前綴保證命中兩者。
    const ids = readdirSync(decisionsDir()).map((f) => f.replace('.ndjson', ''));
    const prefix = ids[0]!.slice(0, 1);

    expect(() => log.get(prefix)).toThrow(AmbiguousDecisionRef);
  });
});

describe('apply', () => {
  it('個別修改欄位，摺疊出更新後的 Decision', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    const created = log.create({ title: 'X' });

    const updated = log.apply(created.id, { disposition: 'accepted', body: 'reasoning' });

    expect(updated.disposition).toBe('accepted');
    expect(updated.body).toBe('reasoning');
    expect(log.get(created.id)).toEqual(updated);
  });

  it('supersededBy 只驗證形狀，不驗證存在', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    const created = log.create({ title: 'Old' });

    const updated = log.apply(created.id, { supersededBy: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

    expect(updated.supersededBy).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('supersededBy 形狀不合法時拋 DecisionNotFound', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    const created = log.create({ title: 'Old' });

    expect(() => log.apply(created.id, { supersededBy: '../../etc/passwd' })).toThrow(DecisionNotFound);
  });
});

describe('refs / list', () => {
  it('refs 回傳排序後的完整 ULID 清單', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    const a = log.create({ title: 'A' });
    const b = log.create({ title: 'B' });

    expect([...log.refs()].sort()).toEqual([a.id, b.id].sort());
  });

  it('list 依 disposition 篩選', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    log.create({ title: 'A', disposition: 'accepted' });
    log.create({ title: 'B', disposition: 'rejected' });

    expect(log.list({ disposition: 'accepted' }).map((d) => d.title)).toEqual(['A']);
    expect(log.list()).toHaveLength(2);
  });
});

describe('opLog', () => {
  it('回傳與 get 相同全序下的 op-log', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });
    const created = log.create({ title: 'X', body: 'first' });
    log.apply(created.id, { body: 'second' });

    const ops = log.opLog(created.id);

    expect(ops.filter((o) => o.op === 'set' && o.k === 'body').map((o: any) => o.v)).toEqual(['first', 'second']);
  });
});

describe('root', () => {
  it('回傳含 .decisions/ 那一層的絕對路徑', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });

    expect(log.root()).toBe(dir);
  });
});

describe('未初始化的目錄', () => {
  it('create 拋出 DecisionLogNotInitialized', () => {
    const bare = mkdtempSync(join(tmpdir(), 'nook-decision-bare-'));
    try {
      const log = openDecisionLog({ dir: bare });
      expect(() => log.create({ title: 'x' })).toThrow(DecisionLogNotInitialized);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('get 拋出 DecisionLogNotInitialized', () => {
    const bare = mkdtempSync(join(tmpdir(), 'nook-decision-bare-'));
    try {
      const log = openDecisionLog({ dir: bare });
      expect(() => log.get('01ANYTHING00000000000000')).toThrow(DecisionLogNotInitialized);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('health', () => {
  it('merge=union 在時回傳空陣列', () => {
    initDecisionRoot(dir);
    const log = openDecisionLog({ dir, actor: 'test' });

    expect(log.health()).toEqual([]);
  });

  it('.gitattributes 缺 merge=union 那一行時回報 Diagnostic', () => {
    initDecisionRoot(dir);
    // 手動改壞那一行，模擬它被誤刪。
    writeFileSync(join(dir, '.gitattributes'), '*.png binary\n', 'utf8');

    const log = openDecisionLog({ dir, actor: 'test' });
    const found = log.health();

    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('MissingMergeDriver');
  });
});
