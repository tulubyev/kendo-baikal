import path from 'node:path';
import { writeFile, encodePathForUrl, decodeSafe } from './util.mjs';
import { decodeEntities } from './html2md.mjs';
import { contentToMarkdown, makeDescription, plainText } from './content.mjs';

/** Frontmatter строго по контракту PLAN.md; значения — JSON-скаляры (валидный YAML). */
export function renderFrontmatter(fields) {
  const lines = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function isoDate(p) {
  const gmt = p.post_date_gmt;
  if (gmt && !gmt.startsWith('0000')) return gmt.replace(' ', 'T') + 'Z';
  return (p.post_date || '').replace(' ', 'T') + (p.post_date ? '' : '');
}
function isoModified(p) {
  const gmt = p.post_modified_gmt;
  if (gmt && !gmt.startsWith('0000')) return gmt.replace(' ', 'T') + 'Z';
  return (p.post_modified || '').replace(' ', 'T');
}

export function buildContent({ model, plan, media, links, ngg = null, outDir, log }) {
  const collected = {
    embeds: [], // { source, kind, url }
    forms: [], // { source, what }
    shortcodes: {}, // name → { kind, sources:Set }
    notes: [], // { source, note }
    manual: new Map(), // source → Set(reasons)
    files: [],
    menuImages: [],
    emptyContent: [],
  };
  const manual = (src, why) => {
    if (!collected.manual.has(src)) collected.manual.set(src, new Set());
    collected.manual.get(src).add(why);
  };

  const attachmentsOf = (postId) =>
    [...plan.attachments.values()]
      .filter((a) => a.parent === postId && a.file)
      .sort((a, b) => a.menu_order - b.menu_order || a.id - b.id)
      .map((a) => ({ url: '/wp-content/uploads/' + encodePathForUrl(a.file), alt: a.alt }));
  const attachmentUrl = (id) => {
    const a = plan.attachments.get(id);
    return a?.file ? { url: '/wp-content/uploads/' + encodePathForUrl(a.file), alt: a.alt } : null;
  };

  const featured = (post, source) => {
    const id = Number(post.meta._thumbnail_id);
    const a = id ? plan.attachments.get(id) : null;
    if (!a?.file) return '';
    const r = media.resolve(a.file, source);
    return encodePathForUrl(r.path);
  };

  const menuPos = new Map(); // page id → order
  if (plan.mainMenu) {
    plan.mainMenu.roots.forEach((n, i) => {
      if (n.type === 'post_type' && plan.byId.has(n.objectId)) menuPos.set(n.objectId, (i + 1) * 10);
    });
  }

  const convert = (e) => {
    const source = `${e.type === 'page' ? 'page' : 'post'}:${e.relPath}`;
    links.setSource(source);
    const env = {
      source,
      ngg,
      takeTodo: links.takeTodo,
      reusableBlocks: plan.reusableBlocks,
      attachmentsOf,
      attachmentUrl,
      rewriteUrl: links.rewriteUrl,
      onEmbed: (x) => collected.embeds.push({ source, ...x }),
      onForm: (x) => {
        collected.forms.push({ source, what: x?.shortcode ? `шорткод [${x.shortcode}]` : 'HTML <form>' });
        manual(source, 'форма');
      },
      onNote: (t) => {
        collected.notes.push({ source, note: t });
        manual(source, t);
      },
      onShortcode: (name, kind) => {
        const s = (collected.shortcodes[name] ||= { kind, sources: new Set() });
        s.sources.add(source);
        if (kind === 'unknown') manual(source, `неизвестный шорткод [${name}]`);
      },
    };
    const md = contentToMarkdown(e.post.post_content || '', env, e.id);
    if (!md.trim()) { collected.emptyContent.push(source); manual(source, 'пустое содержимое'); }
    if ([...md.matchAll(/<iframe src="([^"]+)"/g)].some((m) => !/youtube\.com|player\.vimeo\.com/.test(m[1]))) manual(source, 'есть встраивание (iframe) — проверьте отображение');
    return { md, source };
  };

  const descriptionFor = (p, md) => {
    const ex = stripTags(p.post_excerpt);
    const seo = stripTags(p.meta._yoast_wpseo_metadesc || p.meta.rank_math_description || p.meta._aioseo_description || '');
    return (seo || ex || makeDescription(md)).slice(0, 300);
  };

  for (const e of plan.pages) {
    const { md, source } = convert(e);
    const p = e.post;
    const fm = { title: stripTags(p.post_title) || e.slug, description: descriptionFor(p, md) };
    if (menuPos.has(e.id)) { fm.menu = true; fm.order = menuPos.get(e.id); }
    const img = featured(p, source);
    if (img) fm.image = img;
    const file = path.join('content', 'pages', e.relPath + '.md');
    writeFile(path.join(outDir, file), renderFrontmatter(fm) + '\n' + md);
    collected.files.push({ file, type: 'page', id: e.id, newPath: e.newPath });
  }

  for (const e of plan.posts) {
    const { md, source } = convert(e);
    const p = e.post;
    const date = isoDate(p);
    const fm = { title: stripTags(p.post_title) || e.slug, description: descriptionFor(p, md), date };
    const mod = isoModified(p);
    if (mod && date && mod.slice(0, 10) > date.slice(0, 10)) fm.updated = mod;
    const cats = plan.categoriesOf(e.id);
    if (cats.length) fm.category = cats[0];
    const tags = plan.tagsOf(e.id);
    if (tags.length) fm.tags = tags;
    const cover = featured(p, source);
    if (cover) fm.cover = cover;
    const file = path.join('content', 'posts', e.slug + '.md');
    writeFile(path.join(outDir, file), renderFrontmatter(fm) + '\n' + md);
    collected.files.push({ file, type: 'post', id: e.id, newPath: e.newPath });
  }

  // ---- меню → menu.json ----
  if (plan.mainMenu) {
    links.setSource('menu');
    const conv = (n) => {
      let href = '';
      let label = n.label;
      let kind = 'custom';
      const target = n.type === 'post_type' ? plan.byId.get(n.objectId) : null;
      if (n.type === 'post_type') {
        if (target) { href = target.newPath; kind = target.type; label = label || target.title; }
        else if (plan.blogPageId === n.objectId) { href = '/news/'; kind = 'blog'; label = label || 'Новости'; }
        else { kind = 'unresolved'; label = label || '(запись не опубликована)'; }
      } else if (n.type === 'taxonomy') {
        href = '/news/';
        kind = 'category';
        label = label || decodeSafe(model.terms.get(n.objectId)?.name || '');
      } else {
        href = n.url ? links.rewriteUrl(n.url, 'a') : '';
        if (n.url === '#' || !n.url) kind = 'placeholder';
        else kind = /^https?:\/\//i.test(href) ? 'external' : 'internal';
      }
      return { title: stripTags(label), href, kind, children: n.children.map(conv) };
    };
    collected.menu = { name: plan.mainMenu.name, locations: plan.mainMenu.locations, items: plan.mainMenu.roots.map(conv) };
    writeFile(path.join(outDir, 'design-import', 'menu.json'), JSON.stringify(collected.menu, null, 2) + '\n');
  }

  return collected;
}
