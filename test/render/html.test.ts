import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderBoardHtml, renderIssueHtml } from '../../src/render/html.js';
import type { Issue } from '../../src/core/types.js';

function issue(over: Partial<Issue> & { id: string }): Issue {
  return {
    title: 'untitled',
    status: 'backlog',
    description: '',
    labels: [],
    archived: false,
    comments: [],
    ...over,
  };
}

/** 取出某一欄的內層 HTML。 */
function column(html: string, status: string): string {
  const m = new RegExp(
    `<section class="col" data-status="${status}"[^>]*>([\\s\\S]*?)</section>`,
  ).exec(html);
  if (m === null) throw new Error(`no column for ${status}`);
  return m[1]!;
}

/** 依文件順序取出所有 column 的 data-status 值。 */
function columnStatuses(html: string): string[] {
  return [...html.matchAll(/<section class="col" data-status="([^"]*)"/g)].map((m) => m[1]!);
}

describe('renderBoardHtml', () => {
  it('八個固定 status 各一欄，順序固定（ADR-0003）', () => {
    const html = renderBoardHtml([]);

    expect(columnStatuses(html)).toEqual([
      'backlog',
      'todo',
      'queued',
      'in_progress',
      'review',
      'blocked',
      'done',
      'cancelled',
    ]);
  });

  it('卡片落在自己的 status 欄，顯示短 ID、title 與 labels', () => {
    const html = renderBoardHtml([
      issue({ id: '01JBX7A9Q3ZZZZZZZZZZZZZZZZ', title: 'Fix login redirect', status: 'queued', labels: ['bug', 'p1'] }),
    ]);

    const queued = column(html, 'queued');
    expect(queued).toContain('01JBX7');
    expect(queued).not.toContain('01JBX7A9Q3ZZZZZZZZZZZZZZZZ');
    expect(queued).toContain('Fix login redirect');
    expect(queued).toContain('bug');
    expect(queued).toContain('p1');
    expect(column(html, 'backlog')).not.toContain('Fix login redirect');
  });
});

describe('renderBoardHtml archived', () => {
  it('archived 的票預設不顯示（可見性與工作結果正交，ADR-0003）', () => {
    const html = renderBoardHtml([
      issue({ id: 'AAAAAA0001', title: 'still visible', status: 'done' }),
      issue({ id: 'BBBBBB0002', title: 'hidden away', status: 'done', archived: true }),
    ]);

    const done = column(html, 'done');
    expect(done).toContain('still visible');
    expect(done).not.toContain('hidden away');
    expect(done).not.toContain('BBBBBB');
  });
});

/** 從內嵌 CSS 讀出一個以 px 為單位的 custom property。 */
function cssPx(html: string, prop: string): number {
  const m = new RegExp(`${prop}:\\s*(\\d+)px`).exec(html);
  if (m === null) throw new Error(`no ${prop} in stylesheet`);
  return Number(m[1]);
}

describe('renderBoardHtml layout', () => {
  it('八欄在 1920px 下不需捲動即可完整顯示，每欄約 240px', () => {
    const html = renderBoardHtml([]);

    const col = cssPx(html, '--col-w');
    const gap = cssPx(html, '--col-gap');
    const pad = cssPx(html, '--board-pad');
    const total = 8 * col + 7 * gap + 2 * pad;

    // 1920px 減去約 24px 的捲軸／視窗邊界餘裕。
    expect(total).toBeLessThanOrEqual(1920 - 24);
    // 「約 240px」—— 不得為了塞下八欄而縮成看不清內容的窄欄。
    expect(col).toBeGreaterThanOrEqual(200);
  });

  it('筆電寬度才觸發橫向捲動：看板本身可橫向捲動且欄寬不壓縮', () => {
    const html = renderBoardHtml([]);

    expect(html).toMatch(/\.board\s*\{[^}]*overflow-x:\s*auto/);
    expect(html).toMatch(/\.col\s*\{[^}]*flex:\s*0 0 var\(--col-w\)/);
  });
});

