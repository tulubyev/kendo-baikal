import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeFile, walk, safeJoin, formatBytes } from './util.mjs';
import { extractTokens, parseCss } from './css.mjs';
import { parseHtml } from './html2md.mjs';

/**
 * Экспорт дизайна активной темы (и родительской) в <out>/design-import/:
 *   theme/<slug>/…  — CSS, шрифты, нужные картинки (PHP-файлы НЕ копируются)
 *   branding/       — логотип, favicon, иконка сайта
 *   tokens.json, templates.json (+ templates.md)
 */

const SKIP_DIRS = /(^|\/)(node_modules|vendor|\.git|languages|lang|tests?|src\/php|inc|includes)(\/|$)/i;
const FONT_EXT = /\.(woff2?|ttf|otf)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|ico|avif)$/i;
const MAX_COPY_TOTAL = 40 * 1024 * 1024;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function themeInfo(dir) {
  const css = path.join(dir, 'style.css');
  let header = {};
  try {
    const head = fs.readFileSync(css, 'utf8').slice(0, 4000);
    for (const key of ['Theme Name', 'Version', 'Template', 'Description', 'Text Domain', 'Theme URI']) {
      const m = new RegExp(`^[ \\t/*#@]*${key}:\\s*(.+)$`, 'mi').exec(head);
      if (m) header[key] = m[1].trim();
    }
  } catch { /* нет style.css */ }
  return header;
}

