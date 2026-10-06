/** Компактный разбор CSS для извлечения дизайн-токенов (без зависимостей). */

export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitDecls(body) {
  const decls = [];
  let cur = '';
  let paren = 0;
  let q = '';
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(') paren++;
    if (ch === ')') paren--;
    if (ch === ';' && paren <= 0) { decls.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) decls.push(cur);
  const out = [];
  for (const d of decls) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    out.push([d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).replace(/!important/i, '').trim()]);
  }
  return out;
}

/** → { rules:[{selector, decls:[[prop,val]], media}], fontFaces:[{family, src:[url], weight, style}] } */
export function parseCss(source) {
  const css = stripComments(source);
  const rules = [];
  const fontFaces = [];
  const parse = (text, media) => {
    let i = 0;
    const n = text.length;
    while (i < n) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      // найти парную }
      let depth = 1;
      let j = open + 1;
      let q = '';
      for (; j < n && depth > 0; j++) {
        const ch = text[j];
        if (q) { if (ch === q && text[j - 1] !== '\\') q = ''; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      const body = text.slice(open + 1, j - 1);
      i = j;
      const stmt = head.split(';').pop().trim(); // отбросить @import/@charset перед правилом
      if (/^@(media|supports|layer|container)/i.test(stmt)) parse(body, stmt);
      else if (/^@font-face/i.test(stmt)) {
        const d = Object.fromEntries(splitDecls(body));
        const fam = (d['font-family'] || '').replace(/["']/g, '').trim();
        const urls = [...(d.src || '').matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)].map((m) => m[1]);
        if (fam) fontFaces.push({ family: fam, src: urls, weight: d['font-weight'] || '', style: d['font-style'] || '' });
      } else if (/^@/.test(stmt)) continue; // keyframes и т.п.
      else if (stmt) rules.push({ selector: stmt, decls: splitDecls(body), media });
    }
  };
  parse(css, '');
  return { rules, fontFaces };
}

// ---- цвета ----
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const RGB = /rgba?\(\s*[\d.\s,%/]+\)/gi;
const HSL = /hsla?\(\s*[\d.\s,%/deg]+\)/gi;

export function normalizeColor(c) {
  c = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(c);
  if (m) return '#' + [...m[1]].map((x) => x + x).join('');
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c)) return c.length === 9 && c.endsWith('ff') ? c.slice(0, 7) : c;
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(c);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)));
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return a >= 1 ? hex : `rgba(${r}, ${g}, ${b}, ${+a.toFixed(2)})`;
  }
  return c;
}

export function findColors(value) {
  const found = [];
  for (const re of [HEX, RGB, HSL]) for (const m of value.matchAll(re)) found.push(normalizeColor(m[0]));
  return found;
}