describe('no external requests', () => {
  it('CSS 內嵌，頁面不發出任何外部請求', () => {
    const html = renderBoardHtml([
      issue({ id: 'AAAAAA0001', title: 'a', status: 'todo', labels: ['x'] }),
    ]);

    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/\bsrc=/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });
});

describe('escaping on the board', () => {
  it('惡意 title 與 label 不得注入標記（外部 repo pull 來的內容不可信）', () => {
    const html = renderBoardHtml([
      issue({
        id: 'AAAAAA0001',
        title: '<script>fetch("/i/x")</script>',
        status: 'todo',
        labels: ['<img src=x onerror=alert(1)>'],
      }),
    ]);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    // 真正的危險是「屬性位置」上的事件處理器，而不是文字裡出現這個字串。
    expect(html).not.toMatch(/<[^>]*\bonerror\b/i);
    // 內容仍然可讀，只是被逸出。
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('renderIssueHtml', () => {
  it('顯示 title、status 與 labels', () => {
    const html = renderIssueHtml(
      issue({
        id: '01JBX7A9Q3ZZZZZZZZZZZZZZZZ',
        title: 'Fix login redirect',
        status: 'blocked',
        labels: ['bug', 'p1'],
      }),
    );

    expect(html).toMatch(/<h1[^>]*>Fix login redirect<\/h1>/);
    expect(html).toMatch(/class="status"[^>]*>blocked</);
    expect(html).toContain('bug');
    expect(html).toContain('p1');
    expect(html).toContain('01JBX7');
  });
});

/** 取出詳情頁的 description 區塊。 */
function description(html: string): string {
  const m = /<div class="description">([\s\S]*?)<\/div>/.exec(html);
  if (m === null) throw new Error('no description block');
  return m[1]!;
}

describe('description markdown: raw HTML 關閉', () => {
  it('description 中的 <script> 被逸出為文字，不成為標記', () => {
    const html = renderIssueHtml(
      issue({
        id: 'AAAAAA0001',
        description: 'before\n\n<script>fetch("/i/secret")</script>\n\nafter',
      }),
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(description(html)).toContain('&lt;script&gt;');
    expect(description(html)).toContain('before');
    expect(description(html)).toContain('after');
  });

  it('description 中的 <img onerror=> 不成為 img 標籤', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: '<img src=x onerror="alert(1)">' }),
    );

    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<[^>]*\bonerror\b/i);
    expect(description(html)).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('raw HTML 一律不通過，含大小寫混寫與屬性上的事件處理器', () => {
    const html = renderIssueHtml(
      issue({
        id: 'AAAAAA0001',
        description: '<DIV onclick="steal()">x</DIV>\n<svg/onload=alert(1)>',
      }),
    );

    // 只看 description 區塊：頁面自身的結構標記本來就有 div。
    const d = description(html);
    expect(d).not.toMatch(/<div\b/i);
    expect(d).not.toMatch(/<svg\b/i);
    expect(d).not.toMatch(/<[^>]*\bonclick\b/i);
    expect(d).not.toMatch(/<[^>]*\bonload\b/i);
    expect(d).toContain('&lt;DIV onclick=&quot;steal()&quot;&gt;');
  });
});

describe('description markdown: 區塊語法', () => {
  it('heading 支援 # 到 ######', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: '# One\n\n### Three\n\n###### Six' }),
    );

    const d = description(html);
    expect(d).toContain('<h1>One</h1>');
    expect(d).toContain('<h3>Three</h3>');
    expect(d).toContain('<h6>Six</h6>');
  });

  it('七個 # 不是 heading，仍是段落文字', () => {
    const html = renderIssueHtml(issue({ id: 'AAAAAA0001', description: '####### Seven' }));

    const d = description(html);
    expect(d).not.toMatch(/<h[1-6]>/);
    expect(d).toContain('####### Seven');
  });
});

