import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderTable,
  renderWorkspaceList,
  renderDecisionTable,
  renderDecisionDetail,
  renderDecisionSetOps,
} from '../../src/render/table.js';
import { renderJson } from '../../src/render/json.js';
import { displayWidth } from '../../src/render/width.js';
import { resolvePrefix, SHORT_ID_MIN } from '../../src/core/ids.js';
import type { Issue } from '../../src/core/types.js';
import type { Decision } from '../../src/core/decisionTypes.js';
import type { DecisionSetOp } from '../../src/core/decisionOps.js';
import type { WorkspaceGroup } from '../../src/render/table.js';

const golden = (name: string): string =>
  readFileSync(join(import.meta.dirname, '__golden__', name), 'utf8');

/** golden 檔以換行結尾；渲染函式不自帶結尾換行，由呼叫端負責。 */
const asFile = (rendered: string): string => rendered + '\n';

const issue = (over: Partial<Issue> & Pick<Issue, 'id' | 'title'>): Issue => ({
  status: 'backlog',
  description: '',
  labels: [],
  archived: false,
  deleted: false,
  comments: [],
  ...over,
});

describe('renderTable — 清單', () => {
  it('單張 Issue 的一行輸出與 ADR-0005 的量測範例逐位元組相同', () => {
    const issues = [
      issue({
        id: '01JBX7A9Q3',
        title: 'Fix login redirect',
        status: 'queued',
        labels: ['bug'],
      }),
    ];

    expect(asFile(renderTable(issues))).toBe(golden('table-list-single.txt'));
  });

  it('欄寬依內容自適應，各欄對齊，且無標籤時不留尾隨空白', () => {
    const issues = [
      issue({ id: '01JBX7A9Q3', title: 'Fix login redirect', status: 'queued', labels: ['bug'] }),
      issue({
        id: '01JBX8D7T4',
        title: 'Add dark mode',
        status: 'in_progress',
        labels: ['ui', 'p1'],
      }),
      issue({ id: '01JBX9F3M2', title: 'Rename ready to queued', status: 'backlog' }),
    ];

    expect(asFile(renderTable(issues))).toBe(golden('table-list.txt'));
  });

  it('title 超過 48 字元時截斷為 47 字元加省略號，且不破壞欄位對齊', () => {
    const issues = [
      issue({
        id: '01JBX7A9Q3',
        title: 'Fix the login redirect loop that only reproduces on Safari 17',
        status: 'queued',
        labels: ['bug'],
      }),
      issue({ id: '01JBX8D7T4', title: 'Add dark mode', status: 'review', labels: ['ui'] }),
    ];

    expect(asFile(renderTable(issues))).toBe(golden('table-list-truncated.txt'));
  });

  it('空清單輸出簡短訊息，而不是一個空的表頭', () => {
    // 訊息用語沿用 src/core/types.ts 既有的中文錯誤訊息風格。
    expect(renderTable([])).toBe('no issues');
  });
});

