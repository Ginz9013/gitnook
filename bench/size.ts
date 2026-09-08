import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
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