describe('description markdown: fenced code block', () => {
  it('圍籬程式碼區塊保留換行，內容逸出且不解析 markdown', () => {
    const html = renderIssueHtml(
      issue({
        id: 'AAAAAA0001',
        description: 'intro\n\n```js\nif (a < b) alert("**hi**");\n// # not a heading\n```\n\noutro',
      }),
    );

    const d = description(html);
    expect(d).toContain(
      '<pre><code>if (a &lt; b) alert(&quot;**hi**&quot;);\n// # not a heading\n</code></pre>',
    );
    expect(d).toContain('<p>intro</p>');
    expect(d).toContain('<p>outro</p>');
  });

  it('程式碼區塊內的 <script> 不逃出 pre', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: '```\n<script>alert(1)</script>\n```' }),
    );

    expect(html).not.toContain('<script>');
    expect(description(html)).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('description markdown: blockquote', () => {
  it('> 開頭的連續行成為一個 blockquote，內部仍走區塊解析', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: '> ## quoted heading\n> body line\n\nafter' }),
    );

    const d = description(html);
    expect(d).toContain('<blockquote><h2>quoted heading</h2><p>body line</p></blockquote>');
    expect(d).toContain('<p>after</p>');
  });

  it('巢狀 blockquote', () => {
    const html = renderIssueHtml(issue({ id: 'AAAAAA0001', description: '> outer\n> > inner' }));

    expect(description(html)).toContain(
      '<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>',
    );
  });
});

describe('description markdown: list', () => {
  it('無序清單', () => {
    const html = renderIssueHtml(issue({ id: 'AAAAAA0001', description: '- a\n- b' }));

    expect(description(html)).toContain('<ul><li>a</li><li>b</li></ul>');
  });

  it('有序清單', () => {
    const html = renderIssueHtml(issue({ id: 'AAAAAA0001', description: '1. a\n2. b' }));

    expect(description(html)).toContain('<ol><li>a</li><li>b</li></ol>');
  });

  it('巢狀清單靠縮排，子清單掛在父項目之內', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: '- a\n  - a1\n    - a2\n  - a3\n- b' }),
    );

    expect(description(html)).toContain(
      '<ul><li>a<ul><li>a1<ul><li>a2</li></ul></li><li>a3</li></ul></li><li>b</li></ul>',
    );
  });

  it('清單中途換成有序，開新的一層', () => {
    const html = renderIssueHtml(issue({ id: 'AAAAAA0001', description: '- a\n  1. one' }));

    expect(description(html)).toContain('<ul><li>a<ol><li>one</li></ol></li></ul>');
  });
});

describe('description markdown: 行內語法', () => {
  it('bold、italic 與 inline code', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: '**bold** and *italic* and _under_ and `code()`' }),
    );

    const d = description(html);
    expect(d).toContain('<strong>bold</strong>');
    expect(d).toContain('<em>italic</em>');
    expect(d).toContain('<em>under</em>');
    expect(d).toContain('<code>code()</code>');
  });

  it('inline code 內部不再解析 markdown，且內容逸出', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: 'run `<b>**x**</b>` now' }),
    );

    const d = description(html);
    expect(d).toContain('<code>&lt;b&gt;**x**&lt;/b&gt;</code>');
    expect(d).not.toContain('<strong>');
    expect(d).not.toMatch(/<b>/);
  });

  it('snake_case 不被拆成斜體', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: 'the in_progress_lane field' }),
    );

    const d = description(html);
    expect(d).not.toContain('<em>');
    expect(d).toContain('in_progress_lane');
  });
});

