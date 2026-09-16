import { describe, it, expect } from 'vitest';
import { resolveDisposition, InvalidDisposition, DISPOSITIONS, DecisionLogNotInitialized } from '../../src/core/decisionTypes.js';

// resolveDisposition 同 resolveStatus 的無歧義前綴解析（test/core/ids.prefix.test.ts
// 的手法對應到 core/types.ts 的 resolveStatus，這裡是同一條規則的 Decision 版本）。

describe('resolveDisposition', () => {
  it('接受完整值', () => {
    for (const d of DISPOSITIONS) expect(resolveDisposition(d)).toBe(d);
  });

  it('接受無歧義前綴', () => {
    expect(resolveDisposition('acc')).toBe('accepted');
    expect(resolveDisposition('rej')).toBe('rejected');
    expect(resolveDisposition('prop')).toBe('proposed');
  });

  it('空字串不命中任何值，拋 InvalidDisposition', () => {
    expect(() => resolveDisposition('')).toThrow(InvalidDisposition);
  });

  it('不存在的值拋 InvalidDisposition，不猜測', () => {
    const err = (() => {
      try {
        resolveDisposition('bogus');
      } catch (e) {
        return e as Error;
      }
      throw new Error('expected resolveDisposition to throw');
    })();

    expect(err).toBeInstanceOf(InvalidDisposition);
    expect(err.message).toContain('bogus');
    expect(err.message).toContain('proposed');
  });
});

/**
 * 票 03：`DecisionLogNotInitialized` 的訊息不再出現 `nook decision init`
 * 字樣（那個指令已經被票 01 移除），改指向 `nook init`。找不到 `.gitnook/`
 * 但沿路找到舊版佈局 marker 時，附上可直接複製貼上的 `git mv` 指令 ——
 * 同 `BoardNotInitialized`，兩者對稱處理，純字串斷言（不碰檔案系統）。
 */
describe('DecisionLogNotInitialized', () => {
  it('沒有 ceiling 時：run nook init first，不再提 nook decision init', () => {
    const err = new DecisionLogNotInitialized('/tmp/x');

    expect(err.message).toContain('run nook init first');
    expect(err.message).not.toContain('nook decision init');
  });

  it('有 ceiling、沒有偵測到任何舊版 marker：維持既有措辭，不附加 git mv', () => {
    const err = new DecisionLogNotInitialized('/tmp/x/deep', '/tmp/x');

    expect(err.message).toContain('/tmp/x/deep');
    expect(err.message).toContain('up to /tmp/x');
    expect(err.message).toContain('.gitnook/decisions');
    expect(err.message).toContain('run nook init at the project root');
    expect(err.message).not.toContain('nook decision init');
    expect(err.message).not.toContain('git mv');
  });

  it('偵測到舊版 .decisions/decisions/：附上對應的 git mv 指令', () => {
    const err = new DecisionLogNotInitialized('/tmp/x/deep', '/tmp/x', {
      dir: '/tmp/x',
      issues: false,
      decisions: true,
    });

    expect(err.message).toContain('git mv "/tmp/x/.decisions/decisions" "/tmp/x/.gitnook/decisions"');
    expect(err.message).not.toContain('.issues/issues');
  });

  it('同時偵測到舊版 issues 與 decisions：兩條 git mv 指令都看得到', () => {
    const err = new DecisionLogNotInitialized('/tmp/x/deep', '/tmp/x', {
      dir: '/tmp/x',
      issues: true,
      decisions: true,
    });

    expect(err.message).toContain('git mv "/tmp/x/.issues/issues" "/tmp/x/.gitnook/issues"');
    expect(err.message).toContain('git mv "/tmp/x/.decisions/decisions" "/tmp/x/.gitnook/decisions"');
  });
});