describe('renderTable — 詳情', () => {
  it('單張 Issue 的詳情含未截斷的 title、description，與 comments 時間軸', () => {
    const detail = issue({
      id: '01JBX7A9Q3',
      title: 'Fix the login redirect loop that only reproduces on Safari 17',
      status: 'blocked',
      labels: ['bug', 'p1'],
      description: '登入後被導回 /login，只在 Safari 17 重現。\nChrome 與 Firefox 正常。',
      // 以 reduce() 的 (t, a, id) 全序傳入 —— 渲染層原樣輸出，不重排。
      comments: [
        { id: '01JBX7C5R1', actor: 'k3f9', t: 3, body: 'safari 才會重現' },
        { id: '01JBX8D7T4', actor: 'm8q2', t: 5, body: '等 Safari 17.4 的修正' },
      ],
    });

    expect(asFile(renderTable(detail))).toBe(golden('table-detail.txt'));
  });

  it('依 core 給定的順序渲染 comments，不自行重排 —— 排序是 core 的責任', () => {
    // Issue.comments 由 reduce() 以 (t, a, id) 全序產出。渲染層若複製一份比較器，
    // 兩者就會分歧：先前這裡用的是 (t)，在 t 相同而 actor 不同時會排出與 GUI
    // 不一致的順序。html.ts 已於 commit 463343d 移除同一個 bug，這裡是原地復發。
    const detail = issue({
      id: '01JBX7A9Q3',
      title: 'Fix login redirect',
      comments: [
        { id: '01JBX8D7T4', actor: 'm8q2', t: 5, body: '等 Safari 17.4 的修正' },
        { id: '01JBX7C5R1', actor: 'k3f9', t: 3, body: 'safari 才會重現' },
      ],
    });

    expect(renderTable(detail).split('\n').slice(-2)).toEqual([
      '- m8q2  等 Safari 17.4 的修正',
      '- k3f9  safari 才會重現',
    ]);
  });

  it('沒有 description 與 comments 時只輸出標題行，不留空白區塊', () => {
    const detail = issue({ id: '01JBX9F3M2', title: 'Rename ready to queued', status: 'todo' });

    expect(asFile(renderTable(detail))).toBe(golden('table-detail-bare.txt'));
  });
});

describe('renderJson', () => {
  it('鍵一律依字母排序，輸出不隨物件的屬性建立順序改變', () => {
    const viaHelper = [
      issue({ id: '01JBX7A9Q3', title: 'Fix login redirect', status: 'queued', labels: ['bug'] }),
      issue({
        id: '01JBX8D7T4',
        title: 'Add dark mode',
        status: 'review',
        description: 'dark theme',
        archived: true,
        comments: [{ id: '01JBX7C5R1', actor: 'k3f9', t: 3, body: 'safari 才會重現' }],
      }),
    ];
    // 同樣的資料，屬性建立順序刻意打亂。
    const scrambled: Issue[] = [
      {
        labels: ['bug'],
        status: 'queued',
        comments: [],
        title: 'Fix login redirect',
        archived: false,
        deleted: false,
        description: '',
        id: '01JBX7A9Q3',
      },
      {
        comments: [{ t: 3, body: 'safari 才會重現', actor: 'k3f9', id: '01JBX7C5R1' }],
        archived: true,
        deleted: false,
        title: 'Add dark mode',
        id: '01JBX8D7T4',
        description: 'dark theme',
        labels: [],
        status: 'review',
      },
    ];

    expect(asFile(renderJson(viaHelper))).toBe(golden('json-list.json'));
    expect(renderJson(scrambled)).toBe(renderJson(viaHelper));
  });

  it('單張 Issue 輸出 JSON 物件而非只有一個元素的陣列', () => {
    const one = issue({
      id: '01JBX8D7T4',
      title: 'Add dark mode',
      status: 'review',
      description: 'dark theme',
      archived: true,
      comments: [{ id: '01JBX7C5R1', actor: 'k3f9', t: 3, body: 'safari 才會重現' }],
    });

    expect(asFile(renderJson(one))).toBe(golden('json-detail.json'));
  });
});

/**
 * 短 ID 的長度是「這批 Issue 彼此無歧義所需的長度」，不是寫死的 6。
 * Ref 的定義見 CONTEXT.md：完整識別碼或任何無歧義前綴。
 */
