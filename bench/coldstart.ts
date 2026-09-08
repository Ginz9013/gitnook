import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * spec.md 四個硬指標之一：`npx` 冷啟。
 *
 * 量的是**打包後**的 bin，不是 `src/`：使用者按下 enter 之後等的是那一個。
 * Node 本身冷啟就要 10–20ms（docs/adr/0002），所以這個閘門實際上是在守
 * 「我們自己載入了多少東西」。
 */

/** spec.md 的閘門。 */
export const COLD_START_LIMIT_MS = 500;

export interface ColdStartMeasurement {
  /** 多次執行的中位數，毫秒。取中位數而非平均，才不會被單一次 GC 或磁碟抖動帶走。 */
  readonly median: number;
  /** 每一次的耗時，由小到大。超標時看得出是穩定慢還是偶發尖峰。 */
  readonly samples: readonly number[];
  readonly limit: number;
}

/**
 * 跑 `nook --version` 若干次並取中位數。
 *
 * 每一次都驗證輸出真的是套件版本 —— 一個啟動就爆炸的 bin 是**最快**的，
 * 不驗證的話這個閘門會在壞掉的時候給出最漂亮的數字。
 */
export function measureColdStart(packedRoot: string, runs = 11): ColdStartMeasurement {
  const expected = (
    JSON.parse(readFileSync(join(packedRoot, 'package.json'), 'utf8')) as { version: string }
  ).version;
  const bin = join(packedRoot, 'bin', 'nook.js');

  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = process.hrtime.bigint();
    const stdout = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    if (stdout.trim() !== expected) {
      throw new Error(`冷啟量測到的不是版本輸出：${JSON.stringify(stdout)}`);
    }
    samples.push(elapsed);
  }

  samples.sort((a, b) => a - b);
  const mid = (samples.length - 1) / 2;
  // 偶數筆時取中間兩筆的較小者，讓中位數永遠是一個實際跑出來的樣本。
  const median = samples[Math.floor(mid)] ?? Number.NaN;

  return { median, samples, limit: COLD_START_LIMIT_MS };
}