describe('description markdown: link', () => {
  it('http / https / mailto / 相對路徑成為連結', () => {
    const html = renderIssueHtml(
      issue({
        id: 'AAAAAA0001',
        description: '[site](https://example.com/a) [rel](/i/01JBX7) [mail](mailto:a@b.c)',
      }),
    );

    const d = description(html);
    expect(d).toContain('<a href="https://example.com/a">site</a>');
    expect(d).toContain('<a href="/i/01JBX7">rel</a>');
    expect(d).toContain('<a href="mailto:a@b.c">mail</a>');
  });

  it('javascript: URL 不得成為連結，含大小寫混寫與夾雜控制字元', () => {
    const payloads = [
      '[a](javascript:alert(1))',
      '[a](JaVaScRiPt:alert`1`)',
      '[a](  javascript:alert(1))',
      '[a](java\tscript:alert(1))',
      '[a](java\nscript:alert(1))',
    ];

    for (const p of payloads) {
      const d = description(renderIssueHtml(issue({ id: 'AAAAAA0001', description: p })));
      expect(d, p).not.toMatch(/<a\b/i);
      expect(d, p).not.toMatch(/href/i);
    }
  });

  it('data: 與 vbscript: URL 同樣不得成為連結', () => {
    for (const p of ['[a](data:text/html,<script>alert(1)</script>)', '[a](vbscript:msgbox)']) {
      const d = description(renderIssueHtml(issue({ id: 'AAAAAA0001', description: p })));
      expect(d, p).not.toMatch(/<a\b/i);
      expect(d, p).not.toMatch(/href/i);
    }
  });

  it('圖片語法不支援：既不是 img 也不是連結', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', description: '![alt](https://example.com/x.png)' }),
    );

    const d = description(html);
    expect(d).not.toMatch(/<img\b/i);
    expect(d).not.toMatch(/<a\b/i);
    expect(d).toContain('![alt](https://example.com/x.png)');
  });
});

/** 依文件順序取出每則 comment 的 actor。 */
function commentActors(html: string): string[] {
  return [...html.matchAll(/<li class="comment"[^>]*data-actor="([^"]*)"/g)].map((m) => m[1]!);
}

