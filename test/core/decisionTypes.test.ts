import { describe, it, expect } from 'vitest';
import { resolveDisposition, InvalidDisposition, DISPOSITIONS } from '../../src/core/decisionTypes.js';

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