export function exportDesign({ wpContent, model, outDir, plan, media, log }) {
  const result = { themes: [], copied: [], tokens: null, templates: [], branding: [], warnings: [], notes: [] };
  const designDir = path.join(outDir, 'design-import');
  ensureDir(designDir);
  if (!wpContent) {
    result.warnings.push('Папка wp-content не указана — дизайн темы не экспортирован.');
    return result;
  }
  const themesRoot = path.join(wpContent, 'themes');
  const child = model.options.stylesheet;
  const parent = model.options.template && model.options.template !== child ? model.options.template : null;
  const chain = [parent, child].filter(Boolean); // родитель сначала, потом дочерняя (перекрывает)
  if (!child) {
    result.warnings.push('В дампе нет опции stylesheet — не удалось определить активную тему.');
    return result;
  }

  let total = 0;
  const cssTexts = [];
  let themeJson = null;
  const templates = [];

  for (const slug of chain) {
    const dir = safeJoin(themesRoot, slug);
    if (!dir || !fs.existsSync(dir)) {
      result.warnings.push(`Тема «${slug}» не найдена в wp-content/themes.`);
      continue;
    }
    const info = themeInfo(dir);
    result.themes.push({ slug, role: slug === child ? (parent ? 'дочерняя' : 'активная') : 'родительская', ...info });
    const dest = path.join(designDir, 'theme', slug);
    const files = walk(dir, { skip: (p, e) => SKIP_DIRS.test(path.relative(dir, p).replace(/\\/g, '/')) });
    const cssRefs = new Set();

    // 1) CSS
    const cssFiles = files.filter((f) => /\.css$/i.test(f));
    const hasNonMin = (f) => !/\.min\.css$/i.test(f) || !cssFiles.includes(f.replace(/\.min\.css$/i, '.css'));
    for (const f of cssFiles.filter(hasNonMin).slice(0, 80)) {
      const st = fs.statSync(f);
      if (st.size > 3 * 1024 * 1024) { result.warnings.push(`CSS слишком велик, пропущен: ${path.relative(dir, f)} (${formatBytes(st.size)})`); continue; }
      const text = fs.readFileSync(f, 'utf8');
      cssTexts.push(text);
      copy(f, path.join(dest, path.relative(dir, f)), st.size);
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)) {
        if (/^(data:|https?:|\/\/)/.test(m[1])) continue;
        const clean = m[1].split(/[?#]/)[0];
        const abs = path.resolve(path.dirname(f), clean);
        if (abs.startsWith(dir)) cssRefs.add(abs);
      }
    }
    // 2) шрифты и файлы, на которые ссылается CSS, + логотипы/иконки/скриншот темы
    for (const f of files) {
      const rel = path.relative(dir, f);
      const st = fs.statSync(f);
      const wanted =
        FONT_EXT.test(f) ||
        (IMG_EXT.test(f) && (cssRefs.has(f) || /(logo|favicon|apple-touch|site-icon|brand|icon)/i.test(path.basename(f)) || /^screenshot\./i.test(rel))) ||
        /^theme\.json$/i.test(rel);
      if (wanted && st.size < 6 * 1024 * 1024) copy(f, path.join(dest, rel), st.size);
    }
    // 3) theme.json
    const tj = readJson(path.join(dir, 'theme.json'));
    if (tj) themeJson = themeJson ? { ...themeJson, ...tj, settings: { ...themeJson.settings, ...tj.settings } } : tj;

    // 4) шаблоны
    for (const f of files) {
      const rel = path.relative(dir, f).replace(/\\/g, '/');
      if (/^(header|footer|front-page|home|index|single|page|archive|sidebar|404|search|category|tag|singular|single-[^/]+|page-[^/]+|template-[^/]+)\.php$/i.test(rel) || /^(templates|template-parts|parts|page-templates|partials)\/.+\.(php|html)$/i.test(rel)) {
        const text = fs.readFileSync(f, 'utf8');
        if (text.length > 400_000) continue;
        templates.push({ theme: slug, file: rel, ...describeTemplate(text, rel) });
      }
    }
  }

  // дополнительный CSS конструкторов (глобальные цвета/шрифты Elementor)
  const extraCss = path.join(wpContent, 'uploads', 'elementor', 'css', 'global.css');
  if (fs.existsSync(extraCss)) {
    cssTexts.push(fs.readFileSync(extraCss, 'utf8'));
    result.notes.push('Использован uploads/elementor/css/global.css для токенов (глобальные цвета/шрифты Elementor).');
  }

  // токены
  const tokens = extractTokens(cssTexts, themeJson);
  tokens.source = { themes: chain, themeJson: !!themeJson, cssFiles: cssTexts.length };
  // относительные пути шрифтов → в design-import/theme/…
  writeFile(path.join(designDir, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n');
  result.tokens = tokens;
  if (!cssTexts.length) result.warnings.push('CSS темы не найден — токены пустые.');

  // шаблоны
  templates.sort((a, b) => a.file.localeCompare(b.file));
  writeFile(path.join(designDir, 'templates.json'), JSON.stringify(templates, null, 2) + '\n');
  writeFile(path.join(designDir, 'templates.md'), renderTemplatesMd(templates));
  result.templates = templates;

  // брендинг
  const theme = model.options.theme_mods?.[child] || {};
  const brand = [];
  const logoId = Number(theme.custom_logo);
  const iconId = Number(model.options.site_icon);
  const take = (id, name) => {
    const a = plan.attachments.get(id);
    if (!a?.file) return;
    const from = safeJoin(path.join(wpContent, 'uploads'), a.file);
    if (from && fs.existsSync(from)) {
      const to = path.join(designDir, 'branding', name + path.extname(a.file).toLowerCase());
      copy(from, to, fs.statSync(from).size);
      brand.push({ role: name, file: path.relative(outDir, to).replace(/\\/g, '/') });
    }
  };
  if (logoId) take(logoId, 'logo');
  if (iconId) take(iconId, 'site-icon');
  // favicon.ico рядом с wp-content (корень сайта), если лежит
  for (const n of ['favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'logo.png', 'logo.svg']) {
    const f = path.join(path.dirname(wpContent), n);
    if (fs.existsSync(f)) {
      const to = path.join(designDir, 'branding', n);
      copy(f, to, fs.statSync(f).size);
      brand.push({ role: n, file: path.relative(outDir, to).replace(/\\/g, '/') });
    }
  }
  if (!brand.length) result.notes.push('Логотип/favicon в настройках темы не найдены — возьмите их из старого сайта вручную.');
  result.branding = brand;

  function copy(from, to, size) {
    if (total + size > MAX_COPY_TOTAL) {
      if (!result.warnings.some((w) => w.startsWith('Лимит'))) result.warnings.push('Лимит копирования дизайна (40 МБ) достигнут — часть файлов темы пропущена.');
      return;
    }
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
    total += size;
    result.copied.push({ file: path.relative(outDir, to).replace(/\\/g, '/'), size });
  }

  writeFile(path.join(designDir, 'README.md'), readme(result, chain));
  return result;
}

// ------------------------------------------------------------ шаблоны

const WP_FUNCS = [
  [/wp_nav_menu\s*\(([^;]*)\)/s, (m) => `menu:${/theme_location['"]?\s*=>\s*['"]([^'"]+)/.exec(m[1])?.[1] || 'default'}`],
  [/the_custom_logo\s*\(/, () => 'logo'],
  [/get_header\s*\(/, () => 'include:header'],
  [/get_footer\s*\(/, () => 'include:footer'],
  [/get_sidebar\s*\(/, () => 'include:sidebar'],
  [/get_template_part\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/, (m) => `part:${m[1]}${m[2] ? '-' + m[2] : ''}`],
  [/dynamic_sidebar\s*\(\s*['"]([^'"]+)/, (m) => `widgets:${m[1]}`],
  [/the_content\s*\(|get_the_content/, () => 'content'],
  [/the_excerpt\s*\(/, () => 'excerpt'],
  [/the_title\s*\(|get_the_title/, () => 'title'],
  [/the_post_thumbnail|get_the_post_thumbnail|has_post_thumbnail/, () => 'thumbnail'],
  [/have_posts\s*\(|while\s*\(\s*have_posts|new\s+WP_Query|get_posts\s*\(/, () => 'loop'],
  [/get_search_form|get_product_search_form/, () => 'search'],
  [/bloginfo\s*\(|get_bloginfo|get_option\(\s*['"]blogname/, () => 'site-info'],
  [/the_posts_pagination|the_posts_navigation|paginate_links|next_posts_link/, () => 'pagination'],
  [/comments_template|comment_form/, () => 'comments'],
  [/the_date|get_the_date|the_time|get_the_time/, () => 'date'],
  [/the_category|get_the_category|the_tags|get_the_tag_list/, () => 'taxonomy'],
  [/wp_head\s*\(/, () => null],
  [/wp_footer\s*\(/, () => null],
];

function describeTemplate(text, rel) {
  const isBlockHtml = /\.html$/i.test(rel);
  const includes = [];
  const hooks = new Set();
  let html = text;
  if (!isBlockHtml) {
    html = text.replace(/<\?(?:php|=)?([\s\S]*?)(?:\?>|$)/g, (_, code) => {
      const tokens = [];
      for (const [re, fn] of WP_FUNCS) {
        const m = re.exec(code);
        if (m) {
          const t = fn(m);
          if (t) tokens.push(t);
        }
      }
      tokens.forEach((t) => (t.startsWith('include:') || t.startsWith('part:') ? includes.push(t) : hooks.add(t)));
      return tokens.length ? `<wpx-slot data-t="${tokens.join(' ')}"></wpx-slot>` : '';
    });
    const outline = outlineHtml(html);
    return { kind: 'php', includes: [...new Set(includes)], slots: [...hooks], outline };
  }
  // блочные темы: структура по комментариям wp:*
  const lines = [];
  let depth = 0;
  for (const m of text.matchAll(/<!--\s*(\/)?wp:([\w/-]+)(?:\s+(\{[^]*?\}))?\s*(\/)?-->/g)) {
    if (m[1]) { depth = Math.max(0, depth - 1); continue; }
    let extra = '';
    try { const j = m[3] && JSON.parse(m[3]); if (j?.slug) extra = ` (${j.slug})`; else if (j?.tagName) extra = ` <${j.tagName}>`; } catch { /* нет */ }
    lines.push(`${'  '.repeat(depth)}${m[2]}${extra}`);
    if (!m[4]) depth++;
  }
  return { kind: 'block', includes: [], slots: [], outline: lines.slice(0, 80) };
}

const LANDMARKS = new Set(['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form', 'ul', 'ol', 'h1', 'h2', 'img', 'figure', 'a', 'button', 'wpx-slot']);

function outlineHtml(html) {
  const root = parseHtml(html);
  const lines = [];
  const walkNode = (n, depth) => {
    if (n.type !== 'el') return;
    const cls = (n.attrs.class || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const id = n.attrs.id;
    const interesting = (LANDMARKS.has(n.tag) && n.tag !== 'a' && n.tag !== 'img') || (n.tag === 'div' && (cls || id));
    if (n.tag === 'wpx-slot') {
      lines.push(`${'  '.repeat(depth)}⟨${n.attrs['data-t']}⟩`);
      return;
    }
    if (interesting && depth < 8 && lines.length < 120) {
      lines.push(`${'  '.repeat(depth)}<${n.tag}${cls ? '.' + cls : ''}${id ? '#' + id : ''}>`);
      for (const ch of n.children) walkNode(ch, depth + 1);
    } else {
      for (const ch of n.children) walkNode(ch, depth);
    }
  };
  for (const ch of root.children) walkNode(ch, 0);
  return lines;
}

function renderTemplatesMd(templates) {
  const out = ['# Шаблоны темы (структура)', '', 'Автоматически составлено из PHP/HTML-шаблонов. ⟨…⟩ — динамические вставки WordPress (меню, контент, виджеты). PHP-код не копируется.', ''];
  for (const t of templates) {
    out.push(`## ${t.theme}/${t.file}`, '');
    if (t.includes.length) out.push(`Подключает: ${t.includes.join(', ')}`, '');
    if (t.slots.length) out.push(`Вставки: ${t.slots.join(', ')}`, '');
    if (t.outline.length) out.push('```', ...t.outline, '```', '');
  }
  return out.join('\n');
}

function readme(r, chain) {
  return `# design-import

Автоматически собрано инструментом wp-export из активной темы WordPress (${chain.join(' → ')}).

- \`tokens.json\` — цвета, шрифты, размеры, радиусы, ширина контейнера (эвристики по CSS и theme.json).
- \`templates.md\` / \`templates.json\` — структура шаблонов темы (header/footer/главная/запись/страница).
- \`theme/<тема>/\` — CSS темы, шрифты, нужные картинки. PHP не копируется.
- \`branding/\` — логотип, иконка сайта, favicon (если найдены).
- \`screenshots/\` — скриншоты старого сайта (если запускали с \`--screenshots-from\`).

Это материал для переноса дизайна в Astro, не готовые стили: значения нужно проверить глазами.
`;
}
