import { randomFillSync } from 'node:crypto';
import type { IdSource } from './types.js';
import { AmbiguousRef, RefNotFound } from './types.js';

/** Crockford base32：排除 I、L、O、U。256 可被 32 整除，故 % 32 無偏差。 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export function encodeTime(ms: number, len: number = TIME_LEN): string {
  let out = '';
  let n = ms;
  for (let i = 0; i < len; i++) {
    out = ALPHABET[n % 32]! + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(len: number = RANDOM_LEN): string {
  const bytes = randomFillSync(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % 32]!;
  return out;
}

/**
 * Ref 只由 Crockford base32 的字元組成（CONTEXT.md 的 Ref 定義）。
 * 這個檢查同時是路徑穿越的防線：完整識別碼會被接進檔案路徑，而 join()
 * 會把 ../ 正規化到 .issues/issues/ 之外。CLI 與 studio server 的
 * /i/<ref> 都會把使用者輸入直接餵進來。
 */
const REF_SHAPE = /^[0-9A-HJKMNP-TV-Z]{1,26}$/i;

/**
 * Crockford base32 明定解碼時大小寫不敏感，故 ref 一律正規化為大寫後比對。
 * 未實作 Crockford 的字元替換（I/L → 1、O → 0）—— ULID 的字母表本就不含
 * 這些字元，要不要接受該類轉錄錯誤是另一個產品決定。
 */
export function normalizeRef(ref: string): string {
  return ref.toUpperCase();
}

export function isValidRef(ref: string): boolean {
  return REF_SHAPE.test(ref);
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export const systemIds: IdSource = { ulid: () => ulid() };

/** 短 ID 的預設顯示長度，同 git short hash 的習慣。 */
export const SHORT_ID_MIN = 6;

/**
 * 這批識別碼要幾碼才彼此無歧義。渲染層與 CLI 用它決定短 ID 的顯示長度 ——
 * 盲取 6 碼會讓兩張前綴相同的 Issue 產生一模一樣的短 ID（票 08 的發現）。
 */
export function shortIdLength(ids: readonly string[]): number {
  // 重複的識別碼永遠分不開，拉長也沒有用。全長是唯一能給的答案 ——
  // 沒有這個上界，這裡就是一個同步的無窮迴圈。
  let max = SHORT_ID_MIN;
  for (const id of ids) if (id.length > max) max = id.length;

  let len = SHORT_ID_MIN;
  while (len < max && new Set(ids.map((id) => id.slice(0, len))).size !== ids.length) len++;
  return len;
}

/**
 * 把一個 Ref 解析成完整識別碼。Ref 可以是完整識別碼，也可以是任何無歧義的
 * 前綴（同 git short hash）—— 見 CONTEXT.md。
 */
export function resolvePrefix(ref: string, ids: readonly string[]): string {
  const matches = ids.filter((id) => id.startsWith(ref));
  if (matches.length === 0) throw new RefNotFound(ref);
  if (matches.length > 1) {
    // 候選必須以「足以彼此區分」的長度呈現，否則錯誤訊息無法回答任何問題。
    const len = shortIdLength(matches);
    throw new AmbiguousRef(ref, matches.map((id) => id.slice(0, len)));
  }
  return matches[0]!;
}
