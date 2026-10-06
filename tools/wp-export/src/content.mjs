import { htmlToMarkdown, embedHtml, decodeEntities } from './html2md.mjs';

/**
 * Контент записи WordPress (классический HTML / Gutenberg / шорткоды) → Markdown.
 * env: {
 *   reusableBlocks: Map<id, content>,
 *   attachmentsOf(postId) → [{ url, alt }],   // для [gallery] без ids
 *   attachmentUrl(id) → { url, alt } | null,
 *   rewriteUrl(url, kind), onEmbed, onForm, onNote, onShortcode(name)
 * }
 */

const BLOCK_START = /^<(?:(?:h[1-6]|ul|ol|table|div|blockquote|pre|figure|p|hr|iframe|form|section|article|aside|dl|video|audio|details)\b|!--)/i;

export function wpautop(text) {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!t) return '';
  return t
    .split(/\n\s*\n/)
    .map((chunk) => {
      const c = chunk.trim();
      if (!c) return '';
      if (BLOCK_START.test(c)) return c;
      return `<p>${c.replace(/\n/g, '<br>\n')}</p>`;
    })
    .join('\n\n');
}

export function parseAttrs(s) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))|"([^"]*)"|(\S+)/g;
  let m;
  let idx = 0;
  while ((m = re.exec(s || ''))) {
    if (m[1]) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    else attrs[idx++] = m[5] ?? m[6];
  }
  return attrs;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const FORM_SHORTCODES = /^(contact-form-7|wpcf7|wpforms|ninja_form|gravityform|gravityforms|formidable|forminator_form|fluentform|caldera_form|mailchimp|mc4wp_form|cf7|si-contact-form|ultimatemember|um_loggedin)/i;