describe('renderTable — 短 ID 的碰撞', () => {
  /** 表格第一欄。欄以兩個空白分隔，短 ID 本身不含空白。 */
  const shortIds = (rendered: string): string[] =>
    rendered.split('\n').map((line) => line.split('  ')[0]!);

  it('兩張前綴相同的 Issue 顯示為彼此不同、且足以解析回各自 Issue 的短 ID', () => {
    const ids = ['01JBX7AAAAAAAAAAAAAAAAAAAA', '01JBX7BBBBBBBBBBBBBBBBBBBB'];
    const issues = ids.map((id, i) => issue({ id, title: `Issue ${i}`, status: 'queued' }));

    const cells = shortIds(renderTable(issues));

    // 6 碼時兩者都是 01JBX7；分開它們最短需要 7 碼。
    expect(cells).toEqual(['01JBX7A', '01JBX7B']);
    // 顯示出來的短 ID 必須真的能當 Ref 用 —— board.get() 走的就是 resolvePrefix。
    expect(cells.map((c) => resolvePrefix(c, ids))).toEqual(ids);
  });

  it('碰撞只發生在更深處時，長度只加到剛好足夠', () => {
    const ids = ['01JBX7A9Q3ZAAAAAAAAAAAAAAA', '01JBX7A9Q3ZBBBBBBBBBBBBBBB'];
    const issues = ids.map((id, i) => issue({ id, title: `Issue ${i}`, status: 'queued' }));

    // 前 11 碼相同，第 12 碼才分岔。
    expect(shortIds(renderTable(issues))).toEqual(['01JBX7A9Q3ZA', '01JBX7A9Q3ZB']);
  });

  it('沒有碰撞時長度仍為 6', () => {
    const issues = [
      issue({ id: '01JBXAAAAAAAAAAAAAAAAAAAAA', title: 'a', status: 'queued' }),
      issue({ id: '01JBXBBBBBBBBBBBBBBBBBBBBB', title: 'b', status: 'queued' }),
    ];

    expect(shortIds(renderTable(issues))).toEqual(['01JBXA', '01JBXB']);
  });
});

/**
 * 長度是「整批的性質」，單張 Issue 看不出來 —— 所以呼叫端算得出更好的答案時，
 * 必須有辦法把它交進來。回印單張的 CLI 路徑（set/mv/comment/label）拿到的是
 * 一個單元素陣列，靠 renderTable 自己算永遠只會得到下限 6。
 */
describe('renderTable — 呼叫端指定的短 ID 長度', () => {
  it('清單依呼叫端給的長度顯示，而不是只對手上這幾張算', () => {
    const issues = [issue({ id: '01JBXAAAAAAAAAAAAAAAAAAAAA', title: 'a', status: 'queued' })];

    expect(renderTable(issues, 13).split('  ')[0]).toBe('01JBXAAAAAAAA');
  });

  it('詳情依呼叫端給的長度顯示 —— show 也要對當下整個 Board 重算', () => {
    const detail = issue({ id: '01JBX7AAAAAAAAAAAAAAAAAAAA', title: 'a' });

    expect(renderTable(detail, 13).split('  ')[0]).toBe('01JBX7AAAAAAA');
  });
});

/**
 * 詳情視圖只拿得到一張 Issue，無從得知整批的情況。決定：呼叫端沒給長度時
 * 一律顯示 SHORT_ID_MIN 碼。理由寫在 src/render/table.ts 的 renderDetail 上。
 */
describe('renderTable — 詳情視圖的短 ID 長度', () => {
  it('顯示 SHORT_ID_MIN 碼，不因識別碼長而顯示全長', () => {
    const detail = renderTable(issue({ id: '01JBX7AAAAAAAAAAAAAAAAAAAA', title: 'a' }));

    expect(detail.split('  ')[0]).toBe('01JBX7');
    expect(detail.split('  ')[0]).toHaveLength(SHORT_ID_MIN);
  });
});

