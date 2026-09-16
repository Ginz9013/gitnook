import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openBoard } from '../../src/index.js';
import { initBoard } from '../../src/core/gitattributes.js';

/**
 * 接縫：**一個真的舊版二進位檔，讀一塊真的 board**（ADR-0004：不設 storage 接縫，
 * 打真實檔案系統與真實 git；`packed-smoke` 與 `git-merge` 也都 spawn 真的子行程）。
 *
 * 守的是 ADR-0009 的 D2 —— **Issue 檔永不 unlink**，而不是 D1（刪除是 LWW 欄位）。
 * 兩者的差別決定了這個檔案長什麼樣：把 `deleted` 改成一個新的 op 型別（推翻 D1），
 * 舊版讀不懂那行、照樣看得見那張 Issue，這裡仍然全綠；真正會讓它紅的是有人把刪除
 * 實作成 `unlinkSync(pathOf(id))`，舊版於是**看不到**那張 Issue，失敗方向反轉。
 *
 * 為什麼要有這個檔案：spec 的驗收條件 4 是整批工作最核心的承諾（資料活在 git 裡、
 * 隊友的版本不同步是常態 —— ADR-0001 硬規則 2），在此之前它只被人工走查驗過兩次。
 * `test/core/reduce.malformed.test.ts` 釘的是「`reduce` 忽略未知的 `set` 欄位」那個
 * 機制，沒有任何東西釘住「**那個已發布的二進位檔**讀這塊 board 時看得見它」。
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * **刻意**用 `node_modules/gitnook/bin/nook.js`，不是工作樹的 `bin/nook.js`。
 *
 * AGENT.md 對 studio 的告誡（「`node_modules/gitnook` 是符號連結，會給你舊的前端」）
 * 在這裡整個反過來 —— 這個檔案要的**正是**「已發布的舊版本」這個角色，它就是那個
 * 舊讀者。改成 `bin/nook.js` 會讓這條測試變成拿新版讀新版，兩邊都懂 deleted，
 * 於是什麼都不證明卻依然全綠。**請不要照著 AGENT.md「修正」這一行。**
 */
const OLD_NOOK = join(repoRoot, 'node_modules', 'gitnook', 'bin', 'nook.js');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly output: string;
}

