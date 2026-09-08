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
    expect(existsSync(join(deep, '.issues'))).toBe(false);
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
    mkdirSync(join(inner, '.issues', 'issues'), { recursive: true });
    const deep = under('src', 'deep');
    openBoard({ dir: root, actor: 'test' }).create({ title: 'Fix login redirect' });

    const board = openBoard({ dir: deep, actor: 'test' });
    const own = board.create({ title: 'Add dark mode' });

    expect(board.list().map((i) => i.title)).toEqual(['Add dark mode']);
    expect(readdirSync(join(inner, '.issues', 'issues'))).toEqual([`${own.id}.ndjson`]);
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
    expect(thrown?.message).toContain(`至 ${repo}`);
    expect(thrown?.message).toContain('.issues/issues');
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
    mkdirSync(join(root, '.issues', 'issues', `${unreadable}.ndjson`));

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
    rmSync(join(root, '.issues'), { recursive: true });

    expect(() => board.list()).toThrow(BoardNotInitialized);
  });
});
