import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `.gitnook/config.json` 的形狀——目前只有一個欄位：`workspace`，`scan()`
 * （票 02 的 `src/core/workspace.ts`）讀它決定要不要繼續往這個 board 底下鑽。
 *
 * **這個模組不知道 workspace 掃描或 init 的語意**，純粹是一個小型 config 檔案
 * 存取層——`workspace.ts`/`gitattributes.ts` 才知道這個欄位代表什麼。
 */
export interface NookConfig {
  readonly workspace?: boolean;
}

const CONFIG_FILE = ['.gitnook', 'config.json'] as const;

/**
 * 讀 `.gitnook/config.json`。**檔案不存在，或存在但不是合法 JSON／不是物件，
 * 一律回傳 `{}`，不拋錯**——熱路徑（`scan()`）不能因為一個壞掉的 config.json
 * 整個掛掉。格式錯誤的偵測與回報是 `health.ts` 的事，不是這裡。
 *
 * `workspace` 欄位若存在但不是 boolean，同樣視為沒寫過（回傳時省略它）——安全
 * 失敗的原則延伸到欄位層級，不只是整份檔案層級。
 */
export function readNookConfig(dir: string): NookConfig {
  const file = join(dir, ...CONFIG_FILE);
  if (!existsSync(file)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const workspace = (parsed as Record<string, unknown>).workspace;
  return typeof workspace === 'boolean' ? { workspace } : {};
}

/**
 * 整檔覆寫 `.gitnook/config.json`。呼叫端（`initNook`）負責 additive-only 的
 * 語意（不寫入就是不動既有值）——這裡只負責「寫出去的就是給的那份」。
 *
 * `.gitnook/` 目錄本身若還不存在則建出來：呼叫端可能先寫 config 再建
 * issues/decisions 目錄（或反過來），這個順序不該是這個檔案的關切。
 */
export function writeNookConfig(dir: string, config: NookConfig): void {
  mkdirSync(join(dir, '.gitnook'), { recursive: true });
  writeFileSync(join(dir, ...CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
