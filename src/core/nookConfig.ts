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
 * `.gitnook/config.json` 的相對路徑，`/` 拼接——給 `health.ts` 的
 * `Diagnostic.file` 用，不隨平台分隔符漂移（同 `health.ts` 裡 `ISSUES_DIR` 的
 * 既有寫法）。
 */
export const CONFIG_FILE_RELATIVE = CONFIG_FILE.join('/');

/**
 * `inspectNookConfig()` 的三種狀態。**`readNookConfig()` 對外承諾「檔案不存在
 * 或無法解析一律回傳 `{}`，不拋錯」，這個承諾本身就抹掉了「不存在」跟「存在但
 * 壞掉」的差別**——而 `health.ts` 的 `InvalidNookConfig` 診斷剛好需要這個差別
 * （檔案不存在不是壞掉，是還沒設定過 workspace；檔案存在但解析不出來才要報）。
 * 這個函式補上那個更細的判斷，`readNookConfig()` 疊在它上面（見下方）。
 */
export type NookConfigInspection =
  | { readonly status: 'absent' }
  | { readonly status: 'valid'; readonly config: NookConfig }
  | { readonly status: 'malformed' };

/**
 * 讀 `.gitnook/config.json`，分辨檔案不存在／合法／壞掉三種狀態。
 *
 * 「壞掉」涵蓋兩種形狀：不是合法 JSON（截斷的檔案），以及合法 JSON 但不是物件
 * （例如整個檔案是 `"hello"` 或 `42`）——後者不是「合法設定值裡沒有 workspace
 * 欄位」那種情況，`workspace` 欄位若存在但不是 boolean 則安全省略（回傳
 * `valid`，`config` 裡沒有那個欄位），這一格屬於「值本身錯」，不是「檔案壞了」。
 */
export function inspectNookConfig(dir: string): NookConfigInspection {
  const file = join(dir, ...CONFIG_FILE);
  if (!existsSync(file)) return { status: 'absent' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { status: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'malformed' };
  }

  const workspace = (parsed as Record<string, unknown>).workspace;
  return { status: 'valid', config: typeof workspace === 'boolean' ? { workspace } : {} };
}

/**
 * 讀 `.gitnook/config.json`。**檔案不存在，或存在但不是合法 JSON／不是物件，
 * 一律回傳 `{}`，不拋錯**——熱路徑（`scan()`）不能因為一個壞掉的 config.json
 * 整個掛掉。格式錯誤的偵測與回報是 `health.ts` 的事，不是這裡（見
 * `inspectNookConfig`）。
 */
export function readNookConfig(dir: string): NookConfig {
  const inspected = inspectNookConfig(dir);
  return inspected.status === 'valid' ? inspected.config : {};
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
