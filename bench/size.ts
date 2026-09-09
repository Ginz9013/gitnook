import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * spec.md 四個硬指標之一：package size。
 *
 * 量的是 `npm pack` 產物解壓後的大小，不是 `src/`。使用者的磁碟上躺的是前者，
 * 而 `files` 欄位漏一行、多打包一個目錄，只有前者看得出來。
 */

/** spec.md 的閘門。3MB —— 對照 backlog.md 單平台 67.5MB 的 Bun binary。 */
export const SIZE_LIMIT_BYTES = 3 * 1024 * 1024;

export interface PackedPackage {
  /** 暫存根目錄，清掉它就等於全部清乾淨。 */
  readonly dir: string;
  /** `npm pack` 產出的 .tgz。 */
  readonly tarball: string;
  /** 解壓後的套件根目錄（tarball 內的 `package/`）。 */
  readonly root: string;
  readonly cleanup: () => void;
}

export interface SizeMeasurement {
  /** 解壓後所有檔案的 byte 總和。 */
  readonly bytes: number;
  readonly files: number;
  readonly limit: number;
}

/**
 * 打包一次並解壓到暫存目錄。
 *
 * `--pack-destination` 是刻意的：tarball 不落在 repo 根目錄，就沒有「測試後
 * 忘了清」這個問題，也不會有兩個行程互相踩到同一個檔名。
 */
export function packPackage(repoRoot: string): PackedPackage {
  const dir = mkdtempSync(join(tmpdir(), 'nook-pack-'));
  // prepack 會跑 build，所以這裡拿到的一定是當下原始碼建出來的產物。
  execFileSync('npm', ['pack', '--pack-destination', dir], { cwd: repoRoot, stdio: 'pipe' });
  const name = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  if (name === undefined) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('npm pack 沒有產出 tarball');
  }
  const tarball = join(dir, name);
  execFileSync('tar', ['-xzf', tarball, '-C', dir]);
  return {
    dir,
    tarball,
    root: join(dir, 'package'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 解壓後的套件有多大。目錄項本身不計，只加總實際檔案。 */
export function measurePackageSize(packedRoot: string): SizeMeasurement {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(packedRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    bytes += statSync(join(entry.parentPath, entry.name)).size;
    files += 1;
  }
  return { bytes, files, limit: SIZE_LIMIT_BYTES };
}

/**
 * studio 資產的閘門。
 *
 * 現值 412,686 B（studio.js 379,059 + studio.css 33,627），約佔 52%。一次翻倍
 * 就會撞到 —— 這正是要看見的事件：加一個圖表庫、把 vaul 裝回來、換掉 Radix，
 * 都會在這裡先亮起來，而不是被 package size 那個 3MB 的大數字吸收掉。
 */
export const STUDIO_ASSET_LIMIT_BYTES = 768 * 1024;

/**
 * studio 前端資產的體積，單獨量。
 *
 * 混在 package size 裡看不出來：studio 佔了整包的四分之三，它漲 50% 只讓
 * package size 從 17% 動到 25%，那個數字仍然是綠的、仍然離 3MB 很遠，
 * 而真正發生的事（前端多帶了一個 200KB 的相依）沒有任何一行會說出來。
 */
export function measureStudioAssets(packedRoot: string): SizeMeasurement {
  const dir = join(packedRoot, 'dist', 'studio');
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    bytes += statSync(join(entry.parentPath, entry.name)).size;
    files += 1;
  }
  if (files === 0) {
    // 空的 dist/studio 會量到 0 B 而「通過」閘門，同時 server 沒有資產可服務。
    // 單獨跑 `npx tsup` 就會造成這個狀態（它清掉整個 dist/，包含只有
    // `vite build` 會寫的 dist/studio/），所以這裡必須是硬錯誤。
    throw new Error(`${dir} 沒有任何資產 —— build 只跑了 tsup？請用 npm run build`);
  }
  return { bytes, files, limit: STUDIO_ASSET_LIMIT_BYTES };
}

/**
 * ADR-0008 的硬約束：**studio bundle 不得被 CLI 進入點 import**。
 *
 * 這些是 studio 那條依賴鏈在打包後一定會留下的痕跡。一個都不能出現在
 * `dist/cli/run.js` 裡。
 */
export const CLI_BUNDLE_FORBIDDEN_MARKERS = ['react', 'createRoot', 'radix', 'tailwind'] as const;

export interface CliBundleMarkers {
  /** 每個痕跡各出現幾次。超標時看得出是誰進來的。 */
  readonly counts: Readonly<Record<string, number>>;
  readonly total: number;
  /** 允許次數。0 —— 這不是預算，是有或沒有。 */
  readonly limit: 0;
}

/**
 * 數 `dist/cli/run.js` 裡的 React 痕跡。
 *
 * 這條約束目前只由冷啟的計時中位數**間接**守著，而計時會漂：在吵雜的機器上
 * 它會說「有點慢」，而不是「React 進了 CLI bundle」。而 packed-smoke 的
 * bare specifier 檢查也接不住 —— bundle 進去的 React 是被內聯的，沒有裸
 * specifier 留下。直接數 bundle 的內容，才抓得到真正的失效模式：
 * 那 400KB 從此每一次 `nook list` 都要重新 parse。
 *
 * 大小寫不敏感：`createRoot` 與 `Radix` 在產物裡的大小寫取決於打包器。
 */
export function measureCliBundleMarkers(packedRoot: string): CliBundleMarkers {
  const code = readFileSync(join(packedRoot, 'dist', 'cli', 'run.js'), 'utf8').toLowerCase();
  const counts: Record<string, number> = {};
  let total = 0;
  for (const marker of CLI_BUNDLE_FORBIDDEN_MARKERS) {
    const needle = marker.toLowerCase();
    let count = 0;
    for (let at = code.indexOf(needle); at !== -1; at = code.indexOf(needle, at + needle.length)) {
      count += 1;
    }
    counts[marker] = count;
    total += count;
  }
  return { counts, total, limit: 0 };
}
