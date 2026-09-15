import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLD_START_LIMIT_MS, measureColdStart } from '../../bench/coldstart.js';
import { SIZE_LIMIT_BYTES, measurePackageSize, packPackage } from '../../bench/size.js';

/**
 * spec.md 的接縫：**打包產物本身**。
 *
 * 這個檔案刻意不 import 任何 `src/` 的東西。`src/` 綠而 tarball 壞掉是這張票
 * 唯一要防的事 —— `files` 漏一個目錄、`exports` 指錯路徑、bin 少了執行權限，
 * 全都只在使用者實際拿到的那份產物上看得見。
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * 打包一次全檔共用：`npm pack` 會跑 prepack（build），每個測試各跑一次太慢。
 * 刻意複用 bench 的 `packPackage` —— 閘門量的與煙霧測試驗的必須是同一份產物，
 * 兩邊各寫一次打包邏輯就會有一邊先漂走。
 */
let packed: ReturnType<typeof packPackage>;

beforeAll(() => {
  packed = packPackage(repoRoot);
}, 180_000);

/**
 * 一個乾淨的消費端專案，`npm install <tarball>` 之後的樣子 —— 也就是使用者
 * 真正會執行的那條路徑（`node_modules/gitnook` + `node_modules/.bin/nook`）。
 */
let consumer: { dir: string };

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'nook-consumer-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', type: 'module', private: true }),
  );
  execFileSync('npm', ['install', '--no-audit', '--no-fund', packed.tarball], {
    cwd: dir,
    stdio: 'pipe',
  });
  consumer = { dir };
}, 180_000);

afterAll(() => {
  if (packed !== undefined) packed.cleanup();
  if (consumer !== undefined) rmSync(consumer.dir, { recursive: true, force: true });
});

/** 用 repo 的 tsc 型別檢查消費端的一個檔案，回傳 tsc 的輸出（空字串即無錯誤）。 */
const typecheckInConsumer = (name: string, source: string): string => {
  const file = join(consumer.dir, name);
  writeFileSync(file, source);
  const tsc = spawnSync(
    join(repoRoot, 'node_modules', '.bin', 'tsc'),
    [
      '--ignoreConfig',
      file,
      '--noEmit',
      '--strict',
      '--target',
      'es2023',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--skipLibCheck',
    ],
    { cwd: consumer.dir, encoding: 'utf8' },
  );
  return `${tsc.stdout}${tsc.stderr}`.trim();
};

/** 在消費端專案裡跑一段 ESM，回傳 stdout。 */
const runInConsumer = (source: string): string => {
  const file = join(consumer.dir, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, source);
  return execFileSync(process.execPath, [file], { cwd: consumer.dir, encoding: 'utf8' });
};

