import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardNotInitialized, initBoard, openBoard } from '../../src/index.js';

// ADR-0004：打真實檔案系統與真實 git，不使用 in-memory fake。
// 每個測試用例一棵獨立的 mkdtemp 樹，各自搭出自己的目錄拓撲。
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nook-root-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 在暫存樹底下造一層深目錄並回傳它。 */
const under = (...parts: string[]): string => {
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('由子目錄向上尋根', () => {
  it('深層子目錄的 create / get / list 都作用在根目錄那一塊 board', () => {
    initBoard(root);
    const deep = under('src', 'deep', 'nested');
    const atRoot = openBoard({ dir: root, actor: 'test' });
    const created = atRoot.create({ title: 'Fix login redirect' });

    const fromDeep = openBoard({ dir: deep, actor: 'test' });

    expect(fromDeep.get(created.id).title).toBe('Fix login redirect');

    const added = fromDeep.create({ title: 'Add dark mode' });
    // 子目錄的寫入必須落在同一塊 board。靜默切出第二塊時兩邊各自累積
    // Issue，而且沒有任何東西會提示 —— 這是資料完整性問題。
    expect(existsSync(join(deep, '.gitnook'))).toBe(false);
    expect(atRoot.list().map((i) => i.id).sort()).toEqual([created.id, added.id].sort());
    // 「完全相同」：同一塊 board 在兩處讀出的結果不該有任何差異。
    expect(fromDeep.list()).toEqual(atRoot.list());
  });
});

/**
 * 寫完即綠的 guard：上一個切片的實作（第一個命中就停）已經滿足它。
 * 用變異證明它非空 —— 把尋根改成「一路走到最外層那一塊」時本測試必須紅。
 */
describe('取最近的一塊 board', () => {
  it('巢狀 board 存在時不越過它去用外層那一塊', () => {
    initBoard(root);
    // 巢狀 board 只能繞過 initBoard 造出來（它現在會拒絕），但在這次修正
    // 之前建立的樹裡真的有，尋根必須對它給出可預期的答案。
    const inner = under('src');
    mkdirSync(join(inner, '.gitnook', 'issues'), { recursive: true });
    const deep = under('src', 'deep');
    openBoard({ dir: root, actor: 'test' }).create({ title: 'Fix login redirect' });

    const board = openBoard({ dir: deep, actor: 'test' });
    const own = board.create({ title: 'Add dark mode' });

    expect(board.list().map((i) => i.title)).toEqual(['Add dark mode']);
    expect(readdirSync(join(inner, '.gitnook', 'issues'))).toEqual([`${own.id}.ndjson`]);
  });
});

describe('尋根的停止條件', () => {
  it('停在 git repo 的根目錄 —— repo 外的那一塊 board 不會被誤用', () => {
    // 外層有一塊 board，內層是一個獨立的 repo（vendored / submodule 的形狀）。
    initBoard(root);
    const repo = under('vendor', 'widget');
    execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });
    const inside = under('vendor', 'widget', 'src');

    // 越過 repo 根去命中上層那一塊，等於把 Issue 寫進另一個 repo 的資料 ——
    // 與「board 被無聲切成兩塊」是同一個資料完整性失敗的鏡像。
    expect(() => openBoard({ dir: inside, actor: 'test' }).list()).toThrow(BoardNotInitialized);
  });
});

describe('找不到 board 時的錯誤訊息', () => {
  it('說出搜尋過的範圍，而不只是「先執行 nook init」', () => {
    // repo 根沒有 board，也就是尋根的終點。
    const repo = under('repo');
    execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });
    const deep = under('repo', 'src', 'deep');

    let thrown: Error | undefined;
    try {
      openBoard({ dir: deep, actor: 'test' }).list();
    } catch (e) {
      thrown = e as Error;
    }

    // 只說「先執行 nook init」會把在子目錄的使用者導向一個把 board 切成
    // 兩塊的破壞性操作 —— 訊息必須交代從哪裡找到哪裡。
    expect(thrown).toBeInstanceOf(BoardNotInitialized);
    expect(thrown?.message).toContain(deep);
    expect(thrown?.message).toContain(`up to ${repo}`);
    expect(thrown?.message).toContain('.gitnook/issues');
    // 沒有舊版 marker 時不附加任何 git mv —— 這是「真的沒有 board」的正常情境。
    expect(thrown?.message).not.toContain('git mv');
  });
});

/**
 * 票 03：找不到 `.gitnook/` 但沿路找到舊版佈局 marker 時，`BoardNotInitialized`
 * 的訊息附上可直接複製貼上執行的 `git mv` 指令 —— 不自動搬移（nook 不執行任何
 * 會寫入的 git 指令，既有原則），只是把指令組出來給使用者看。
 */