/** 跑那個舊二進位檔。不拋出 —— 「exit 0」本身就是斷言的對象之一。 */
function oldNook(cwd: string, ...args: string[]): Run {
  const r = spawnSync(process.execPath, [OLD_NOOK, ...args], { cwd, encoding: 'utf8' });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? '',
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
  };
}

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗：${r.stdout}${r.stderr}`);
}

const KEPT = 'Fix login redirect loop on Safari 17';
const REMOVED = 'Drop the legacy import path';

interface Fixture {
  readonly dir: string;
  readonly keptId: string;
  readonly removedId: string;
}

/**
 * 一塊真實的 board，兩張 Issue，其中一張用**工作樹的** core 標成 deleted。
 * 共用資源紀律：自己 mkdtemp，git 設定只設 local，不碰使用者的全域設定。
 */
function boardWithOneDeleted(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'nook-fwdcompat-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@nook.invalid');
  git(dir, 'config', 'user.name', 'Nook Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  initBoard(dir);

  const board = openBoard({ dir, actor: 'aaaa' });
  const kept = board.create({ title: KEPT });
  const removed = board.create({ title: REMOVED });
  board.apply(removed.id, { deleted: true });

  // 前置條件，不是結論：工作樹這一側必須真的把它刪掉了，否則下面「舊版看得見」
  // 這件事只是因為根本沒發生過刪除。
  //
  // 這裡刻意**只**問 list()。「board.get 照常回傳且 deleted 為 true」那一半住在
  // test/core/board.deleted.test.ts；把它也擺進前置條件，會讓 unlink 版的實作在
  // 前置條件上就爆掉，紅燈於是講不出「舊版看不見它」這句真正要守的話。
  expect(board.list({ all: true }).map((i) => i.title)).toEqual([KEPT]);

  return { dir, keptId: kept.id, removedId: removed.id };
}

/** 緊湊表格（ADR-0005）：`<short ref>  <status>  <title>`，標題含空白所以取到行尾。 */
function titlesOf(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => /^\S+ {2}\S+ {2}(.*)$/.exec(line)?.[1] ?? line);
}

describe('舊版 nook 讀一塊有墓碑的 board', () => {
  it('list --all 仍然看得見被刪的那張 —— 失敗方向是「多看見」而不是「不見了」', () => {
    const { dir } = boardWithOneDeleted();

    const listed = oldNook(dir, 'list', '--all');

    expect(listed.status, listed.output).toBe(0);
    // 舊版不認得 `set deleted=true`，依 ADR-0001 硬規則 2 跳過那一行 —— 於是兩張都在。
    // 這條變紅只有一種原因：有人讓刪除把那張 Issue 從舊版的視野裡拿掉了。
    expect(titlesOf(listed.stdout).sort()).toEqual([REMOVED, KEPT].sort());
  }, 30_000);

  it('doctor exit 0 —— 墓碑不是資料損壞', () => {
    const { dir } = boardWithOneDeleted();

    const doctor = oldNook(dir, 'doctor');

    // 一個未知的 `set` 欄位是**向前相容**，不是壞掉的資料。舊版若把它報成損壞，
    // 隊友會以為自己的 board 需要修，而它其實好好的。
    expect(doctor.status, doctor.output).toBe(0);
  }, 30_000);

  it('被刪那張的 op-log 檔還在磁碟上，且刪除是 append 上去的一行', () => {
    const { dir, removedId } = boardWithOneDeleted();

    // D2 的機制面：舊版看得見它，是因為那個檔從來沒有被 unlink。
    const log = join(dir, '.gitnook', 'issues', `${removedId}.ndjson`);
    expect(existsSync(log)).toBe(true);
    // 誤刪的救生索 —— create 那一行也還在，不是被覆寫成一個墓碑。
    expect(readFileSync(log, 'utf8')).toContain(REMOVED);
  }, 30_000);
});

describe('守衛的守衛：那個二進位檔必須真的是舊讀者', () => {
  it('node_modules/gitnook 不認得 deleted 這個欄位', () => {
    // 拿**沒被刪**的那張來問。這條守的是二進位檔的身分，不是刪除的行為 ——
    // 用被刪的那張會讓它跟著上面幾條一起紅，而它要講的是另一件事。
    const { dir, keptId } = boardWithOneDeleted();

    const set = oldNook(dir, 'set', keptId, 'deleted', 'true');

    // `node_modules/gitnook` 是指向已發布版本的符號連結。若日後 devDependencies
    // 被升到一個**自己就有刪除功能**的版本，上面那三條會安靜地變成「新版讀新版」
    // —— 全綠，但什麼都不再證明。這一條是那一天的絆線。
    //
    // 票面原本要求斷言「二進位檔的 --version 不等於 package.json 的 version」。
    // 那個代理指標目前不成立：工作樹與已發布的套件同為 0.1.0。這裡改成直接量能力
    // —— 一個懂 deleted 的 nook 不是舊讀者，不管它的版號是多少 —— 並把兩個版號
    // 放進失敗訊息，讓那天被擋下來的人一眼看出是誰動了 devDependency。
    const versions =
      `published=${oldNook(dir, '--version').stdout.trim()} ` +
      `working-tree=${
        (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string })
          .version
      }`;
    expect(set.status, versions).toBe(1);
    expect(set.output, versions).toContain('deleted');
    // 舊版的可寫欄位清單裡沒有它 —— 這就是「這份二進位檔早於刪除功能」的定義。
    expect(set.output, versions).toContain('title, description, status, archived');
  }, 30_000);
});
