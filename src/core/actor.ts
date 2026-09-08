import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * Actor 用於合併時的決勝，不表示某張 Issue 歸誰負責。
 * 由 git config user.email 確定性推導 —— 不儲存任何本機狀態（docs/adr/0002）。
 */
export function deriveActor(dir: string): string {
  let email = '';
  try {
    email = execFileSync('git', ['config', 'user.email'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    email = '';
  }
  return createHash('sha256').update(email || 'anonymous').digest('hex').slice(0, 4);
}