function toHtmlShortcodes(text, env, postId, depth = 0) {
  if (depth > 5 || !text.includes('[')) return text;
  const re = /\[(\/?)([a-zA-Z][\w-]*)((?:\s(?:[^\]"']|"[^"]*"|'[^']*')*)?)\]/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const [full, closing, rawName, rawArgs] = m;
    const name = rawName.toLowerCase();
    if (closing) continue; // закрывающие обрабатываются вместе с открывающими
    if (text[m.index - 1] === '[' && text[m.index + full.length] === ']') continue; // [[escaped]]
    const selfClosed = /\/\s*$/.test(rawArgs);
    const args = parseAttrs(rawArgs.replace(/\/\s*$/, ''));
    // ищем закрывающий тег
    let inner = null;
    let end = m.index + full.length;
    if (!selfClosed) {
      const closeRe = new RegExp(`\\[/${rawName}\\]`, 'i');
      const rest = text.slice(end);
      const cm = closeRe.exec(rest);
      if (cm) {
        // убедимся, что между ними нет другого открывающего такого же (вложенные не поддерживаем — берём ближайший)
        inner = rest.slice(0, cm.index);
        end += cm.index + cm[0].length;
      }
    }
    const hasArgs = rawArgs.trim().length > 0;
    const known = handleShortcode(name, args, inner, env, postId, depth);
    let replacement;
    if (known !== undefined) {
      replacement = known;
    } else if (FORM_SHORTCODES.test(name)) {
      env.onShortcode?.(name, 'form');
      env.onForm?.({ shortcode: name });
      replacement = `\n\n<!-- TODO(wp-export): форма [${rawName}] — воссоздать вручную -->\n\n`;
    } else if (hasArgs || inner !== null || /[_-]/.test(rawName)) {
      env.onShortcode?.(name, 'unknown');
      const innerText = inner != null ? toHtmlShortcodes(inner, env, postId, depth + 1) : '';
      replacement = `\n\n<!-- TODO(wp-export): шорткод [${rawName}] не перенесён -->\n\n${innerText}`;
    } else {
      continue; // «[что-то]» без атрибутов — скорее всего обычный текст
    }
    out += text.slice(last, m.index) + replacement;
    last = end;
    re.lastIndex = end;
  }
  return out + text.slice(last);
}

function handleShortcode(name, a, inner, env, postId, depth) {
  switch (name) {
    case 'caption': {
      const body = toHtmlShortcodes(inner || '', env, postId, depth + 1).trim();
      const imgMatch = /(<a\b[^>]*>\s*)?<img\b[^>]*>(\s*<\/a>)?/i.exec(body);
      const img = imgMatch ? imgMatch[0] : '';
      const cap = (a.caption || body.replace(img, '').replace(/<[^>]+>/g, '').trim()).trim();
      return `\n\n<figure>${img}${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>\n\n`;
    }
    case 'gallery': {
      let items = [];
      if (a.ids) {
        items = a.ids.split(',').map((id) => env.attachmentUrl?.(Number(id.trim()))).filter(Boolean);
      } else {
        items = env.attachmentsOf?.(a.id ? Number(a.id) : postId) || [];
      }
      if (!items.length) {
        env.onNote?.('Галерея [gallery] без доступных вложений');
        return '\n\n<!-- TODO(wp-export): галерея — вложения не найдены -->\n\n';
      }
      env.onShortcode?.('gallery', 'converted');
      return '\n\n' + items.map((i) => `<p><img src="${esc(i.url)}" alt="${esc(i.alt || '')}"></p>`).join('\n') + '\n\n';
    }
    case 'embed':
    case 'youtube':
    case 'vimeo': {
      const url = (inner || a[0] || a.src || a.url || '').trim();
      return url ? `\n\n<p>${esc(url)}</p>\n\n` : '';
    }
    case 'video':
    case 'audio': {
      const src = a.src || a.mp4 || a.webm || a.mp3 || a.m4a || a.ogg;
      if (!src) return '';
      const e = embedHtml(src);
      if (e) return `\n\n<p>${esc(src)}</p>\n\n`;
      return `\n\n<${name} src="${esc(src)}"></${name}>\n\n`;
    }
    case 'playlist':
      env.onShortcode?.(name, 'unknown');
      return '\n\n<!-- TODO(wp-export): плейлист [playlist] не перенесён -->\n\n';
    case 'wpautop': case 'audio-player': case 'su_spacer': case 'clear': case 'spacer':
      return '';
    case 'button':
    case 'su_button': {
      const href = a.url || a.link || a.href;
      const label = (inner || a.text || 'Подробнее').replace(/<[^>]+>/g, '');
      return href ? `\n\n<p><a href="${esc(href)}">${esc(label)}</a></p>\n\n` : undefined;
    }
    case 'reusable_block':
    case 'block': {
      const id = Number(a.id || a.ref);
      const c = env.reusableBlocks?.get(id);
      return c ? '\n\n' + c + '\n\n' : undefined;
    }
    default:
      return undefined;
  }
}

/** Подставляет reusable-блоки и убирает служебные комментарии Gutenberg. */
export function cleanGutenberg(content, env, depth = 0) {
  let t = content;
  t = t.replace(/<!--\s*wp:block\s+(\{[^}]*\})\s*\/-->/g, (_, json) => {
    try {
      const ref = JSON.parse(json).ref;
      const c = env.reusableBlocks?.get(Number(ref));
      if (c != null && depth < 3) return cleanGutenberg(c, env, depth + 1);
    } catch { /* пусто */ }
    return '';
  });
  // wp:html — оставляем внутренности; остальные комментарии блоков убираем
  t = t.replace(/<!--\s*\/?wp:[\s\S]*?-->/g, '');
  t = t.replace(/<!--\s*more[\s\S]*?-->/g, '').replace(/<!--\s*nextpage\s*-->/g, '');
  return t;
}

export function contentToMarkdown(content, env, postId) {
  const isBlocks = /<!--\s*wp:/.test(content);
  let t = cleanGutenberg(content, env);
  t = toHtmlShortcodes(t, env, postId);
  if (!isBlocks) t = wpautop(t);
  else t = wpautop(t); // безопасно: блоки HTML не трогаются, «голый» текст оборачивается в <p>
  return htmlToMarkdown(t, env);
}

export function plainText(md) {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeDescription(md, max = 160) {
  const t = md
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p && !/^(#|!\[|<|\||-|\d+\.|>)/.test(p))
    .map(plainText)
    .find((x) => x.length >= 30);
  if (!t) return '';
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
}
