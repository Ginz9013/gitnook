import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COLD_START_LIMIT_MS, measureColdStart } from './coldstart.ts';
import { SIZE_LIMIT_BYTES, measurePackageSize, packPackage } from './size.ts';

/**
 * spec.md「四個硬指標」的單一入口。`npm run bench` 一次列出四個當前數值，
 * 任何一個超標就 exit 1。
 *
 * 其中兩個（體積、冷啟）在這裡實測；另外兩個（並行 merge、agent token）的
 * 量測早就存在於票 05 與票 07 的測試裡，所以這裡**執行那些測試**而不是把
 * 情境再抄一份 —— 抄一份就會有第二個真相來源，而閘門守的會是抄過來的那個。
 *
 * 這個檔案以 `.ts` specifier 匯入同目錄的模組，因為 `npm run bench` 是由
 * Node 直接執行（type stripping），Node 不會把 `./size.js` 解析到 `size.ts`。
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const MERGE_TEST = 'test/integration/git-merge.test.ts';
const TOKEN_TEST = 'test/render/token-budget.test.ts';

interface Row {
  readonly name: string;
  readonly actual: string;
  readonly limit: string;
  readonly headroom: string;
  readonly ok: boolean;
}

/** 跑一個既有的測試檔，回傳它的通過與否與完整輸出。 */
function runTest(file: string): { readonly ok: boolean; readonly output: string } {
  // verbose reporter：預設的 reporter 會把通過測試的 console 輸出吃掉，而
  // token 閘門的數值就在那裡面。
  const result = spawnSync('npx', ['vitest', 'run', file, '--reporter=verbose'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

function sizeRow(packedRoot: string): Row {
  const { bytes } = measurePackageSize(packedRoot);
  return {
    name: 'package size',
    actual: `${bytes} B`,
    limit: `${SIZE_LIMIT_BYTES} B`,
    headroom: `${SIZE_LIMIT_BYTES - bytes} B`,
    ok: bytes < SIZE_LIMIT_BYTES,
  };
}

function coldStartRow(packedRoot: string): Row {
  const { median, samples } = measureColdStart(packedRoot);
  const spread = `${samples[0]?.toFixed(1) ?? '?'}–${samples[samples.length - 1]?.toFixed(1) ?? '?'}`;
  return {
    name: 'cold start',
    actual: `${median.toFixed(1)} ms`,
    limit: `${COLD_START_LIMIT_MS} ms`,
    headroom: `${(COLD_START_LIMIT_MS - median).toFixed(1)} ms (${spread})`,
    ok: median < COLD_START_LIMIT_MS,
  };
}

/** 並行 merge 的閘門是真實 git 整合測試（票 05）。實測值就是衝突檔數。 */
function mergeRow(): Row {
  const { ok } = runTest(MERGE_TEST);
  return {
    name: 'concurrent merge',
    actual: ok ? '0 conflicts' : '>0 conflicts',
    limit: '0 conflicts',
    headroom: '—',
    ok,
  };
}

/** agent token 的閘門是 40 票情境（票 07）。數值從它自己印的報告裡取。 */
function tokenRow(): Row {
  const { ok, output } = runTest(TOKEN_TEST);
  const parsed = /總計 (\d+)B \/ 上限 (\d+)B，餘裕 (-?\d+)B/.exec(output);
  if (parsed === null) {
    // 解析不到就是硬錯誤。靜默回報一個猜測的數字，等於讓閘門在自己壞掉時放行。
    throw new Error(`${TOKEN_TEST} 沒有印出可解析的預算報告：\n${output}`);
  }
  return {
    name: 'agent token',
    actual: `${parsed[1]} B`,
    limit: `${parsed[2]} B`,
    headroom: `${parsed[3]} B`,
    ok,
  };
}

function format(rows: readonly Row[]): string {
  const line = (r: Row): string =>
    `${r.name.padEnd(18)}${r.actual.padStart(14)}${r.limit.padStart(14)}` +
    `${r.headroom.padStart(22)}  ${r.ok ? 'ok' : 'OVER'}`;
  return [
    `${'metric'.padEnd(18)}${'actual'.padStart(14)}${'limit'.padStart(14)}${'headroom'.padStart(22)}  status`,
    ...rows.map(line),
  ].join('\n');
}

const packed = packPackage(REPO_ROOT);
try {
  // 順序與 spec.md「四個硬指標」的表格一致。
  const rows: readonly Row[] = [sizeRow(packed.root), coldStartRow(packed.root), mergeRow(), tokenRow()];
  console.log(`nook bench — node ${process.version} ${process.platform}-${process.arch}`);
  console.log(format(rows));
  const over = rows.filter((r) => !r.ok);
  if (over.length > 0) {
    console.error(`\n超標：${over.map((r) => r.name).join('、')}`);
    process.exitCode = 1;
  }
} finally {
  packed.cleanup();
}
