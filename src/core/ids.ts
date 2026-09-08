import { randomFillSync } from 'node:crypto';
import type { IdSource } from './types.js';

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

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export const systemIds: IdSource = { ulid: () => ulid() };
