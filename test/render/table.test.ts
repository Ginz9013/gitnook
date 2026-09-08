import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTable } from '../../src/render/table.js';
import { renderJson } from '../../src/render/json.js';
import { resolvePrefix, SHORT_ID_MIN } from '../../src/core/ids.js';
import type { Issue } from '../../src/core/types.js';

const golden = (name: string): string =>
  readFileSync(join(import.meta.dirname, '__golden__', name), 'utf8');

/** golden 檔以換行結尾；渲染函式不自帶結尾換行，由呼叫端負責。 */
const asFile = (rendered: string): string => rendered + '\n';

const issue = (over: Partial<Issue> & Pick<Issue, 'id' | 'title'>): Issue => ({
  status: 'backlog',
  description: '',
  labels: [],
  archived: false,
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
    expect(renderTable([])).toBe('沒有 issue');
  });
});

describe('renderTable — 詳情', () => {
  it('單張 Issue 的詳情含未截斷的 title、description，與依 t 排序的 comments 時間軸', () => {
    const detail = issue({
      id: '01JBX7A9Q3',
      title: 'Fix the login redirect loop that only reproduces on Safari 17',
      status: 'blocked',
      labels: ['bug', 'p1'],
      description: '登入後被導回 /login，只在 Safari 17 重現。\nChrome 與 Firefox 正常。',
      // 刻意逆序傳入，時間軸應依 t 遞增排列。
      comments: [
        { id: '01JBX8D7T4', actor: 'm8q2', t: 5, body: '等 Safari 17.4 的修正' },
        { id: '01JBX7C5R1', actor: 'k3f9', t: 3, body: 'safari 才會重現' },
      ],
    });

    expect(asFile(renderTable(detail))).toBe(golden('table-detail.txt'));
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
        description: '',
        id: '01JBX7A9Q3',
      },
      {
        comments: [{ t: 3, body: 'safari 才會重現', actor: 'k3f9', id: '01JBX7C5R1' }],
        archived: true,
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
 * 詳情視圖只拿得到一張 Issue，無從得知整批的情況。決定：一律顯示
 * SHORT_ID_MIN 碼。理由寫在 src/render/table.ts 的 renderDetail 上。
 */
describe('renderTable — 詳情視圖的短 ID 長度', () => {
  it('顯示 SHORT_ID_MIN 碼，不因識別碼長而顯示全長', () => {
    const detail = renderTable(issue({ id: '01JBX7AAAAAAAAAAAAAAAAAAAA', title: 'a' }));

    expect(detail.split('  ')[0]).toBe('01JBX7');
    expect(detail.split('  ')[0]).toHaveLength(SHORT_ID_MIN);
  });
});