describe('找不到 board 但找到舊版佈局時的錯誤訊息', () => {
  it('只有舊版 .issues/issues/：附上對應的 git mv 指令，路徑相對於實際找到 marker 的目錄', () => {
    const repo = under('repo');
    execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });
    mkdirSync(join(repo, '.issues', 'issues'), { recursive: true });

    let thrown: Error | undefined;
    try {
      openBoard({ dir: repo, actor: 'test' }).list();
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeInstanceOf(BoardNotInitialized);
    expect(thrown?.message).toContain(
      `git mv "${join(repo, '.issues', 'issues')}" "${join(repo, '.gitnook', 'issues')}"`,
    );
    // 只有 issues 的舊版本來就只用過 issue：不能憑空造一條 decisions 的指令。
    expect(thrown?.message).not.toContain('.decisions');
  });

  it('同時有舊版 .issues/issues/ 與 .decisions/decisions/：兩條 git mv 指令都看得到', () => {
    const repo = under('repo2');
    execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });
    mkdirSync(join(repo, '.issues', 'issues'), { recursive: true });
    mkdirSync(join(repo, '.decisions', 'decisions'), { recursive: true });

    let thrown: Error | undefined;
    try {
      openBoard({ dir: repo, actor: 'test' }).list();
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown?.message).toContain(
      `git mv "${join(repo, '.issues', 'issues')}" "${join(repo, '.gitnook', 'issues')}"`,
    );
    expect(thrown?.message).toContain(
      `git mv "${join(repo, '.decisions', 'decisions')}" "${join(repo, '.gitnook', 'decisions')}"`,
    );
  });
});

/**
 * 命名取自 CONTEXT.md 的 Ref 詞條（「指向一張 Issue 的字串」，_Avoid_: id、
 * key、slug）。這裡回傳的是每張 Issue 的**完整** Ref。
 */
describe('Board.refs()', () => {
  it('回傳全部 Issue 的完整 Ref', () => {
    initBoard(root);
    const board = openBoard({ dir: root, actor: 'test' });
    const a = board.create({ title: 'Fix login redirect' });
    const b = board.create({ title: 'Add dark mode' });

    expect(board.refs()).toEqual([a.id, b.id].sort());
  });

  it('未初始化的目錄拋 BoardNotInitialized，而非檔案系統的 ENOENT', () => {
    expect(() => openBoard({ dir: under('bare'), actor: 'test' }).refs()).toThrow(
      BoardNotInitialized,
    );
  });
});

/**
 * 寫完即綠的 guard：行為由上一個切片交付，這裡把它釘住。探針是一個讀不得的
 * op-log（票 13 的做法）—— 量的是「有沒有真的去讀檔案內容」這個外部可觀察的
 * 事實，不 mock 任何內部協作者。同一支探針在 list() 底下必須開火，否則這個
 * 測試就是空的。
 */
describe('refs() 只做目錄列舉', () => {
  it('取得全部 Ref 不會讀取任何 .ndjson 的內容', () => {
    initBoard(root);
    const board = openBoard({ dir: root, actor: 'test' });
    const readable = board.create({ title: 'Fix login redirect' });
    // 與 op-log 同名的**目錄**：readFileSync 會 EISDIR，只列目錄則碰都不會碰到。
    const unreadable = '01SEED00000000000000000009';
    mkdirSync(join(root, '.gitnook', 'issues', `${unreadable}.ndjson`));

    expect(board.refs()).toEqual([readable.id, unreadable].sort());
    // 探針必須是活的：會摺疊 Op-log 的 list() 一定要在這裡炸開。
    expect(() => board.list()).toThrow();
  });
});

describe('board 目錄在 Board 建立之後消失', () => {
  it('仍然說「不是一個 Nook board」，而非檔案系統的 ENOENT', () => {
    initBoard(root);
    const board = openBoard({ dir: root, actor: 'test' });
    board.create({ title: 'Fix login redirect' });

    // 尋根的結果被快取（否則 list 的成本會乘上目錄深度），但快取不該把一個
    // 使用者修得好的錯誤變成看起來像 nook 的 bug 的內部錯誤。
    rmSync(join(root, '.gitnook'), { recursive: true });

    expect(() => board.list()).toThrow(BoardNotInitialized);
  });
});

/**
 * `Board.root()` —— 這塊 board 在磁碟上的位置。
 *
 * 值本來就已經算好並 memoise 在 board.ts 的 rootDir() 裡；把它交出來是為了
 * 讓「board 在哪裡」只有一個真相來源。在此之前唯一問得到路徑的方式是呼叫端
 * 自己再尋一次根，而它與 openBoard() 拿到的那個目錄可以不一樣（票 B8）。
 */
describe('Board.root()', () => {
  it('回傳這塊 board 的絕對路徑', () => {
    initBoard(root);

    expect(openBoard({ dir: root, actor: 'test' }).root()).toBe(root);
  });
});

/**
 * 尋根向上找，所以從子目錄開的 board 的根**不是**呼叫端傳進去的那個目錄 ——
 * 這是 `root()` 與 `OpenBoardOptions.dir` 唯一會不同的地方，也是這張票存在的
 * 理由：呼叫端拿 `dir` 當「board 在哪裡」用時，只有剛好從根目錄開才會對。
 */
describe('Board.root() 從子目錄開', () => {
  it('回的是含 .gitnook/ 的那一層，不是 openBoard 收到的子目錄', () => {
    initBoard(root);
    const deep = under('src', 'deep', 'nested');

    const board = openBoard({ dir: deep, actor: 'test' });

    expect(board.root()).toBe(root);
    expect(board.root()).not.toBe(deep);
  });
});

describe('Board.root() 在 board 目錄消失之後', () => {
  it('拋 BoardNotInitialized，而不是回一個過期的路徑', () => {
    initBoard(root);
    const board = openBoard({ dir: root, actor: 'test' });
    // 先讓尋根的結果被 memoise —— 沒有快取的話這個測試證明不到東西。
    board.create({ title: 'Fix login redirect' });

    rmSync(join(root, '.gitnook'), { recursive: true });

    // 一個仍然指著已經不是 board 的目錄的路徑，會被 header 原樣畫出來，
    // 而使用者接著在那裡下的每一個判斷都是錯的。
    expect(() => board.root()).toThrow(BoardNotInitialized);
  });
});
