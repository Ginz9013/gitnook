import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNookConfig, writeNookConfig } from '../../src/core/nookConfig.js';

// ADR-0004：真實檔案系統，每個測試用例獨立 mkdtemp。
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nook-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readNookConfig 檔案不存在', () => {
  it('回傳空物件，不拋錯', () => {
    expect(readNookConfig(dir)).toEqual({});
  });
});

describe('writeNookConfig 與 readNookConfig 的來回', () => {
  it('寫入 workspace: true，讀回同樣的值', () => {
    writeNookConfig(dir, { workspace: true });

    expect(readNookConfig(dir)).toEqual({ workspace: true });
    expect(existsSync(join(dir, '.gitnook', 'config.json'))).toBe(true);
  });

  it('.gitnook/ 目錄尚不存在時，writeNookConfig 自己建出來', () => {
    expect(existsSync(join(dir, '.gitnook'))).toBe(false);

    writeNookConfig(dir, { workspace: true });

    expect(existsSync(join(dir, '.gitnook'))).toBe(true);
  });

  it('整檔覆寫：第二次寫入完全取代第一次的內容', () => {
    writeNookConfig(dir, { workspace: true });
    writeNookConfig(dir, {});

    expect(readNookConfig(dir)).toEqual({});
  });
});

describe('readNookConfig 對壞掉的檔案安全失敗', () => {
  it('不是合法 JSON 時回傳空物件，不拋錯', () => {
    mkdirSync(join(dir, '.gitnook'), { recursive: true });
    writeFileSync(join(dir, '.gitnook', 'config.json'), '{not json', 'utf8');

    expect(readNookConfig(dir)).toEqual({});
  });

  it('是合法 JSON 但不是物件（陣列、字串、數字）時回傳空物件', () => {
    mkdirSync(join(dir, '.gitnook'), { recursive: true });
    const file = join(dir, '.gitnook', 'config.json');

    for (const bad of ['[]', '"hello"', '42', 'null']) {
      writeFileSync(file, bad, 'utf8');
      expect(readNookConfig(dir), bad).toEqual({});
    }
  });

  it('workspace 欄位不是 boolean 時，該欄位被安全省略', () => {
    mkdirSync(join(dir, '.gitnook'), { recursive: true });
    writeFileSync(join(dir, '.gitnook', 'config.json'), '{"workspace":"yes"}', 'utf8');

    expect(readNookConfig(dir)).toEqual({});
  });
});

describe('readNookConfig 不知道 .gitnook/ 本身存不存在', () => {
  it('.gitnook/ 目錄不存在時同樣回傳空物件，不拋錯', () => {
    expect(existsSync(join(dir, '.gitnook'))).toBe(false);

    expect(readNookConfig(dir)).toEqual({});
  });
});
