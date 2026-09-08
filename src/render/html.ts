import { shortIdLength } from '../core/ids.js';
import { STATUSES } from '../core/types.js';
import type { Comment, Issue } from '../core/types.js';

/**
 * 版面常數。八欄必須在 1920px 下不捲動即可看完：
 * 8 × 224 + 7 × 8 + 2 × 16 = 1880px，留約 40px 給捲軸與視窗邊界。
 * 筆電寬度才觸發橫向捲動。
 */
const COL_WIDTH_PX = 224;
const COL_GAP_PX = 8;
const BOARD_PAD_PX = 16;

const STYLESHEET = `
:root{--col-w:${COL_WIDTH_PX}px;--col-gap:${COL_GAP_PX}px;--board-pad:${BOARD_PAD_PX}px;
--fg:#1c1c1e;--muted:#6b6b70;--bg:#f6f6f7;--surface:#fff;--line:#dcdce0}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.board{display:flex;gap:var(--col-gap);padding:var(--board-pad);overflow-x:auto;
align-items:flex-start;min-height:100vh}
.col{flex:0 0 var(--col-w);background:var(--surface);border:1px solid var(--line);
border-radius:8px;padding:8px}
.col>h2{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.04em;
text-transform:uppercase;color:var(--muted)}
.col>h2 .count{float:right;font-weight:400}
.card{display:block;background:var(--surface);border:1px solid var(--line);
border-radius:6px;padding:8px;margin-bottom:6px;color:inherit;text-decoration:none}
.card .id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted)}
.card .title{display:block;margin-top:2px}
.labels{list-style:none;display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 0;padding:0}
.label{font-size:11px;background:var(--bg);border:1px solid var(--line);
border-radius:999px;padding:0 6px;color:var(--muted)}
.issue{max-width:760px;margin:0 auto;padding:24px 16px}
.back{margin:0 0 12px;font-size:12px}
.back a{color:var(--muted)}
.issue h1{margin:4px 0 8px;font-size:22px}
.issue .meta{margin:0 0 12px}
.status{font-size:12px;border:1px solid var(--line);border-radius:999px;
padding:1px 8px;background:var(--surface)}
.description pre,.comment .body pre{background:var(--surface);border:1px solid var(--line);border-radius:6px;
padding:10px;overflow-x:auto}
.description code,.comment .body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.description blockquote,.comment .body blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--line);
color:var(--muted)}
.description ul,.description ol,.comment .body ul,.comment .body ol{padding-left:22px;margin:8px 0}
.description a,.comment .body a{color:#0b57d0}
.comments{list-style:none;margin:20px 0 0;padding:16px 0 0;border-top:1px solid var(--line)}
.comment{margin-bottom:14px}
.comment .actor{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
color:var(--muted)}
.comment .body>p:first-child{margin-top:2px}
`;

/**
 * 腳本內容不逸出 —— 它是 JS，不是文字。唯一要防的是提前閉合 `</script>`：
 * `<\/` 在 JS 的字串與 regex 字面量中與 `</` 等價，因此這個替換對合法的
 * 腳本無害，卻讓任何 `</script>` 都無法從元素裡逃出去。
 */
function inlineScriptTag(script: string): string {
  return `<script>${script.replaceAll('</', '<\\/')}</script>\n`;
}