export function isGray(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(hex);
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

export function saturation(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return Math.max(r, g, b) - Math.min(r, g, b);
}

const COLOR_PROPS = /^(color|background|background-color|border|border-color|border-top|border-bottom|border-left|border-right|border-top-color|border-bottom-color|outline|outline-color|fill|stroke|text-decoration-color|box-shadow|text-shadow|background-image)$/;

function freq() {
  const m = new Map();
  return { add: (k, w = 1) => m.set(k, (m.get(k) || 0) + w), top: (n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n), map: m };
}

/** Собирает токены из набора CSS-файлов (+ theme.json). */
export function extractTokens(cssTexts, themeJson) {
  const vars = {};
  const colors = freq();
  const families = freq();
  const radii = freq();
  const fontFaces = [];
  const roles = {};
  const sizes = {};
  const containers = freq();
  const buttonBg = freq();
  const fontSizes = freq();
  const lineHeights = freq();

  const resolveVar = (v, depth = 0) => {
    if (depth > 4) return v;
    return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fb) => (vars[name] != null ? resolveVar(vars[name], depth + 1) : fb ?? ''));
  };

  const parsed = cssTexts.map(parseCss);
  // переменные
  for (const { rules } of parsed) {
    for (const r of rules) {
      if (/^(:root|html|body|\.?editor-styles-wrapper)\b/.test(r.selector) || r.selector === ':root') {
        for (const [p, v] of r.decls) if (p.startsWith('--')) vars[p] = v;
      }
    }
  }
  for (const { rules, fontFaces: ff } of parsed) {
    fontFaces.push(...ff);
    for (const r of rules) {
      const sels = r.selector.split(',').map((s) => s.trim());
      const decl = Object.fromEntries(r.decls.map(([p, v]) => [p, resolveVar(v)]));
      for (const [p, raw] of Object.entries(decl)) {
        if (COLOR_PROPS.test(p) && p !== 'box-shadow' && p !== 'text-shadow') for (const col of findColors(raw)) colors.add(col);
        if (p === 'font-family') families.add(raw.split(',')[0].replace(/["']/g, '').trim());
        if (p === 'border-radius' || /^border-(top|bottom)-(left|right)-radius$/.test(p)) {
          const first = raw.split(/\s+/)[0];
          if (/^[\d.]+(px|rem|em|%)$/.test(first)) radii.add(first);
        }
        if (p === 'font-size' && !r.media) fontSizes.add(raw);
        if (p === 'line-height' && /^body|html/.test(sels[0])) lineHeights.add(raw);
        if (p === 'max-width' && /^[\d.]+(px|rem|em)$/.test(raw) && sels.some((s) => /container|wrapper|\.wrap\b|site-content|content-area|inner|boxed|site-main|page-content|entry-content|\.row\b/i.test(s))) containers.add(raw);
        if (p === 'width' && /^[\d.]+px$/.test(raw) && sels.some((s) => /(^|[\s.#])(container|wrapper|wrap)$/i.test(s))) containers.add(raw);
      }
      for (const s of sels) {
        const bg = decl['background-color'] || decl.background;
        const cols = bg ? findColors(bg) : [];
        if (/^body$/.test(s) || s === 'html') {
          if (cols[0] && !roles.background) roles.background = cols[0];
          if (decl.color) { const c = findColors(decl.color)[0]; if (c && !roles.text) roles.text = c; }
          if (decl['font-family']) roles.bodyFont = decl['font-family'];
          if (decl['font-size']) sizes.body = decl['font-size'];
          if (decl['line-height']) sizes.bodyLineHeight = decl['line-height'];
        }
        if (s === 'a' || s === 'a:link') { const c = decl.color && findColors(decl.color)[0]; if (c && !roles.link) roles.link = c; }
        if (/^a:(hover|focus)$/.test(s)) { const c = decl.color && findColors(decl.color)[0]; if (c && !roles.linkHover) roles.linkHover = c; }
        if (/^h[1-6]$/.test(s)) {
          if (decl['font-size']) sizes[s] = decl['font-size'];
          if (decl['font-family']) roles.headingFont ||= decl['font-family'];
          const c = decl.color && findColors(decl.color)[0];
          if (c) roles.heading ||= c;
        }
        if (/(^|\s|\.)(button|btn|wp-block-button__link|wp-element-button|submit)\b|^button|input\[type=["']?submit/i.test(s) && !/:hover|:focus|:active/.test(s)) {
          for (const c of cols) buttonBg.add(c);
        }
        if (/header|masthead/i.test(s) && !/:hover/.test(s) && cols[0]) roles.header ||= cols[0];
        if (/footer/i.test(s) && !/:hover/.test(s) && cols[0]) roles.footer ||= cols[0];
      }
    }
  }

  const palette = colors.top(24).map(([value, count]) => ({ value, count }));
  const chromatic = palette.filter((c) => c.value.startsWith('#') && !isGray(c.value)).sort((a, b) => b.count * (1 + saturation(b.value) / 255) - a.count * (1 + saturation(a.value) / 255));
  const accent = buttonBg.top(1)[0]?.[0] || chromatic[0]?.value || null;

  const tokens = {
    colors: {
      background: roles.background || null,
      text: roles.text || null,
      heading: roles.heading || null,
      link: roles.link || null,
      linkHover: roles.linkHover || null,
      accent,
      header: roles.header || null,
      footer: roles.footer || null,
      palette,
    },
    fonts: {
      body: roles.bodyFont || families.top(1)[0]?.[0] || null,
      heading: roles.headingFont || null,
      families: families.top(10).map(([family, count]) => ({ family, count })),
      fontFaces: dedupeFaces(fontFaces),
    },
    sizes: {
      body: sizes.body || null,
      lineHeight: sizes.bodyLineHeight || lineHeights.top(1)[0]?.[0] || null,
      h1: sizes.h1 || null, h2: sizes.h2 || null, h3: sizes.h3 || null, h4: sizes.h4 || null, h5: sizes.h5 || null, h6: sizes.h6 || null,
      common: fontSizes.top(8).map(([value, count]) => ({ value, count })),
    },
    radius: { common: radii.top(5).map(([value, count]) => ({ value, count })), default: radii.top(1)[0]?.[0] || null },
    container: { maxWidth: pickContainer(containers.top(5)), candidates: containers.top(5).map(([value, count]) => ({ value, count })) },
    cssVariables: Object.fromEntries(Object.entries(vars).filter(([k]) => !/^--wp--preset--(font-size|spacing|shadow|gradient)/.test(k)).slice(0, 120)),
  };

  if (themeJson) {
    const s = themeJson.settings || {};
    tokens.themeJson = {
      palette: (s.color?.palette || []).map((c) => ({ slug: c.slug, name: c.name, color: c.color })),
      gradients: (s.color?.gradients || []).slice(0, 8).map((g) => ({ slug: g.slug, gradient: g.gradient })),
      fontFamilies: (s.typography?.fontFamilies || []).map((f) => ({ slug: f.slug, name: f.name, fontFamily: f.fontFamily, fontFace: (f.fontFace || []).map((x) => x.src).flat?.() })),
      fontSizes: (s.typography?.fontSizes || []).map((f) => ({ slug: f.slug, size: f.size })),
      layout: s.layout || null,
      spacing: s.spacing?.spacingSizes?.map((x) => ({ slug: x.slug, size: x.size })) || null,
    };
    if (s.layout?.contentSize) tokens.container.contentSize = s.layout.contentSize;
    if (s.layout?.wideSize) tokens.container.wideSize = s.layout.wideSize;
    if (!tokens.container.maxWidth && s.layout?.wideSize) tokens.container.maxWidth = s.layout.wideSize;
    const pal = s.color?.palette || [];
    const bySlug = (re) => pal.find((c) => re.test(c.slug))?.color;
    tokens.colors.background ||= bySlug(/background|base|white/);
    tokens.colors.text ||= bySlug(/foreground|contrast|text|black/);
    tokens.colors.accent ||= bySlug(/primary|accent|brand/);
    if (themeJson.styles?.color?.background) tokens.colors.background = themeJson.styles.color.background;
    if (themeJson.styles?.color?.text) tokens.colors.text = themeJson.styles.color.text;
  }
  return tokens;
}

function pickContainer(top) {
  const px = top.map(([v, c]) => ({ v, px: toPx(v), c })).filter((x) => x.px >= 600 && x.px <= 1920);
  if (!px.length) return null;
  px.sort((a, b) => b.c - a.c || b.px - a.px);
  return px[0].v;
}
function toPx(v) {
  const m = /^([\d.]+)(px|rem|em)$/.exec(v);
  if (!m) return 0;
  return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
}
function dedupeFaces(faces) {
  const seen = new Set();
  return faces.filter((f) => {
    const k = `${f.family}|${f.weight}|${f.style}|${f.src.join(',')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 60);
}
