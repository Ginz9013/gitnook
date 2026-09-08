import { NotImplemented } from './types.js';

/**
 * 建立 .issues/issues/ 並冪等寫入 `.issues/issues/*.ndjson merge=union`。
 * 那一行是整個零衝突保證的唯一支柱 —— docs/adr/0001。票 06 填入實作。
 */
export function initBoard(_dir: string): void {
  throw new NotImplemented('initBoard');
}
