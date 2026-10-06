import { slugify } from './slug.mjs';
import { decodeSafe, decodeLenient, encodePathStrict } from './util.mjs';

/** Планирование структуры нового сайта: slug-и, пути, меню, таблица старых URL. */

const RESERVED_TOP = new Set(['news', 'admin', 'uploads', 'rss.xml', '404', '_astro', 'api']);
const UNCATEGORIZED = new Set(['uncategorized', 'bez-rubriki', 'без-рубрики', 'bez_rubriki']);

export function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isExportable(p) {
  return p.post_status === 'publish' && !p.protected;
}

export function buildPlan(model, { siteUrl, slugMode = 'translit', log }) {
  const warn = (m) => log?.warn?.(m);
  const site = (siteUrl || model.options.home || model.options.siteurl || '').replace(/\/+$/, '');
  const hosts = new Set([hostOf(site), hostOf(model.options.siteurl), hostOf(model.options.home)].filter(Boolean));
  const plan = {
    site,
    hosts,
    slugMode,
    pages: [],
    posts: [],
    byId: new Map(),
    attachments: new Map(),
    reusableBlocks: new Map(),
    frontPageId: null,
    blogPageId: null,
    drafts: [],
    otherTypes: {},
    slugChanges: [],
    notes: [],
  };

  const all = [...model.posts.values()];

  // вложения
  for (const p of all) {
    if (p.post_type !== 'attachment') continue;
    const file = p.meta._wp_attached_file || (/\/wp-content\/uploads\/(.+)$/.exec(p.guid || '')?.[1] ?? '');
    plan.attachments.set(p.ID, { id: p.ID, file: file ? decodeSafe(file) : '', alt: p.meta._wp_attachment_image_alt || '', title: p.post_title, parent: p.post_parent, menu_order: p.menu_order, post: p });
  }
  for (const p of all) if (p.post_type === 'wp_block' && isExportable(p)) plan.reusableBlocks.set(p.ID, p.post_content);

  // статусы и «прочие типы»
  for (const p of all) {
    if (['post', 'page', 'attachment', 'nav_menu_item', 'wp_block'].includes(p.post_type)) {
      if (['draft', 'pending', 'future', 'auto-draft'].includes(p.post_status) && p.post_type !== 'attachment' && p.post_type !== 'nav_menu_item') {
        plan.drafts.push({ id: p.ID, type: p.post_type, status: p.post_status, title: p.post_title, modified: p.post_modified });
      }
    } else {
      const o = (plan.otherTypes[p.post_type] ||= { total: 0, publish: 0, titles: [] });
      o.total++;
      if (isExportable(p)) {
        o.publish++;
        if (o.titles.length < 20) o.titles.push(p.post_title);
      }
    }
  }

  const frontPageId = model.options.show_on_front === 'page' ? Number(model.options.page_on_front) || null : null;
  const blogPageId = Number(model.options.page_for_posts) || null;
  plan.frontPageId = frontPageId;
  plan.blogPageId = blogPageId;

  // ---- страницы ----
  const pageById = new Map(all.filter((p) => p.post_type === 'page').map((p) => [p.ID, p]));
  const pages = [...pageById.values()].filter(isExportable).filter((p) => p.ID !== blogPageId);
  const exportedIds = new Set(pages.map((p) => p.ID));
  const slugOf = new Map();
  const taken = new Set();

  const baseSlug = (p, fallbackPrefix) => {
    const s = slugify(p.post_name || p.post_title, slugMode) || slugify(p.post_title, slugMode);
    return s || `${fallbackPrefix}-${p.ID}`;
  };

  const relPathOf = (p, seen = new Set()) => {
    if (slugOf.has(p.ID)) return slugOf.get(p.ID);
    if (p.ID === frontPageId) { slugOf.set(p.ID, 'index'); taken.add('index'); return 'index'; }
    seen.add(p.ID);
    let parentPath = '';
    const parent = pageById.get(p.post_parent);
    if (parent && exportedIds.has(parent.ID) && !seen.has(parent.ID) && parent.ID !== frontPageId) parentPath = relPathOf(parent, seen);
    else if (p.post_parent && !exportedIds.has(p.post_parent) && parent && parent.ID !== frontPageId && parent.ID !== blogPageId) {
      warn(`Страница «${p.post_title}» (ID ${p.ID}): родительская страница не опубликована/скрыта — страница будет в корне.`);
    }
    let slug = baseSlug(p, 'page');
    if (!parentPath && RESERVED_TOP.has(slug)) {
      warn(`Slug страницы «${p.post_title}» (${slug}) зарезервирован сайтом — переименован в ${slug}-page.`);
      slug += '-page';
    }
    let rel = parentPath ? `${parentPath}/${slug}` : slug;
    let n = 2;
    while (taken.has(rel.toLowerCase())) rel = `${parentPath ? parentPath + '/' : ''}${slug}-${n++}`;
    taken.add(rel.toLowerCase());
    slugOf.set(p.ID, rel);
    return rel;
  };

  for (const p of pages.sort((a, b) => a.menu_order - b.menu_order || a.ID - b.ID)) {
    const relPath = relPathOf(p);
    const entry = {
      id: p.ID,
      type: 'page',
      post: p,
      slug: relPath.split('/').pop(),
      relPath,
      newPath: relPath === 'index' ? '/' : `/${relPath}/`,
      title: decodeSafe(p.post_title) || relPath,
    };
    plan.pages.push(entry);
    plan.byId.set(p.ID, entry);
    const orig = decodeSafe(p.post_name);
    if (orig && orig !== entry.slug) plan.slugChanges.push({ id: p.ID, type: 'page', from: orig, to: entry.slug });
  }

  // ---- посты ----
  const postTaken = new Set();
  const posts = all.filter((p) => p.post_type === 'post' && isExportable(p)).sort((a, b) => a.post_date.localeCompare(b.post_date) || a.ID - b.ID);
  for (const p of posts) {
    let slug = baseSlug(p, 'post');
    let s = slug;
    let n = 2;
    while (postTaken.has(s)) s = `${slug}-${n++}`;
    postTaken.add(s);
    const entry = { id: p.ID, type: 'post', post: p, slug: s, relPath: s, newPath: `/news/${s}/`, title: decodeSafe(p.post_title) || s };
    plan.posts.push(entry);
    plan.byId.set(p.ID, entry);
    const orig = decodeSafe(p.post_name);
    if (orig && orig !== s) plan.slugChanges.push({ id: p.ID, type: 'post', from: orig, to: s });
  }

  // ---- термины ----
  const termOf = (ttId) => {
    const tt = model.taxonomies.get(ttId);
    return tt ? { ...tt, ...(model.terms.get(tt.term_id) || {}), ttId } : null;
  };
  plan.termsOf = (postId, taxonomy) => (model.relationships.get(postId) || []).map(termOf).filter((t) => t && t.taxonomy === taxonomy);
  plan.categoryChain = (postId) => {
    const cats = plan.termsOf(postId, 'category').sort((a, b) => a.term_id - b.term_id);
    if (!cats.length) return ['uncategorized'];
    const chain = [];
    let cur = cats[0];
    const seen = new Set();
    while (cur && !seen.has(cur.term_id)) {
      seen.add(cur.term_id);
      chain.unshift(decodeSafe(cur.slug));
      const parentTt = [...model.taxonomies.entries()].find(([, t]) => t.taxonomy === 'category' && t.term_id === cur.parent);
      cur = parentTt ? termOf(parentTt[0]) : null;
    }
    return chain;
  };
  plan.categoriesOf = (postId) => plan.termsOf(postId, 'category').filter((t) => !UNCATEGORIZED.has(decodeSafe(t.slug).toLowerCase())).map((t) => decodeSafe(t.name));
  plan.tagsOf = (postId) => plan.termsOf(postId, 'post_tag').map((t) => decodeSafe(t.name));

  plan.allCategories = [...model.taxonomies.entries()].filter(([, t]) => t.taxonomy === 'category').map(([id]) => termOf(id));
  plan.allTags = [...model.taxonomies.entries()].filter(([, t]) => t.taxonomy === 'post_tag').map(([id]) => termOf(id));

  buildMenus(model, plan, termOf);
  return plan;
}