describe('renderTable — CJK 的顯示欄寬', () => {
  /** 一行之中，labels 欄開始之前的顯示欄寬。對齊與否就看這個值齊不齊。 */
  const widthBeforeLabels = (line: string): number =>
    displayWidth(line.slice(0, line.lastIndexOf('[')));

  it('CJK 標題不會讓 labels 欄跑掉', () => {
    // dogfood 第一天實際撞到的兩行：字元數相同，顯示欄寬差 13。
    const issues = [
      issue({
        id: '01M21Z3RY7',
        title: '用 nook 自己管 nook 的開發（dogfood）',
        labels: ['dogfood'],
      }),
      issue({
        id: '01M21Z436T',
        title: 'nook init 沒有任何輸出，也分不出「剛建立」和「已存在」',
        labels: ['dogfood', 'ux'],
      }),
      issue({ id: '01M21Z5B9R', title: 'Fix login redirect', labels: ['bug'] }),
    ];

    const lines = renderTable(issues).split('\n');
    const starts = lines.map(widthBeforeLabels);
    expect(new Set(starts).size).toBe(1);
  });

  it('CJK 清單的 golden —— __golden__ 其餘檔案全是 ASCII，對齊迴歸靠這一份守住', () => {
    const issues = [
      issue({
        id: '01M21Z3RY7',
        title: '用 nook 自己管 nook 的開發（dogfood）',
        labels: ['dogfood'],
      }),
      issue({
        id: '01M21Z436T',
        title: 'nook init 沒有任何輸出，也分不出「剛建立」和「已存在」',
        status: 'in_progress',
        labels: ['dogfood', 'ux'],
      }),
      issue({ id: '01M21Z5B9R', title: 'Fix login redirect', status: 'queued', labels: ['bug'] }),
    ];

    expect(asFile(renderTable(issues))).toBe(golden('table-list-cjk.txt'));
  });

  it('title 的截斷以顯示欄寬計，不以字元數計', () => {
    // 30 個全形字 = 60 欄，遠超過 TITLE_MAX 的 48 欄，但只有 30 個字元。
    const issues = [issue({ id: '01JBX7A9Q3', title: '中'.repeat(30), labels: ['x'] })];
    const titleCell = renderTable(issues).split('  ')[2]!;

    expect(displayWidth(titleCell)).toBeLessThanOrEqual(48);
    // 截斷後仍要留下省略號，讀者才知道被截了。
    expect(titleCell.endsWith('…')).toBe(true);
  });

  it('全形字不會因為半個字元被切開而產生亂碼', () => {
    // 奇數欄寬的邊界：截到第 47 欄時下一個全形字放不下，必須整個不放。
    const issues = [issue({ id: '01JBX7A9Q3', title: 'a' + '中'.repeat(30), labels: ['x'] })];
    const titleCell = renderTable(issues).split('  ')[2]!;

    expect(displayWidth(titleCell)).toBeLessThanOrEqual(48);
    expect([...titleCell].every((c) => c === 'a' || c === '中' || c === '…')).toBe(true);
  });
});

/**
 * `renderWorkspaceList` 依來源路徑分組印出，組合既有 `renderTable`，不重新
 * 發明表格版面（票 02 spec.md「Design contract」）。
 */
/**
 * 票 02：Decision 的清單緊湊表格（ref/title/disposition），沿用 Issue 既有的
 * 短 ID 無歧義前綴顯示規則（shortIdLength 由呼叫端算好傳入），不重寫比較器。
 */
