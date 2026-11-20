import { execFileSync } from 'node:child_process';
import type { Diagnostic } from './types.js';
import { diagnoseContainer } from './container.js';
import { inspectNookConfig, CONFIG_FILE_RELATIVE } from './nookConfig.js';

/** 修復是容器的事（每個 Op-log 模組都修），這裡只是公開面的既有位置。 */
export { repair } from './container.js';
export type { Repair } from './container.js';

/**
 * 資料健康診斷。彙整成一份 Diagnostic 清單：這裡是不是 git work tree、
 * `.gitnook/config.json` 壞了沒，其餘（每個 Op-log 模組的 merge=union、Sharing
 * 的 fs／git 不一致、黏合行、未知的 op 型別、無法解析的行）都是容器的事，
 * 見 `diagnoseContainer`。
 */
export function diagnose(dir: string): Diagnostic[] {
  const found: Diagnostic[] = [];

  // .gitattributes 只在 git 底下生效，不是 repo 就沒有零衝突保證可言。
  const insideGit = isInsideGitWorkTree(dir);
  if (!insideGit) {
    found.push({
      kind: 'NotAGitRepo',
      message: `${dir} is not inside a git work tree: merge=union will not take effect`,
    });
  }

  // 檔案不存在不是壞掉——是還沒設定過 workspace，`inspectNookConfig` 的
  // `absent` 狀態在這裡跟 `valid` 一樣沉默。只有 `malformed`（不是合法 JSON，
  // 或合法 JSON 但不是物件）要開口：`readNookConfig` 對外把這兩種狀態都安全
  // 失敗成 `{}`，跟「沒開 workspace」長得一模一樣，`scan()`（票 04）因此會在
  // 這個目錄靜默停下——doctor 必須把這個狀態單獨講出來，否則使用者看不出掃描
  // 其實是被一個壞掉的檔案擋住的。
  if (inspectNookConfig(dir).status === 'malformed') {
    found.push({
      kind: 'InvalidNookConfig',
      file: CONFIG_FILE_RELATIVE,
      message:
        `${CONFIG_FILE_RELATIVE} is not valid JSON (or not a JSON object): workspace scanning will ` +
        `stop at this directory until it's fixed by hand (nook writes no git command, and there is ` +
        `nothing to auto-repair here — the file's shape has to be fixed by a human).`,
    });
  }

  found.push(...diagnoseContainer(dir, { insideGit }));

  return found;
}

function isInsideGitWorkTree(dir: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}