// ---------------------------------------------------------------- меню

function buildMenus(model, plan, termOf) {
  const items = [...model.posts.values()].filter((p) => p.post_type === 'nav_menu_item' && p.post_status === 'publish');
  const menus = new Map(); // ttId → { name, slug, items[] }
  for (const [ttId, tt] of model.taxonomies) {
    if (tt.taxonomy === 'nav_menu') {
      const t = model.terms.get(tt.term_id);
      menus.set(ttId, { termId: tt.term_id, name: t?.name || '', slug: t?.slug || '', items: [] });
    }
  }
  for (const it of items) {
    for (const ttId of model.relationships.get(it.ID) || []) menus.get(ttId)?.items.push(it);
  }
  const theme = model.options.stylesheet;
  const locations = model.options.theme_mods?.[theme]?.nav_menu_locations || {};
  const locOf = (m) => Object.entries(locations).filter(([, tid]) => Number(tid) === m.termId).map(([l]) => l);

  let main = null;
  const list = [...menus.values()].filter((m) => m.items.length);
  const prefer = /primary|main|header|top|menu-1|главн|основн|шапк/i;
  main = list.find((m) => locOf(m).some((l) => prefer.test(l))) || list.find((m) => prefer.test(m.name) || prefer.test(m.slug)) || list.find((m) => locOf(m).length) || list.sort((a, b) => b.items.length - a.items.length)[0] || null;

  const build = (m) => {
    const nodes = new Map();
    for (const it of m.items) {
      const meta = it.meta;
      const type = meta._menu_item_type || 'custom';
      const objectId = Number(meta._menu_item_object_id) || 0;
      const node = {
        id: it.ID,
        parent: Number(meta._menu_item_menu_item_parent) || 0,
        order: it.menu_order,
        type,
        object: meta._menu_item_object || '',
        objectId,
        url: meta._menu_item_url || '',
        label: it.post_title || '',
        children: [],
      };
      nodes.set(it.ID, node);
    }
    const roots = [];
    for (const n of [...nodes.values()].sort((a, b) => a.order - b.order)) {
      const parent = nodes.get(n.parent);
      (parent ? parent.children : roots).push(n);
    }
    return { name: m.name, slug: m.slug, locations: locOf(m), roots, count: nodes.size };
  };

  plan.menus = list.map(build);
  plan.mainMenu = main ? build(main) : null;
}