describe('renderDecisionTable', () => {
  const decision = (over: Partial<Decision> & Pick<Decision, 'id' | 'title'>): Decision => ({
    body: '',
    disposition: 'proposed',
    ...over,
  });

  it('空清單輸出簡短訊息，而不是一個空的表頭', () => {
    expect(renderDecisionTable([])).toBe('no decisions');
  });

  it('印出 ref/title/disposition 三欄，欄寬對齊', () => {
    const decisions = [
      decision({ id: '01AAAAAAAAAAAAAAAAAAAAAAAA', title: 'Use ULIDs', disposition: 'accepted' }),
      decision({ id: '01BBBBBBBBBBBBBBBBBBBBBBBB', title: 'Adopt oplog', disposition: 'proposed' }),
    ];

    expect(renderDecisionTable(decisions)).toBe(
      ['01AAAA  Use ULIDs    accepted', '01BBBB  Adopt oplog  proposed'].join('\n'),
    );
  });

  it('沒給長度時依這批 Decision 算出彼此無歧義所需的短 ID 長度', () => {
    const ids = ['01JBX7AAAAAAAAAAAAAAAAAAAA', '01JBX7BBBBBBBBBBBBBBBBBBBB'];
    const decisions = ids.map((id, i) => decision({ id, title: `D${i}` }));

    const shortIds = renderDecisionTable(decisions)
      .split('\n')
      .map((line) => line.split('  ')[0]);
    expect(shortIds).toEqual(['01JBX7A', '01JBX7B']);
  });

  it('依呼叫端給定的短 ID 長度顯示，而不是只對手上這幾筆算', () => {
    const decisions = [decision({ id: '01JBXAAAAAAAAAAAAAAAAAAAAA', title: 'a' })];

    expect(renderDecisionTable(decisions, 13).split('  ')[0]).toBe('01JBXAAAAAAAA');
  });

  it('title 超過顯示欄上限時截斷為省略號，不破壞欄位對齊', () => {
    const decisions = [
      decision({ id: '01AAAAAAAAAAAAAAAAAAAAAAAA', title: 'x'.repeat(60), disposition: 'accepted' }),
      decision({ id: '01BBBBBBBBBBBBBBBBBBBBBBBB', title: 'short', disposition: 'proposed' }),
    ];

    const titleCell = renderDecisionTable(decisions).split('\n')[0]!.split('  ')[1]!;
    expect(titleCell.endsWith('…')).toBe(true);
    expect(displayWidth(titleCell)).toBeLessThanOrEqual(48);
  });
});

/**
 * 票 08：單張 Decision 的 detail 版面，比照 Issue 既有 renderDetail 的節奏 ——
 * header 一行（shortId／disposition／title），空的區塊整個略去，不是逐欄
 * key:value 傾印（見票 08 spec.md）。
 */
describe('renderDecisionDetail', () => {
  const decision = (over: Partial<Decision> & Pick<Decision, 'id' | 'title'>): Decision => ({
    body: '',
    disposition: 'proposed',
    ...over,
  });

  it('header 一行是 shortId／disposition／title，body 另起一段', () => {
    const d = decision({
      id: '01AAAAAAAAAAAAAAAAAAAAAAAA',
      title: 'Use ULIDs',
      disposition: 'accepted',
      body: 'because sortable',
    });

    expect(renderDecisionDetail(d)).toBe(
      ['01AAAA  accepted  Use ULIDs', 'because sortable'].join('\n\n'),
    );
  });

  it('body 為空時整個略去該區塊', () => {
    const d = decision({ id: '01AAAAAAAAAAAAAAAAAAAAAAAA', title: 'X', disposition: 'proposed' });

    expect(renderDecisionDetail(d)).toBe('01AAAA  proposed  X');
  });

  it('supersededBy 只在有值時印出', () => {
    const d = decision({
      id: '01AAAAAAAAAAAAAAAAAAAAAAAA',
      title: 'X',
      supersededBy: '01BBBBBBBBBBBBBBBBBBBBBBBB',
    });

    expect(renderDecisionDetail(d)).toBe(
      ['01AAAA  proposed  X', 'supersededBy: 01BBBBBBBBBBBBBBBBBBBBBBBB'].join('\n\n'),
    );
  });

  it('body 不截斷 —— 讀者為了看完整內容才點進來', () => {
    const long = 'x'.repeat(200);
    const d = decision({ id: '01AAAAAAAAAAAAAAAAAAAAAAAA', title: 'X', body: long });

    expect(renderDecisionDetail(d)).toContain(long);
  });

  it('沒給長度時對單張 Decision 算出 SHORT_ID_MIN 碼', () => {
    const d = decision({ id: '01JBXAAAAAAAAAAAAAAAAAAAAA', title: 'X' });

    expect(renderDecisionDetail(d).split('  ')[0]).toBe('01JBXA');
  });

  it('依呼叫端給定的短 ID 長度顯示，而不是只對單張自己算', () => {
    const d = decision({ id: '01JBXAAAAAAAAAAAAAAAAAAAAA', title: 'X' });

    expect(renderDecisionDetail(d, 13).split('  ')[0]).toBe('01JBXAAAAAAAA');
  });
});