describe('renderIssueHtml comments', () => {
  it('依 core 給定的順序渲染，不自行重排 —— 排序是 core 的責任', () => {
    // Issue.comments 由 reduce() 以 (t, a, id) 全序產出。渲染層若複製一份
    // 比較器，兩者就會分歧：先前這裡用的是 (t, id)，在 t 相同而 actor 不同時
    // 會排出與 CLI 表格不一致的順序。改為信任 core 的順序，原樣輸出。
    const html = renderIssueHtml(
      issue({
        id: 'AAAAAA0001',
        comments: [
          { id: 'C2', actor: 'm8q2', t: 9, body: 'safari 才會重現' },
          { id: 'C1', actor: 'k3f9', t: 2, body: 'first **note**' },
        ],
      }),
    );

    expect(commentActors(html)).toEqual(['m8q2', 'k3f9']);
    expect(html).toContain('<strong>note</strong>');
    expect(html).toContain('safari 才會重現');
  });

  it('comment body 同樣關閉 raw HTML', () => {
    const html = renderIssueHtml(
      issue({
        id: 'AAAAAA0001',
        comments: [{ id: 'C1', actor: '<script>x</script>', t: 1, body: '<script>alert(1)</script>' }],
      }),
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('沒有 comment 時不輸出空的時間軸', () => {
    const html = renderIssueHtml(issue({ id: 'AAAAAA0001' }));

    expect(html).not.toContain('class="comments"');
  });
});

describe('board 與詳情頁互連', () => {
  it('卡片連到 /i/<短 ID>，詳情頁連回看板', () => {
    const board = renderBoardHtml([
      issue({ id: '01JBX7A9Q3ZZZZZZZZZZZZZZZZ', title: 'Fix login redirect', status: 'queued' }),
    ]);
    expect(board).toContain('href="/i/01JBX7"');

    const detail = renderIssueHtml(issue({ id: '01JBX7A9Q3ZZZZZZZZZZZZZZZZ' }));
    expect(detail).toContain('href="/"');
  });
});

/**
 * Golden file 是輸出穩定性的回歸釘子：任何非預期的標記／樣式變動都會顯形。
 * 檔名一律以 `html-` 開頭 —— 此目錄與票 07 共用。
 */
function golden(name: string, actual: string): void {
  const file = new URL(`./__golden__/${name}`, import.meta.url);
  if (process.env['UPDATE_GOLDEN'] === '1') {
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file)) {
    throw new Error(`missing golden ${name}（以 UPDATE_GOLDEN=1 產生後逐行檢查再納入）`);
  }
  expect(actual).toBe(readFileSync(file, 'utf8'));
}

/** 涵蓋八欄、labels、archived 的固定輸入。 */
const BOARD_FIXTURE: Issue[] = [
  issue({ id: '01JBXAA9Q3AAAAAAAAAAAAAAAA', title: 'Fix login redirect', status: 'backlog', labels: ['bug'] }),
  issue({ id: '01JBXBB2K9BBBBBBBBBBBBBBBB', title: 'Write the skill doc', status: 'todo' }),
  issue({ id: '01JBXCC5R1CCCCCCCCCCCCCCCC', title: 'Union merge spike', status: 'queued', labels: ['spike', 'p1'] }),
  issue({ id: '01JBXDD8T2DDDDDDDDDDDDDDDD', title: 'Reducer convergence', status: 'in_progress' }),
  issue({ id: '01JBXEE1V3EEEEEEEEEEEEEEEE', title: 'CLI table output', status: 'review', labels: ['render'] }),
  issue({ id: '01JBXFF4W4FFFFFFFFFFFFFFFF', title: 'Publish @nook/cli', status: 'blocked', labels: ['npm'] }),
  issue({ id: '01JBXGG7X5GGGGGGGGGGGGGGGG', title: 'Choose NDJSON layout', status: 'done' }),
  issue({ id: '01JBXHH0Y6HHHHHHHHHHHHHHHH', title: 'Build a TUI', status: 'cancelled', labels: ['non-goal'] }),
  issue({ id: '01JBXJJ3Z7JJJJJJJJJJJJJJJJ', title: 'Archived, must not appear', status: 'done', archived: true }),
];

const ISSUE_FIXTURE: Issue = issue({
  id: '01JBXCC5R1CCCCCCCCCCCCCCCC',
  title: 'Union merge spike',
  status: 'queued',
  labels: ['spike', 'p1'],
  description: [
    '## What we measured',
    '',
    'Union merge keeps **both** sides, but only when every write ends with `\\n`.',
    '',
    '- trailing newline discipline',
    '  - glued lines are detected',
    '  - `doctor` repairs them',
    '- unknown ops are ignored',
    '',
    '```',
    'git merge feature   # <no conflict>',
    '```',
    '',
    '> A glued line is not valid JSON.',
    '',
    'See [the findings](/i/01JBX7) and *nothing else*.',
  ].join('\n'),
  comments: [
    { id: 'C1', actor: 'k3f9', t: 2, body: 'Reproduced on git 2.50.1.' },
    { id: 'C2', actor: 'm8q2', t: 7, body: 'Blocked on `.gitattributes` landing first.' },
  ],
});

describe('golden files', () => {
  it('看板檢視的輸出穩定', () => {
    golden('html-board.html', renderBoardHtml(BOARD_FIXTURE));
  });

  it('詳情檢視的輸出穩定', () => {
    golden('html-issue.html', renderIssueHtml(ISSUE_FIXTURE));
  });
});

describe('document title 的逸出', () => {
  it('惡意 title 不得從 <title> 元素逃出', () => {
    const html = renderIssueHtml(
      issue({ id: 'AAAAAA0001', title: '</title><script>alert(1)</script>' }),
    );

    expect(html).not.toContain('<script>');
    expect(html).toMatch(/<title>&lt;\/title&gt;&lt;script&gt;/);
  });
});