/** tarball 內的檔案清單，去掉 `package/` 前綴。 */
const entries = (): string[] =>
  execFileSync('tar', ['-tzf', packed.tarball], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0 && !line.endsWith('/'))
    .map((line) => line.replace(/^package\//, ''));

const declaredVersion = (): string =>
  (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;

describe('打包產物', () => {
  it('bin 在 tarball 內可直接執行並印出套件版本', () => {
    const stdout = execFileSync(process.execPath, [join(packed.root, 'bin', 'nook.js'), '--version'], {
      encoding: 'utf8',
    });

    expect(stdout.trim()).toBe(declaredVersion());
  }, 30_000);

  it('tarball 只含發布必需品，沒有 src、測試與 golden 檔', () => {
    const files = entries();

    // 使用者拿到的東西：bundle、型別、bin、以及授權與門面文件。
    expect(files).toEqual(
      expect.arrayContaining([
        'package.json',
        'bin/nook.js',
        'dist/index.js',
        'dist/index.d.ts',
        'dist/cli/run.js',
        'README.md',
        'LICENSE',
      ]),
    );
    // 使用者不該拿到的東西。src/ 進了 tarball 就等於在使用者的 node_modules
    // 裡放一份沒編譯過的第二來源，且體積閘門會量到不會被執行的位元組。
    expect(files.filter((f) => f.startsWith('src/'))).toEqual([]);
    expect(files.filter((f) => f.startsWith('test/'))).toEqual([]);
    expect(files.filter((f) => f.includes('__golden__'))).toEqual([]);
    // .d.ts 以外沒有任何 TypeScript 原始碼。
    expect(files.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))).toEqual([]);
  }, 30_000);

  it('安裝後可以 import { openBoard } from \'gitnook\' —— library-first 是產品定位', () => {
    const stdout = runInConsumer(
      "import { openBoard, STATUSES } from 'gitnook';\n" +
        'process.stdout.write(`${typeof openBoard} ${STATUSES.join(\' \')}`);\n',
    );

    // 八個固定 Status，順序取自 spec.md 的領域模型（docs/adr/0003）。
    expect(stdout).toBe(
      'function backlog todo queued in_progress review blocked done cancelled',
    );
  }, 30_000);

  it('乾淨的暫存目錄裡 init → new → list 全程走安裝後的 bin', () => {
    const work = mkdtempSync(join(tmpdir(), 'nook-work-'));
    try {
      // 自帶 git 身分：actor 由 git config user.email 推導，測試不得依賴
      // 也不得修改使用者的全域設定。
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: work, stdio: 'pipe' });
      };
      git('init', '-q');
      git('config', 'user.email', 'smoke@example.test');
      git('config', 'user.name', 'nook smoke');
      git('config', 'commit.gpgsign', 'false');

      // node_modules/.bin/nook —— 使用者實際會打的那個指令，不是 src/。
      const nook = (...args: string[]): string =>
        execFileSync(join(consumer.dir, 'node_modules', '.bin', 'nook'), args, {
          cwd: work,
          encoding: 'utf8',
        });

      nook('issue', 'init');
      nook('issue', 'new', 'Fix login redirect loop on Safari 17');
      const listed = nook('issue', 'list');

      expect(existsSync(join(work, '.issues', 'issues'))).toBe(true);
      // 唯一的單點失效（ADR-0001）：init 必須寫下這一行。
      expect(readFileSync(join(work, '.gitattributes'), 'utf8')).toContain(
        '.issues/issues/*.ndjson merge=union',
      );
      // 緊湊表格：<short id>  <status>  <title>，新票預設落在人的車道起點。
      expect(listed).toMatch(/^[0-9A-Z]{6}  backlog  Fix login redirect loop on Safari 17\n$/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  it('安裝後帶來零個 runtime dependency，且 bundle 只 import node: 內建', () => {
    const manifest = JSON.parse(readFileSync(join(packed.root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    // ADR-0002：沒有原生 binary、沒有 SQLite、沒有任何會被拖進來的東西。
    expect(manifest['dependencies'] ?? {}).toEqual({});
    expect(manifest['peerDependencies'] ?? {}).toEqual({});
    expect(manifest['optionalDependencies'] ?? {}).toEqual({});
    // 宣告為零與實際安裝為零是兩件事，所以兩個都量。
    const tree = readdirSync(join(consumer.dir, 'node_modules')).filter((f) => !f.startsWith('.'));
    expect(tree).toEqual(['gitnook']);

    // 出貨的 bundle 裡不得留下任何 bare specifier —— 那代表一個沒宣告的
    // runtime dependency，安裝後才會在使用者機器上炸開。
    const bare = [join('dist', 'index.js'), join('dist', 'cli', 'run.js')].flatMap((rel) => {
      const code = readFileSync(join(packed.root, rel), 'utf8');
      return [
        ...code.matchAll(/\bfrom\s*["']([^"']+)["']/g),
        ...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
        ...code.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
      ]
        .map((m) => m[1] as string)
        .filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'));
    });
    expect(bare).toEqual([]);
  }, 30_000);

  it('宣告可發布：MIT、engines.node >= 22、不是 private', () => {
    const manifest = JSON.parse(readFileSync(join(packed.root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    expect(manifest['license']).toBe('MIT');
    expect(manifest['engines']).toEqual({ node: '>=22' });
    // private 留著會讓 publish 直接被擋下 —— 這張票的產出就白做了。
    expect(manifest['private']).toBeUndefined();
    expect(readFileSync(join(packed.root, 'LICENSE'), 'utf8')).toContain('MIT License');
  }, 30_000);

  it('安裝後帶著可用的型別宣告，錯誤的用法會被 tsc 擋下', () => {
    const good = typecheckInConsumer(
      'good.ts',
      "import { openBoard, type Board, type Issue } from 'gitnook';\n" +
        'const board: Board = openBoard();\n' +
        "const issue: Issue = board.create({ title: 'Fix login redirect' });\n" +
        'export const title: string = issue.title;\n',
    );

    expect(good).toBe('');

    // 型別若解析成 any，上面那段一樣會過。用一個必須被擋下的用法證明
    // 宣告是真的被讀到了，而不是靜默退化成 any。
    const bad = typecheckInConsumer(
      'bad.ts',
      "import { openBoard } from 'gitnook';\n" +
        "export const wrong: number = openBoard().create({ title: 'x' }).title;\n",
    );

    expect(bad).toContain('bad.ts');
    expect(bad).toContain("Type 'string' is not assignable to type 'number'");
  }, 60_000);

  it('README 給 agent 的指令說明與 token 閘門量測的那一份逐字相同', () => {
    // token 閘門量的是 token-budget.test.ts 裡的 SKILL_DOC。README 若寫了
    // 另一個版本，閘門守的就不是真正出貨的那份文件了 —— 所以真相來源是它，
    // 這裡把它抓出來當期望值。
    const budgetTest = readFileSync(
      join(repoRoot, 'test', 'render', 'token-budget.test.ts'),
      'utf8',
    );
    const skillDoc = /const SKILL_DOC = `([^`]*)`/.exec(budgetTest)?.[1];
    expect(skillDoc, 'token-budget.test.ts 裡找不到 SKILL_DOC').toBeTypeOf('string');
    expect(skillDoc).toContain('nook issue list [--all]');

    const readme = readFileSync(join(packed.root, 'README.md'), 'utf8');

    expect(readme).toContain(skillDoc);
  }, 30_000);

  it('README 公開拒絕的東西與四個硬指標都寫在出貨的那一份裡', () => {
    const readme = readFileSync(join(packed.root, 'README.md'), 'utf8');

    // spec.md 的 Non-goals。護城河是拒絕成為專案管理工具的能力，藏起來就沒有了。
    for (const refused of ['assignee', 'priority', 'milestone', 'due date', 'MCP', 'TUI']) {
      expect(readme.toLowerCase(), `README 沒有公開拒絕 ${refused}`).toContain(
        refused.toLowerCase(),
      );
    }
    expect(readme).toContain('project management');

    // spec.md 四個硬指標的上限。
    expect(readme).toContain('3 MB');
    expect(readme).toContain('500 ms');
    expect(readme).toContain('zero conflicts');
    expect(readme).toContain('4.5 KB');
  }, 30_000);
});

describe('硬指標閘門', () => {
  it('解壓後的體積低於 3MB', () => {
    const size = measurePackageSize(packed.root);

    // 3MB 是 spec.md 訂的閘門，不是量到多少就寫多少。
    expect(size.limit).toBe(3 * 1024 * 1024);
    expect(SIZE_LIMIT_BYTES).toBe(3 * 1024 * 1024);
    // 量到的檔案數要對得上 tar 自己列的清單 —— 少走一層目錄就會量出偏小的值，
    // 而偏小的值會讓閘門在真的變胖時仍然全綠。
    expect(size.files).toBe(entries().length);
    expect(size.bytes).toBeGreaterThan(
      readFileSync(join(packed.root, 'dist', 'index.js')).byteLength,
    );

    console.log(`package size ${size.bytes}B / 上限 ${size.limit}B，餘裕 ${size.limit - size.bytes}B`);
    expect(size.bytes).toBeLessThan(size.limit);
  }, 30_000);

  it('從 tarball 冷啟 nook --version 的中位數低於 500ms', () => {
    const cold = measureColdStart(packed.root, 5);

    expect(cold.limit).toBe(500);
    expect(COLD_START_LIMIT_MS).toBe(500);
    expect(cold.samples).toHaveLength(5);
    // 中位數的定義，不是把演算法再算一次：它要是某個實測樣本，而且兩側各有
    // 至少一半的樣本。取到平均或取到最小值都會在這裡露餡。
    expect(cold.samples).toContain(cold.median);
    expect(cold.samples.filter((ms) => ms <= cold.median).length).toBeGreaterThanOrEqual(3);
    expect(cold.samples.filter((ms) => ms >= cold.median).length).toBeGreaterThanOrEqual(3);
    // 每次執行都必須真的印出版本。失敗的 spawn 快得很，會讓這個閘門變成
    // 「壞掉就一定過」。
    expect(cold.median).toBeGreaterThan(0);

    console.log(
      `cold start median ${cold.median.toFixed(1)}ms / 上限 ${cold.limit}ms，` +
        `樣本 ${cold.samples.map((ms) => ms.toFixed(1)).join(' ')}`,
    );
    expect(cold.median).toBeLessThan(cold.limit);
  }, 60_000);

  it('npm run bench 一次列出四個硬指標的當前數值，全部達標時 exit 0', () => {
    const bench = spawnSync('npm', ['run', '--silent', 'bench'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const out = `${bench.stdout}${bench.stderr}`;

    expect(bench.status, out).toBe(0);

    // spec.md「四個硬指標」那一節，一個都不能少 —— 少一個就等於少一個閘門。
    const size = /^package size +(\d+) B +3145728 B/m.exec(out);
    const cold = /^cold start +([\d.]+) ms +500 ms/m.exec(out);
    const merge = /^concurrent merge +(\d+) conflicts +0 conflicts/m.exec(out);
    const token = /^agent token +(\d+) B +4608 B/m.exec(out);
    expect(
      { size: size !== null, cold: cold !== null, merge: merge !== null, token: token !== null },
      out,
    ).toEqual({ size: true, cold: true, merge: true, token: true });

    // bench 量的必須是使用者拿到的那一份：同一份原始碼打出來的 byte 數是
    // 決定性的，所以這裡可以要求逐 byte 相等。
    expect(Number(size?.[1])).toBe(measurePackageSize(packed.root).bytes);
    expect(Number(cold?.[1])).toBeLessThan(COLD_START_LIMIT_MS);
    expect(Number(merge?.[1])).toBe(0);
    expect(Number(token?.[1])).toBeLessThan(4608);

    console.log(out.trim());
  }, 300_000);
});
