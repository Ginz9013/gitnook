import type { Diagnostic } from './types.js';
import { NotImplemented } from './types.js';

/**
 * 資料健康診斷。票 06 填入實作，票 05 補上黏合行與未知 Op 的偵測。
 * 由 board.health() 委派 —— 後續的票因此不需要修改 board.ts。
 */
export function diagnose(_dir: string): Diagnostic[] {
  throw new NotImplemented('diagnose');
}