// ---------------------------------------------------------------- старые URL

export function normalizeKey(pathname) {
  let p = decodeLenient(pathname).toLowerCase();
  p = p.replace(/\/index\.php(?=\/|$)/, '');
  if (!p.startsWith('/')) p = '/' + p;
  if (!p.endsWith('/')) p += '/';
  return p.replace(/\/{2,}/g, '/');
}

const pad = (n) => String(n).padStart(2, '0');

/** Старые «красивые» URL записи по permalink_structure (пути в процентном кодировании). */
export function oldPathsFor(entry, plan, model) {
  const p = entry.post;
  const out = [];
  const structure = model.options.permalink_structure || '';
  // сегмент, который не декодируется (WordPress обрезал post_name посреди %XX), оставляем «как в базе» —
  // именно так он выглядит в настоящем URL
  const encSeg = (s) => {
    const raw = String(s);
    const d = decodeSafe(raw);
    return d === raw && /%[0-9a-f]{2}/i.test(raw) ? raw : encodePathStrict(d);
  };
  if (entry.type === 'post') {
    out.push(`/?p=${p.ID}`);
    if (structure) {
      const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(p.post_date || '');
      if (!m) {
        plan.notes.push(`Пост ${p.ID}: нет даты — старый URL по структуре не построен.`);
        return out;
      }
      if (/%author%/.test(structure)) {
        if (!plan.notes.includes('Структура ссылок содержит %author% — автор не экспортируется, URL постов по структуре не построены (остались /?p=ID).')) plan.notes.push('Структура ссылок содержит %author% — автор не экспортируется, URL постов по структуре не построены (остались /?p=ID).');
        return out;
      }
      const name = encSeg(p.post_name || String(p.ID));
      const url = structure
        .replace(/%year%/g, m[1]).replace(/%monthnum%/g, m[2]).replace(/%day%/g, m[3])
        .replace(/%hour%/g, m[4]).replace(/%minute%/g, m[5]).replace(/%second%/g, m[6])
        .replace(/%post_id%/g, String(p.ID))
        .replace(/%postname%/g, name)
        .replace(/%category%/g, plan.categoryChain(p.ID).map(encSeg).join('/'));
      if (!/%(year|monthnum|day|hour|minute|second|post_id|postname|category|author|pagename)%/.test(url)) out.push(url); // остался неподставленный тег — URL не построить
    }
  } else {
    out.push(`/?page_id=${p.ID}`);
    const chain = [];
    let cur = p;
    const seen = new Set();
    while (cur && !seen.has(cur.ID)) {
      seen.add(cur.ID);
      chain.unshift(encSeg(cur.post_name || String(cur.ID)));
      cur = model.posts.get(cur.post_parent);
    }
    out.push('/' + chain.join('/') + '/');
  }
  if (p.permalink) {
    try {
      const u = new URL(p.permalink);
      if (u.pathname !== '/' && !/^\/\?/.test(u.pathname + u.search) && !out.includes(u.pathname)) out.push(u.pathname);
    } catch { /* не URL */ }
  }
  return out;
}