/** `title` 收未逸出的原文 —— 逸出責任留在這裡，呼叫端不必記得。 */
function page(title: string, body: string, inlineScript?: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>${STYLESHEET}</style>\n` +
    `</head>\n<body>\n${body}\n` +
    (inlineScript === undefined ? '' : inlineScriptTag(inlineScript)) +
    `</body>\n</html>\n`
  );
}

/**
 * 文字進入 HTML 前一律逸出。這是本模組唯一的注入防線：
 * 頁面與 JSON API 同源，issue 內容可能是從外部 repo pull 來的。
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 極小的 markdown 渲染器。零 runtime dependency 是硬性約束。
 *
 * 安全模型是「先逸出，再構造」：所有來源文字在任何標記產生之前就已經
 * 過 escapeHtml，之後只由本模組自己插入標籤。因此 raw HTML 天生無法通過
 * —— 不需要一份「危險標籤黑名單」，也就沒有黑名單漏列的那類漏洞。
 * 不支援圖片。
 */
function renderMarkdown(src: string): string {
  return renderBlocks(src.replace(/\r\n?/g, '\n').split('\n'));
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** 去掉一組行共同的前導縮排。 */
function dedent(lines: readonly string[]): string[] {
  const indents = lines
    .filter((l) => l.trim() !== '')
    .map((l) => /^\s*/.exec(l)![0].length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((l) => l.slice(common));
}

/**
 * 一段連續的清單行。縮排較深的行歸屬於前一個項目，再遞迴解析 ——
 * 巢狀清單與清單內的其他區塊都由此而來。
 */
function renderList(lines: readonly string[]): string {
  const first = LIST_ITEM.exec(lines[0]!)!;
  const baseIndent = first[1]!.length;
  const tag = /\d/.test(first[2]!) ? 'ol' : 'ul';

  const items: { text: string; nested: string[] }[] = [];
  for (const line of lines) {
    const m = LIST_ITEM.exec(line);
    if (m !== null && m[1]!.length <= baseIndent) {
      items.push({ text: m[3]!, nested: [] });
      continue;
    }
    items[items.length - 1]!.nested.push(line);
  }

  const body = items
    .map((it) => {
      const nested = it.nested.length === 0 ? '' : renderBlocks(dedent(it.nested));
      return `<li>${renderInline(it.text)}${nested}</li>`;
    })
    .join('');
  return `<${tag}>${body}</${tag}>`;
}

/** 行導向的區塊解析。 */
function renderBlocks(lines: readonly string[]): string {
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushParagraph = (): void => {
    if (para.length === 0) return;
    out.push(`<p>${renderInline(para.join(' '))}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      flushParagraph();
      const marker = fence[1]!;
      const closer = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !closer.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      // 未閉合的圍籬：吃到結尾，而不是把剩下的內容當成別的東西。
      i += 1;
      const body = code.map((l) => `${escapeHtml(l)}\n`).join('');
      out.push(`<pre><code>${body}</code></pre>`);
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && /^ {0,3}>/.test(lines[i]!)) {
        quoted.push(lines[i]!.replace(/^ {0,3}> ?/, ''));
        i += 1;
      }
      // 遞迴：巢狀引用、引用內的 heading／list／code 都自然成立。
      out.push(`<blockquote>${renderBlocks(quoted)}</blockquote>`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushParagraph();
      const group: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '') {
        const l = lines[i]!;
        if (!LIST_ITEM.test(l) && !/^\s{2,}\S/.test(l)) break;
        group.push(l);
        i += 1;
      }
      out.push(renderList(group));
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }

    para.push(line.trim());
    i += 1;
  }

  flushParagraph();
  return out.join('');
}

/**
 * 行內語法。輸入是尚未逸出的來源文字。
 *
 * 先切出 code span，其餘片段各自 escapeHtml 之後才套用強調語法 ——
 * 逸出永遠發生在插入標籤之前，code span 內部則完全不再解析。
 */
function renderInline(text: string): string {
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : renderLinks(part),
    )
    .join('');
}

const LINK = /(!?\[[^\]]*\]\([^)]*\))/;

/**
 * URL 白名單。有 scheme 的一律只放行 http/https/mailto；
 * 沒有 scheme 的（相對路徑、錨點）放行。
 *
 * 用白名單而非「javascript: 黑名單」：黑名單少列一個 scheme 就是一個漏洞，
 * 白名單少列一個 scheme 只是少一個功能。
 */
function isSafeUrl(url: string): boolean {
  // 控制字元與空白會被瀏覽器忽略，因此比對前先剝掉（java\tscript: 這類繞法）。
  const normalized = url.replace(/[\u0000-\u0020]/g, '');
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized);
  if (scheme === null) return true;
  return ['http', 'https', 'mailto'].includes(scheme[1]!.toLowerCase());
}

/** 連結。圖片與不安全的 URL 一律退回純文字 —— 讓嘗試本身仍然看得見。 */
function renderLinks(text: string): string {
  return text
    .split(LINK)
    .map((token) => {
      const m = /^(!?)\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
      if (m === null) return emphasis(escapeHtml(token));

      const isImage = m[1] === '!';
      const label = m[2]!;
      const url = m[3]!.trim();
      if (isImage || !isSafeUrl(url)) return emphasis(escapeHtml(token));

      return `<a href="${escapeHtml(url)}">${emphasis(escapeHtml(label))}</a>`;
    })
    .join('');
}

/** 對已逸出的文字套用 bold／italic。 */
function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 詞內的底線不算斜體，否則 in_progress 這種識別字會被拆開。
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
}

