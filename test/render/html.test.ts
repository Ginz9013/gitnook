import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/render/html.js';

/**
 * 看板與詳情頁的渲染已由 `src/studio/` 的 React 應用接手（ADR-0008），
 * 留在 server 的只有 markdown renderer。這些測試因此直接打 `renderMarkdown`，
 * 而不是先組一張 Issue 再從詳情頁挖出 `<div class="description">` ——
 * 那個 `<div>` 已經不存在了。
 *
 * 斷言逐條保持原樣：這個模組留下來的理由就是這些安全性質，
 * 少一條就等於在拆分的過程中悄悄降級。
 */

describe('description markdown: raw HTML 關閉', () => {
  it('description 中的 <script> 被逸出為文字，不成為標記', () => {
    const d = renderMarkdown('before\n\n<script>fetch("/i/secret")</script>\n\nafter');

    expect(d).not.toContain('<script>');
    expect(d).not.toContain('</script>');
    expect(d).toContain('&lt;script&gt;');
    expect(d).toContain('before');
    expect(d).toContain('after');
  });

  it('description 中的 <img onerror=> 不成為 img 標籤', () => {
    const d = renderMarkdown('<img src=x onerror="alert(1)">');

    expect(d).not.toMatch(/<img\b/i);
    expect(d).not.toMatch(/<[^>]*\bonerror\b/i);
    expect(d).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('raw HTML 一律不通過，含大小寫混寫與屬性上的事件處理器', () => {
    const d = renderMarkdown('<DIV onclick="steal()">x</DIV>\n<svg/onload=alert(1)>');

    expect(d).not.toMatch(/<div\b/i);
    expect(d).not.toMatch(/<svg\b/i);
    expect(d).not.toMatch(/<[^>]*\bonclick\b/i);
    expect(d).not.toMatch(/<[^>]*\bonload\b/i);
    expect(d).toContain('&lt;DIV onclick=&quot;steal()&quot;&gt;');
  });
});

describe('description markdown: 區塊語法', () => {
  it('heading 支援 # 到 ######', () => {
    const d = renderMarkdown('# One\n\n### Three\n\n###### Six');

    expect(d).toContain('<h1>One</h1>');
    expect(d).toContain('<h3>Three</h3>');
    expect(d).toContain('<h6>Six</h6>');
  });

  it('七個 # 不是 heading，仍是段落文字', () => {
    const d = renderMarkdown('####### Seven');

    expect(d).not.toMatch(/<h[1-6]>/);
    expect(d).toContain('####### Seven');
  });
});

describe('description markdown: fenced code block', () => {
  it('圍籬程式碼區塊保留換行，內容逸出且不解析 markdown', () => {
    const d = renderMarkdown(
      'intro\n\n```js\nif (a < b) alert("**hi**");\n// # not a heading\n```\n\noutro',
    );

    expect(d).toContain(
      '<pre><code>if (a &lt; b) alert(&quot;**hi**&quot;);\n// # not a heading\n</code></pre>',
    );
    expect(d).toContain('<p>intro</p>');
    expect(d).toContain('<p>outro</p>');
  });

  it('程式碼區塊內的 <script> 不逃出 pre', () => {
    const d = renderMarkdown('```\n<script>alert(1)</script>\n```');

    expect(d).not.toContain('<script>');
    expect(d).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('description markdown: blockquote', () => {
  it('> 開頭的連續行成為一個 blockquote，內部仍走區塊解析', () => {
    const d = renderMarkdown('> ## quoted heading\n> body line\n\nafter');

    expect(d).toContain('<blockquote><h2>quoted heading</h2><p>body line</p></blockquote>');
    expect(d).toContain('<p>after</p>');
  });

  it('巢狀 blockquote', () => {
    const d = renderMarkdown('> outer\n> > inner');

    expect(d).toContain(
      '<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>',
    );
  });
});

describe('description markdown: list', () => {
  it('無序清單', () => {
    const d = renderMarkdown('- a\n- b');

    expect(d).toContain('<ul><li>a</li><li>b</li></ul>');
  });

  it('有序清單', () => {
    const d = renderMarkdown('1. a\n2. b');

    expect(d).toContain('<ol><li>a</li><li>b</li></ol>');
  });

  it('巢狀清單靠縮排，子清單掛在父項目之內', () => {
    const d = renderMarkdown('- a\n  - a1\n    - a2\n  - a3\n- b');

    expect(d).toContain(
      '<ul><li>a<ul><li>a1<ul><li>a2</li></ul></li><li>a3</li></ul></li><li>b</li></ul>',
    );
  });

  it('清單中途換成有序，開新的一層', () => {
    const d = renderMarkdown('- a\n  1. one');

    expect(d).toContain('<ul><li>a<ol><li>one</li></ol></li></ul>');
  });
});

describe('description markdown: 行內語法', () => {
  it('bold、italic 與 inline code', () => {
    const d = renderMarkdown('**bold** and *italic* and _under_ and `code()`');

    expect(d).toContain('<strong>bold</strong>');
    expect(d).toContain('<em>italic</em>');
    expect(d).toContain('<em>under</em>');
    expect(d).toContain('<code>code()</code>');
  });

  it('inline code 內部不再解析 markdown，且內容逸出', () => {
    const d = renderMarkdown('run `<b>**x**</b>` now');

    expect(d).toContain('<code>&lt;b&gt;**x**&lt;/b&gt;</code>');
    expect(d).not.toContain('<strong>');
    expect(d).not.toMatch(/<b>/);
  });

  it('snake_case 不被拆成斜體', () => {
    const d = renderMarkdown('the in_progress_lane field');

    expect(d).not.toContain('<em>');
    expect(d).toContain('in_progress_lane');
  });
});

describe('description markdown: link', () => {
  it('http / https / mailto / 相對路徑成為連結', () => {
    const d = renderMarkdown(
      '[site](https://example.com/a) [rel](/i/01JBX7) [mail](mailto:a@b.c)',
    );

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
      const d = renderMarkdown(p);
      expect(d, p).not.toMatch(/<a\b/i);
      expect(d, p).not.toMatch(/href/i);
    }
  });

  it('data: 與 vbscript: URL 同樣不得成為連結', () => {
    for (const p of ['[a](data:text/html,<script>alert(1)</script>)', '[a](vbscript:msgbox)']) {
      const d = renderMarkdown(p);
      expect(d, p).not.toMatch(/<a\b/i);
      expect(d, p).not.toMatch(/href/i);
    }
  });

  it('圖片語法不支援：既不是 img 也不是連結', () => {
    const d = renderMarkdown('![alt](https://example.com/x.png)');

    expect(d).not.toMatch(/<img\b/i);
    expect(d).not.toMatch(/<a\b/i);
    expect(d).toContain('![alt](https://example.com/x.png)');
  });
});