/** Строит индекс «старый путь → запись» для переписывания ссылок и редиректов. */
export function buildUrlIndex(plan, model) {
  const byPath = new Map();
  const byQuery = new Map(); // 'p:12' → entry
  for (const e of [...plan.pages, ...plan.posts]) {
    for (const old of oldPathsFor(e, plan, model)) {
      const q = /^\/\?(p|page_id)=(\d+)$/.exec(old);
      if (q) byQuery.set(`${q[1] === 'p' ? 'p' : 'p'}:${q[2]}`, e);
      else if (!byPath.has(normalizeKey(old))) byPath.set(normalizeKey(old), e);
    }
  }
  // страница «Записи» (page_for_posts) → лента новостей
  const blog = plan.blogPageId ? model.posts.get(plan.blogPageId) : null;
  if (blog) {
    const synthetic = { id: blog.ID, type: 'page', post: blog, newPath: '/news/', title: blog.post_title, slug: 'news', synthetic: true };
    for (const old of oldPathsFor(synthetic, plan, model)) {
      const q = /^\/\?(p|page_id)=(\d+)$/.exec(old);
      if (q) byQuery.set(`p:${q[2]}`, synthetic);
      else byPath.set(normalizeKey(old), synthetic);
    }
    plan.blogEntry = synthetic;
  }
  // slug → записи (для ссылок вида /slug/ при дата-структуре постоянных ссылок)
  const bySlug = new Map();
  for (const e of [...plan.pages, ...plan.posts]) {
    if (!e.post.post_name) continue;
    const k = normalizeKey('/' + e.post.post_name + '/');
    if (!bySlug.has(k)) bySlug.set(k, []);
    bySlug.get(k).push(e);
  }
  plan.oldPaths = new Map([...plan.pages, ...plan.posts].map((e) => [e.id, oldPathsFor(e, plan, model)]));
  plan.urlIndex = { byPath, byQuery, bySlug };
  return plan.urlIndex;
}
