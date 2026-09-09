/**
 * Markdown → 安全 HTML。
 *
 * 這個模組曾經同時渲染看板與詳情頁；那一半已由 `src/studio/` 的 React 應用接手
 * （ADR-0008）。留下的只有 markdown renderer，理由是它的安全模型 ——「先逸出、
 * 再構造」—— 在 React 裡重寫是降級。client 收到的 `descriptionHtml` 與
 * `bodyHtml` 因此已經是安全字串，安全性由 server 保證，不靠前端紀律。
 *
 * 零 runtime dependency 是硬性約束，所以連 markdown 解析都自己寫。
 */

/**
 * 文字進入 HTML 前一律逸出。issue 內容可能是從外部 repo pull 來的，而產物會被
 * client 直接注入 DOM。
 *
 * 這是「先逸出、再構造」的那個「先」：本模組的每一處插入標籤之前都先過它，
 * 所以 raw HTML 天生無法通過，不需要一份危險標籤黑名單。`&` 必須最先替換，
 * 否則已逸出的實體會被後續替換重新組回注入向量。
 *
 * server/handler.ts 的缺資產訊息頁也用同一份 —— 它原本各留一份位元組相同的
 * 副本，而兩份逸出實作漂開的那一天不會有任何測試告訴我們。
 */
export function escapeHtml(text: string): string {
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
export function renderMarkdown(src: string): string {
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
 * 沒有 scheme 的（相對路徑、錨點）放行，但 protocol-relative 除外。
 *
 * 用白名單而非「javascript: 黑名單」：黑名單少列一個 scheme 就是一個漏洞，
 * 白名單少列一個 scheme 只是少一個功能。
 */
function isSafeUrl(url: string): boolean {
  // 控制字元與空白會被瀏覽器忽略，因此比對前先剝掉（java\tscript: 這類繞法）。
  const normalized = url.replace(/[\u0000-\u0020]/g, '');

  // protocol-relative（`//evil.com`）沒有 scheme，卻會沿用當前頁面的 scheme
  // 指向外部站台 —— 必須在「沒有 scheme 就放行」之前擋下。
  //
  // v1 判斷這只是導覽困擾而非 XSS 路徑，在唯讀的 localhost 檢視器上這是對的。
  // ADR-0007 之後 studio 成為寫入介面：issue 內容可能是外部 repo pull 來的，
  // 而讀者在同一個頁面上做寫入，被騙走的代價比唯讀時期大。
  //
  // 反斜線也算：URL 解析器在 http(s) 這種 special scheme 下把 `\` 正規化成 `/`，
  // 所以 `\\evil.com` 與 `/\evil.com` 跟 `//evil.com` 是同一件事。
  // 只看前兩個字元，因此 `/i/01JBX7`、`#section`、`./x.md` 都不受影響。
  if (/^[/\\]{2}/.test(normalized)) return false;

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
