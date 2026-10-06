/** Небольшой толерантный HTML → Markdown конвертер без зависимостей. */

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–',
  hellip: '…', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', middot: '·', bull: '•', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', euro: '€', sect: '§', para: '¶', plusmn: '±', frac12: '½', rarr: '→', larr: '←', thinsp: ' ',
  ensp: ' ', emsp: ' ', shy: '', zwj: '', zwnj: '',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'figure', 'figcaption', 'form', 'iframe', 'video', 'audio', 'details', 'summary', 'address', 'fieldset']);
const DROP = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg', 'object', 'select', 'textarea', 'button', 'input', 'label', 'canvas']);

const TAG_RE = /<!--([\s\S]*?)-->|<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>|<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function parseHtml(html) {
  const root = { type: 'el', tag: '#root', attrs: {}, children: [] };
  let cur = root;
  let last = 0;
  const text = (t) => {
    if (t) cur.children.push({ type: 'text', text: t, parent: cur });
  };
  const closeTo = (name) => {
    let n = cur;
    while (n && n.tag !== name) n = n.parent;
    if (n) cur = n.parent || root;
  };
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(html))) {
    text(decodeEntities(html.slice(last, m.index)));
    last = TAG_RE.lastIndex;
    if (m[1] != null) {
      cur.children.push({ type: 'comment', text: m[1], parent: cur });
    } else if (m[2]) {
      closeTo(m[2].toLowerCase());
    } else {
      const tag = m[3].toLowerCase();
      const attrs = {};
      for (const a of m[4].matchAll(ATTR_RE)) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      // неявные закрытия
      if (tag === 'li') {
        for (let n = cur; n && n.tag !== 'ul' && n.tag !== 'ol'; n = n.parent) if (n.tag === 'li') { cur = n.parent; break; }
      } else if (tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'ul' || tag === 'ol' || tag === 'table' || tag === 'blockquote' || tag === 'pre' || tag === 'div' || tag === 'figure') {
        if (cur.tag === 'p') cur = cur.parent;
      } else if (tag === 'tr' || tag === 'td' || tag === 'th') {
        const stop = tag === 'tr' ? ['tr'] : ['td', 'th'];
        if (stop.includes(cur.tag)) cur = cur.parent;
        if (tag !== 'tr' && cur.tag === 'tr') {} 
      }
      const el = { type: 'el', tag, attrs, children: [], parent: cur };
      cur.children.push(el);
      if (DROP.has(tag) && !VOID.has(tag) && !m[5]) {
        // содержимое выбрасываем целиком
        const closeRe = new RegExp(`</${tag}\\s*>`, 'ig');
        closeRe.lastIndex = TAG_RE.lastIndex;
        const c = closeRe.exec(html);
        last = TAG_RE.lastIndex = c ? closeRe.lastIndex : html.length;
        el.dropped = true;
        continue;
      }
      if (!VOID.has(tag) && !m[5]) cur = el;
    }
  }
  text(decodeEntities(html.slice(last)));
  return root;
}

export function textOf(node) {
  if (node.type === 'text') return node.text;
  if (node.type !== 'el') return '';
  if (node.tag === 'br') return '\n';
  return node.children.map(textOf).join('');
}

const attr = (n, k) => n.attrs?.[k] ?? '';
const hasClass = (n, c) => (attr(n, 'class') || '').split(/\s+/).includes(c);
const classMatch = (n, re) => re.test(attr(n, 'class'));

