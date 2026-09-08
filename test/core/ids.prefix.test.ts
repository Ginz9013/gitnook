import { describe, it, expect } from 'vitest';
import { resolvePrefix, shortIdLength } from '../../src/core/ids.js';
import { AmbiguousRef, RefNotFound } from '../../src/core/types.js';

/** 測試用的完整 ULID：不足 26 碼補 0，字元皆屬 Crockford base32。 */
const fullId = (prefix: string): string => prefix.padEnd(26, '0');

describe('shortIdLength', () => {
  it('遇到重複的識別碼時停在識別碼全長，不會無限拉長', () => {
    const id = fullId('01JBXA');

    // 重複的識別碼永遠分不開。此時唯一能給的答案是全長 ——
    // 而不是永遠給不出答案。
    expect(shortIdLength([id, id])).toBe(26);
  });

  // Guard：寫完即綠。以變異測試確認它不是空的 —— 見執行報告。
  it('沒有碰撞時回傳預設的 6 碼', () => {
    // 6 碼取自 spec.md「預設顯示 6 碼，撞號時報錯要求更長」，不是取自實作。
    expect(shortIdLength([])).toBe(6);
    expect(shortIdLength([fullId('01JBXA')])).toBe(6);
    expect(shortIdLength([fullId('01JBXA'), fullId('01JBXB')])).toBe(6);
  });

  // Guard：寫完即綠。以變異測試確認它不是空的 —— 見執行報告。
  it('長度由整批中最壞的一對決定，而非只看前兩個', () => {
    const ids = [
      fullId('01JBXA'),
      fullId('01JBXB'),
      fullId('01JBXQ7A9ZA'),
      fullId('01JBXQ7A9ZB'),
    ];

    // 後兩者第一個相異的字元在索引 10，故整批需要 11 碼。
    expect(shortIdLength(ids)).toBe(11);
  });
});

describe('resolvePrefix', () => {
  const ids = [fullId('01JBXA'), fullId('01JBXB')];

  // Guard：寫完即綠。以變異測試確認它不是空的 —— 見執行報告。
  it('完整識別碼與較短的無歧義前綴解析到同一張 Issue', () => {
    expect(resolvePrefix(ids[0]!, ids)).toBe(ids[0]);
    expect(resolvePrefix('01JBXA', ids)).toBe(ids[0]);
  });

  // Guard：寫完即綠。以變異測試確認它不是空的 —— 見執行報告。
  it('無對應時拋 RefNotFound，撞到多筆時拋 AmbiguousRef', () => {
    expect(() => resolvePrefix('01ZZZZ', ids)).toThrow(RefNotFound);
    // 空的 board 沒有任何候選，連完整識別碼也解析不到。
    expect(() => resolvePrefix(ids[0]!, [])).toThrow(RefNotFound);
    expect(() => resolvePrefix('01JBX', ids)).toThrow(AmbiguousRef);
  });
});