/**
 * 票 04：Decision 的 Op-log 中的 set op —— 誰、在哪個 lamport `t`、把哪個欄位
 * 寫成什麼。同 Issue 既有的 `renderSetOps`（不重用它、不重寫排序，見
 * spec.md「排序沿用 oplog.ts 的 orderOps，不在 CLI 或渲染層另寫一份比較器」）：
 * 傳進來的順序就是呼叫端已經排好的全序，這裡只負責版面。
 */
describe('renderDecisionSetOps', () => {
  const setOp = (t: number, a: string, k: DecisionSetOp['k'], v: string): DecisionSetOp => ({
    id: `01${t}${a}`,
    t,
    a,
    op: 'set',
    k,
    v,
  });

  it('空清單印出簡短訊息，而不是空表頭', () => {
    expect(renderDecisionSetOps([])).toBe('no set ops');
  });

  it('列出 t／actor／欄位／值四欄，欄寬對齊', () => {
    const ops = [
      setOp(1, 'alice', 'title', 'Use ULIDs'),
      setOp(2, 'bob', 'disposition', 'accepted'),
    ];

    expect(renderDecisionSetOps(ops)).toBe(
      ['1  alice  title        Use ULIDs', '2  bob    disposition  accepted'].join('\n'),
    );
  });

  it('值含換行時整份改成表頭一行、值另起一段', () => {
    const ops = [
      setOp(1, 'alice', 'body', 'line one\nline two'),
      setOp(2, 'bob', 'title', 'X'),
    ];

    expect(renderDecisionSetOps(ops)).toBe(
      ['1  alice  body', 'line one\nline two', '', '2  bob    title', 'X'].join('\n'),
    );
  });
});

describe('renderWorkspaceList', () => {
  const group = (path: string, issues: readonly Issue[]): WorkspaceGroup => ({
    path,
    issues,
    shortIdLen: SHORT_ID_MIN,
  });

  it('每組印一行路徑標頭 + renderTable 的內容，組間空一行', () => {
    const a = issue({ id: '01JBX7AAAAAAAAAAAAAAAAAAAA', title: 'a', status: 'queued' });
    const b = issue({ id: '01JBX8BBBBBBBBBBBBBBBBBBBB', title: 'b', status: 'todo' });

    const rendered = renderWorkspaceList([group('pkgs/a', [a]), group('pkgs/b', [b])]);

    expect(rendered).toBe(
      ['pkgs/a', renderTable([a], SHORT_ID_MIN), '', 'pkgs/b', renderTable([b], SHORT_ID_MIN)].join(
        '\n',
      ),
    );
  });

  it('篩選後一張都沒有的成員，整組不列出（不印空表頭）', () => {
    const a = issue({ id: '01JBX7AAAAAAAAAAAAAAAAAAAA', title: 'a', status: 'queued' });

    const rendered = renderWorkspaceList([group('pkgs/a', [a]), group('pkgs/empty', [])]);

    expect(rendered).not.toContain('pkgs/empty');
    expect(rendered).toBe(['pkgs/a', renderTable([a], SHORT_ID_MIN)].join('\n'));
  });

  it('全部成員篩選後都是空的，印一句彙整版的「沒有 issue」，不是逐組重複', () => {
    const rendered = renderWorkspaceList([group('pkgs/a', []), group('pkgs/b', [])]);

    expect(rendered).toBe('no issues');
  });

  it('沒有任何成員（空 workspace）時同樣印彙整版的「沒有 issue」', () => {
    expect(renderWorkspaceList([])).toBe('no issues');
  });
});