export function escapeText(s) {
  return s.replace(/([\\`*_{}\[\]<>])/g, '\\$1').replace(/&(?=[a-z#])/gi, '&');
}

export function youtubeId(url) {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}
export function vimeoId(url) {
  const m = /(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/.exec(url);
  return m ? m[1] : null;
}

/** Ссылка на видео → iframe-код (или null). */
export function embedHtml(url) {
  const y = youtubeId(url);
  if (y) return { kind: 'youtube', html: `<iframe src="https://www.youtube.com/embed/${y}" title="YouTube video" loading="lazy" allowfullscreen></iframe>` };
  const v = vimeoId(url);
  if (v) return { kind: 'vimeo', html: `<iframe src="https://player.vimeo.com/video/${v}" title="Vimeo video" loading="lazy" allowfullscreen></iframe>` };
  return null;
}

/**
 * ctx = {
 *   rewriteUrl(url, kind) → string   // kind: 'a' | 'img' | 'media' | 'iframe'
 *   onEmbed({kind, url})             // iframe/видео
 *   onForm()                         // найдена <form>
 *   onNote(text)                     // предупреждение для отчёта
 * }
 */
export function htmlToMarkdown(html, ctx = {}) {
  const c = { rewriteUrl: (u) => u, onEmbed() {}, onForm() {}, onNote() {}, ...ctx };
  const root = parseHtml(html);
  const hasH1 = (function find(n) { return n.tag === 'h1' || (n.children || []).some(find); })(root);
  c.hShift = hasH1 ? 1 : 0;
  const md = blocks(root.children, c, 0);
  return md.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function isInline(n) {
  if (n.type === 'text') return true;
  if (n.type === 'comment') return false;
  if (BLOCK.has(n.tag)) return false;
  return true;
}

/** Блочная раскладка списка узлов → строки Markdown. */
function blocks(nodes, c, depth) {
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const raw = run.map((n) => inline(n, c)).join('');
    run = [];
    const t = raw.replace(/[ \t]*\n[ \t]*/g, (m) => (m.includes('\n') ? '\n' : ' ')).trim();
    if (t) out.push(paragraph(t, c));
  };
  for (const n of nodes) {
    if (n.type === 'comment') {
      flush();
      const t = n.text.trim();
      if (t.startsWith('TODO(wp-export)')) out.push(`<!-- ${t} -->`);
      continue;
    }
    if (n.dropped) continue;
    if (isInline(n)) { run.push(n); continue; }
    flush();
    const b = block(n, c, depth);
    if (b) out.push(b);
  }
  flush();
  return out.join('\n\n');
}

function paragraph(t, c) {
  // одинокая ссылка на YouTube/Vimeo → встраивание
  if (/^https?:\/\/\S+$/.test(t)) {
    const e = embedHtml(t);
    if (e) { c.onEmbed({ kind: e.kind, url: t }); return e.html; }
  }
  return t.replace(/\n[ \t]+/g, '\n').replace(/^(#{1,6}\s|[-+]\s|\d+[.)]\s|>|={3,}|-{3,})/, '\\$1');
}

function wrapEmbedFrame(n, c) {
  const src = c.rewriteUrl(attr(n, 'src') || attr(n, 'data-src'), 'iframe');
  if (!src) return '';
  c.onEmbed({ kind: embedKind(src), url: src });
  const title = attr(n, 'title');
  const h = attr(n, 'height');
  return `<iframe src="${esc(src)}"${title ? ` title="${esc(title)}"` : ''}${h && /^\d+$/.test(h) ? ` height="${h}"` : ''} loading="lazy" allowfullscreen></iframe>`;
}
function embedKind(url) {
  if (/youtube|youtu\.be/.test(url)) return 'youtube';
  if (/vimeo/.test(url)) return 'vimeo';
  if (/google\.[^/]+\/maps|maps\.google|yandex\.[^/]+\/(map|maps)|api-maps\.yandex|2gis/.test(url)) return 'map';
  if (/vk\.com|vkvideo|rutube/.test(url)) return 'video-ru';
  return 'iframe';
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function block(n, c, depth) {
  const t = n.tag;
  if (/^h[1-6]$/.test(t)) {
    const level = Math.min(6, Math.max(2, Number(t[1]) + c.hShift));
    const txt = inlineAll(n.children, c).replace(/\s+/g, ' ').trim();
    return txt ? `${'#'.repeat(level)} ${txt}` : '';
  }
  switch (t) {
    case 'p': {
      const imgOnly = n.children.filter((x) => !(x.type === 'text' && !x.text.trim()));
      const raw = inlineAll(n.children, c);
      const txt = raw.replace(/[ \t]*\n[ \t]*/g, (m) => m).trim();
      if (!txt) return '';
      if (imgOnly.length === 1 && imgOnly[0].tag === 'a') { /* ссылка с картинкой — оставляем как есть */ }
      return paragraph(txt, c);
    }
    case 'hr':
      return '---';
    case 'ul':
    case 'ol':
      return list(n, c, depth);
    case 'blockquote': {
      const inner = blocks(n.children, c, depth);
      return inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    }
    case 'pre': {
      const code = n.children.find((x) => x.tag === 'code');
      const lang = ((code && attr(code, 'class')) || '').match(/language-([\w-]+)/)?.[1] || '';
      const body = textOf(code || n).replace(/\n+$/, '');
      return '```' + lang + '\n' + body + '\n```';
    }
    case 'table':
      return table(n, c);
    case 'figure': {
      if (classMatch(n, /wp-block-embed|is-type-video/)) {
        const url = textOf(n).trim().split(/\s+/).find((w) => /^https?:\/\//.test(w));
        const iframe = findTag(n, 'iframe');
        if (iframe) return wrapEmbedFrame(iframe, c);
        if (url) {
          const e = embedHtml(url);
          if (e) { c.onEmbed({ kind: e.kind, url }); return e.html; }
          c.onEmbed({ kind: 'link', url });
          return `[${url}](${c.rewriteUrl(url, 'a')})`;
        }
      }
      return blocks(n.children, c, depth);
    }
    case 'figcaption': {
      const t2 = inlineAll(n.children, c).replace(/\s+/g, ' ').trim();
      return t2 ? `*${t2}*` : '';
    }
    case 'iframe':
      return wrapEmbedFrame(n, c);
    case 'video':
    case 'audio': {
      const src = attr(n, 'src') || (findTag(n, 'source') ? attr(findTag(n, 'source'), 'src') : '');
      if (!src) return '';
      const u = c.rewriteUrl(src, 'media');
      c.onEmbed({ kind: t, url: u });
      return `<${t} src="${esc(u)}" controls preload="metadata"></${t}>`;
    }
    case 'form':
      c.onForm(n);
      return '<!-- TODO(wp-export): здесь была HTML-форма, её нужно воссоздать вручную -->';
    case 'dl':
      return n.children.filter((x) => x.type === 'el').map((x) => (x.tag === 'dt' ? `**${inlineAll(x.children, c).trim()}**` : inlineAll(x.children, c).trim())).join('\n\n');
    case 'tr':
    case 'td':
    case 'th':
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return blocks(n.children, c, depth);
    default:
      return blocks(n.children, c, depth);
  }
}

function findTag(n, tag) {
  if (n.tag === tag) return n;
  for (const ch of n.children || []) {
    const f = findTag(ch, tag);
    if (f) return f;
  }
  return null;
}

function list(n, c, depth) {
  const ordered = n.tag === 'ol';
  const start = Number(attr(n, 'start')) || 1;
  const items = n.children.filter((x) => x.type === 'el' && x.tag === 'li');
  const lines = [];
  items.forEach((li, idx) => {
    const marker = ordered ? `${start + idx}. ` : '- ';
    const indent = ' '.repeat(marker.length);
    // inline-часть и вложенные блоки раздельно
    const inl = [];
    const rest = [];
    for (const ch of li.children) {
      if (ch.type === 'el' && (ch.tag === 'ul' || ch.tag === 'ol')) rest.push(list(ch, c, depth + 1));
      else if (ch.type === 'el' && BLOCK.has(ch.tag) && ch.tag !== 'p') rest.push(block(ch, c, depth + 1));
      else if (ch.type === 'el' && ch.tag === 'p') inl.push(inlineAll(ch.children, c) + ' ');
      else if (ch.type !== 'comment') inl.push(inline(ch, c));
    }
    const head = inl.join('').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    let item = marker + head;
    for (const r of rest.filter(Boolean)) item += '\n' + r.split('\n').map((l) => (l ? indent + l : l)).join('\n');
    lines.push(item);
  });
  return lines.join('\n');
}

function table(n, c) {
  const rows = [];
  const collect = (node) => {
    for (const ch of node.children) {
      if (ch.type !== 'el') continue;
      if (ch.tag === 'tr') rows.push(ch);
      else if (['thead', 'tbody', 'tfoot'].includes(ch.tag)) collect(ch);
    }
  };
  collect(n);
  if (!rows.length) return '';
  const cells = rows.map((tr) => tr.children.filter((x) => x.type === 'el' && (x.tag === 'td' || x.tag === 'th')));
  const hasSpan = cells.flat().some((cell) => Number(attr(cell, 'colspan')) > 1 || Number(attr(cell, 'rowspan')) > 1);
  if (hasSpan) c.onNote('Таблица с объединёнными ячейками (colspan/rowspan) — проверьте вручную');
  const width = Math.max(...cells.map((r) => r.length));
  const text = cells.map((r) => {
    const t = r.map((cell) => inlineAll(cell.children, c).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim());
    while (t.length < width) t.push('');
    return t;
  });
  const headerIsTh = cells[0].length && cells[0].every((x) => x.tag === 'th');
  const head = text[0];
  const body = text.slice(1);
  const fmt = (r) => `| ${r.join(' | ')} |`;
  return [fmt(head), `| ${head.map(() => '---').join(' | ')} |`, ...body.map(fmt)].join('\n') + (headerIsTh ? '' : '');
}

function inlineAll(nodes, c) {
  return nodes.map((n) => inline(n, c)).join('');
}

function wrapMark(mark, inner) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!m[2]) return inner;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

function inline(n, c) {
  if (n.type === 'text') return escapeText(n.text.replace(/[ \t\r\n]+/g, ' '));
  if (n.type !== 'el' || n.dropped) return '';
  switch (n.tag) {
    case 'br':
      return '  \n';
    case 'strong':
    case 'b':
      return wrapMark('**', inlineAll(n.children, c));
    case 'em':
    case 'i':
    case 'cite':
      return wrapMark('*', inlineAll(n.children, c));
    case 'del':
    case 's':
    case 'strike':
      return wrapMark('~~', inlineAll(n.children, c));
    case 'code':
    case 'kbd':
    case 'samp':
      return '`' + textOf(n).replace(/`/g, "'") + '`';
    case 'sup':
    case 'sub':
      return `<${n.tag}>${inlineAll(n.children, c)}</${n.tag}>`;
    case 'img': {
      let src = attr(n, 'src') || attr(n, 'data-src') || attr(n, 'data-lazy-src');
      if (!src || src.startsWith('data:')) return '';
      src = c.rewriteUrl(src, 'img');
      const alt = attr(n, 'alt').replace(/[\[\]\n]/g, ' ').trim();
      return `![${alt}](${src})`;
    }
    case 'a': {
      const href = attr(n, 'href');
      const inner = inlineAll(n.children, c);
      if (classMatch(n, /wp-block-file__button|wp-element-button-download/)) return '';
      if (!href || href.startsWith('javascript:')) return inner;
      if (!inner.trim()) return '';
      const url = c.rewriteUrl(href, 'a', textOf(n));
      if (url == null) return inner;
      const todo = c.takeTodo?.();
      const title = attr(n, 'title');
      const lead = /^\s*/.exec(inner)[0];
      const trail = /\s*$/.exec(inner)[0];
      return `${lead}[${inner.trim()}](${url}${title ? ` "${title.replace(/"/g, "'")}"` : ''})${todo ? ` <!-- TODO(wp-export): ${todo} -->` : ''}${trail}`;
    }
    case 'iframe':
    case 'video':
    case 'audio':
    case 'form':
      return '\n\n' + block(n, c, 0) + '\n\n';
    case 'figure':
    case 'figcaption':
      return '\n\n' + block(n, c, 0) + '\n\n';
    default:
      return inlineAll(n.children, c);
  }
}