/**
 * 長度由呼叫端算好後傳進來 —— 「幾碼才無歧義」是整批的性質，單一識別碼
 * 看不出來。長度邏輯只有 core 的 shortIdLength 一份，此處不得再算一次：
 * 兩個渲染器各留一份比較器正是 comment 排序分歧的成因（commit 463343d）。
 */
function shortId(id: string, len: number): string {
  return id.slice(0, len);
}

function labelList(labels: readonly string[]): string {
  if (labels.length === 0) return '';
  const items = labels.map((l) => `<li class="label">${escapeHtml(l)}</li>`).join('');
  return `<ul class="labels">${items}</ul>`;
}

function card(issue: Issue, len: number): string {
  const short = escapeHtml(shortId(issue.id, len));
  return (
    `<a class="card" href="/i/${short}">` +
    `<span class="id">${short}</span>` +
    `<span class="title">${escapeHtml(issue.title)}</span>` +
    labelList(issue.labels) +
    `</a>`
  );
}

export interface BoardHtmlOptions {
  /**
   * 內嵌到頁面尾端的 JS。studio server 用它送出輪詢重載的腳本；
   * 未傳入時頁面維持零 JS（票 08 的契約）。
   */
  readonly inlineScript?: string;
}

/**
 * 看板：八個固定 status 各一欄，順序即 STATUSES（見 docs/adr/0003）。
 * archived 是可見性欄位，預設隱藏。
 */
export function renderBoardHtml(
  issues: readonly Issue[],
  opts: BoardHtmlOptions = {},
): string {
  // 長度算在過濾之前：卡片連結是 Ref，而 board.get() 的候選集合含 archived
  // 的 Issue。只看可見的那幾張會產生在解析端撞號的連結。
  const len = shortIdLength(issues.map((i) => i.id));
  const visible = issues.filter((i) => !i.archived);
  const cols = STATUSES.map((s) => {
    const inCol = visible.filter((i) => i.status === s);
    return (
      `<section class="col" data-status="${s}">` +
      `<h2>${s}<span class="count">${inCol.length}</span></h2>` +
      inCol.map((i) => card(i, len)).join('') +
      `</section>`
    );
  }).join('\n');
  return page('Nook', `<main class="board">\n${cols}\n</main>`, opts.inlineScript);
}

/**
 * Comment 時間軸。以 lamport t 排序 —— Nook 沒有牆上時鐘，
 * op-log 的因果順序就是時間順序。
 */
function commentTimeline(comments: readonly Comment[]): string {
  if (comments.length === 0) return '';
  // 不重排：Issue.comments 已由 reduce() 以 (t, a, id) 全序產出。
  // 在此複製一份比較器只會與 core 分歧 —— 排序是 core 的責任。
  const items = comments
    .map(
      (c) =>
        `<li class="comment" data-actor="${escapeHtml(c.actor)}">` +
        `<span class="actor">${escapeHtml(c.actor)}</span>` +
        `<div class="body">${renderMarkdown(c.body)}</div>` +
        `</li>`,
    )
    .join('');
  return `<ol class="comments">${items}</ol>`;
}

/**
 * 詳情頁。
 *
 * 短 ID 一律顯示 SHORT_ID_MIN 碼：這裡只拿得到一張 Issue，無從得知整批的
 * 情況，因此不可能算出「幾碼才無歧義」。刻意不改成顯示完整識別碼 ——
 * 詳情頁是人在讀的頁面，26 碼是噪音，而完整識別碼就在網址列裡。需要一個
 * 保證無歧義的 Ref 時，回看板從卡片連結取（那裡才知道整批）。
 */
export function renderIssueHtml(issue: Issue): string {
  const detailLen = shortIdLength([issue.id]);
  const body =
    `<main class="issue">` +
    `<p class="back"><a href="/">&larr; board</a></p>` +
    `<header>` +
    // 一張 Issue 自己跟自己永遠不會撞號，故 shortIdLength 回傳的就是下限。
    `<span class="id">${escapeHtml(shortId(issue.id, detailLen))}</span>` +
    `<h1>${escapeHtml(issue.title)}</h1>` +
    `<p class="meta"><span class="status" data-status="${escapeHtml(issue.status)}">` +
    `${escapeHtml(issue.status)}</span></p>` +
    labelList(issue.labels) +
    `</header>` +
    `<div class="description">${renderMarkdown(issue.description)}</div>` +
    commentTimeline(issue.comments) +
    `</main>`;
  return page(`${issue.title} — Nook`, body);
}
