import { readStatements, parseCreateTable, parseInsert } from './sql.mjs';
import { phpUnserialize, phpList } from './php.mjs';

/**
 * Загрузка данных WordPress из mysqldump → единая модель (см. emptyModel()).
 * Пользователей, комментарии и их метаданные НЕ читаем в модель; из wp_users берём только
 * «канарейки» (e-mail, хэши) в память — чтобы потом убедиться, что их нет в выводе.
 */

const TABLE_RE = /^(.*?)(postmeta|posts|options|terms|term_taxonomy|term_relationships|users)$/;

const DEFAULT_COLUMNS = {
  posts: ['ID', 'post_author', 'post_date', 'post_date_gmt', 'post_content', 'post_title', 'post_excerpt', 'post_status', 'comment_status', 'ping_status', 'post_password', 'post_name', 'to_ping', 'pinged', 'post_modified', 'post_modified_gmt', 'post_content_filtered', 'post_parent', 'guid', 'menu_order', 'post_type', 'post_mime_type', 'comment_count'],
  postmeta: ['meta_id', 'post_id', 'meta_key', 'meta_value'],
  options: ['option_id', 'option_name', 'option_value', 'autoload'],
  terms: ['term_id', 'name', 'slug', 'term_group'],
  term_taxonomy: ['term_taxonomy_id', 'term_id', 'taxonomy', 'description', 'parent', 'count'],
  term_relationships: ['object_id', 'term_taxonomy_id', 'term_order'],
  users: ['ID', 'user_login', 'user_pass', 'user_nicename', 'user_email', 'user_url', 'user_registered', 'user_activation_key', 'user_status', 'display_name'],
};

export const META_KEYS = new Set([
  '_thumbnail_id', '_wp_attached_file', '_wp_attachment_image_alt', '_wp_page_template',
  '_yoast_wpseo_metadesc', '_yoast_wpseo_title', 'rank_math_description', '_aioseo_description',
  '_menu_item_type', '_menu_item_menu_item_parent', '_menu_item_object', '_menu_item_object_id', '_menu_item_url',
]);

const OPTION_KEYS = new Set([
  'siteurl', 'home', 'blogname', 'blogdescription', 'active_plugins', 'stylesheet', 'template',
  'permalink_structure', 'page_on_front', 'page_for_posts', 'show_on_front', 'category_base', 'tag_base',
  'site_icon', 'WPLANG', 'timezone_string', 'gmt_offset',
]);

const FULL_TYPES = new Set(['post', 'page', 'attachment', 'nav_menu_item', 'wp_block']);
const SKIP_TYPES = new Set(['revision', 'auto-draft', 'customize_changeset', 'oembed_cache', 'wp_global_styles', 'wp_navigation', 'user_request', 'scheduled-action', 'wp_template', 'wp_template_part']);
const PRIVATE_TYPE_RE = /^(shop_order|shop_subscription|shop_coupon|shop_refund|wc_|shop_webhook|woocommerce_|bp-|bbp_|reply$)/i;

export function emptyModel() {
  return {
    source: 'sql',
    prefix: '',
    options: {},
    posts: new Map(),
    terms: new Map(),
    taxonomies: new Map(), // term_taxonomy_id → { term_id, taxonomy, parent, count }
    relationships: new Map(), // object_id → [term_taxonomy_id]
    counts: { skipped: {}, protected: 0, private: 0, trashed: 0 },
    canaries: { emails: new Set(), hashes: new Set() },
    userCount: 0,
  };
}

export function tidyPost(row) {
  return {
    ID: Number(row.ID),
    post_type: row.post_type,
    post_status: row.post_status,
    post_name: row.post_name || '',
    post_title: row.post_title || '',
    post_content: row.post_content || '',
    post_excerpt: row.post_excerpt || '',
    post_date: row.post_date || '',
    post_date_gmt: row.post_date_gmt || '',
    post_modified: row.post_modified || '',
    post_modified_gmt: row.post_modified_gmt || '',
    post_parent: Number(row.post_parent) || 0,
    menu_order: Number(row.menu_order) || 0,
    guid: row.guid || '',
    post_mime_type: row.post_mime_type || '',
    meta: row.meta || {},
    permalink: row.permalink || '',
  };
}

export async function loadSql(file, { prefix: forcedPrefix, log } = {}) {
  const columnsByTable = new Map();
  const wanted = (table, kind) => {
    if (kind === 'create') return TABLE_RE.test(table);
    return TABLE_RE.test(table);
  };

  const raw = new Map(); // prefix → { suffix → rows[] }
  const bucket = (prefix) => {
    if (!raw.has(prefix)) raw.set(prefix, {});
    return raw.get(prefix);
  };

  for await (const stmt of readStatements(file, wanted)) {
    if (/^\s*CREATE/i.test(stmt)) {
      const ct = parseCreateTable(stmt);
      if (ct) columnsByTable.set(ct.table, ct.columns);
      continue;
    }
    const ins = parseInsert(stmt);
    if (!ins) continue;
    const m = TABLE_RE.exec(ins.table);
    if (!m) continue;
    const [, prefix, suffix] = m;
    const cols = ins.columns || columnsByTable.get(ins.table) || DEFAULT_COLUMNS[suffix];
    const b = bucket(prefix);
    const list = (b[suffix] ||= []);
    for (const r of ins.rows) {
      const o = {};
      for (let i = 0; i < cols.length; i++) o[cols[i]] = r[i] ?? null;
      const slim = slimRow(suffix, o);
      if (slim) list.push(slim);
    }
  }

  // выбор префикса: тот, где есть options.siteurl и больше всего постов
  let best = null;
  let bestScore = -1;
  for (const [prefix, b] of raw) {
    if (forcedPrefix != null) {
      if (prefix === forcedPrefix) best = prefix;
      continue;
    }
    const hasSite = (b.options || []).some((o) => o.option_name === 'siteurl');
    const score = (hasSite ? 1e9 : 0) + (b.posts?.length || 0);
    if (score > bestScore) {
      bestScore = score;
      best = prefix;
    }
  }
  if (best == null) throw new Error('В дампе не найдены таблицы WordPress (posts/options). Проверьте файл и параметр --prefix.');
  if (raw.size > 1) log?.info?.(`В дампе несколько наборов таблиц WordPress (${[...raw.keys()].map((p) => `«${p}»`).join(', ')}); выбран префикс «${best}».`);

  return buildModel(raw.get(best), best);
}

function slimRow(suffix, o) {
  switch (suffix) {
    case 'postmeta':
      return META_KEYS.has(o.meta_key) ? { post_id: Number(o.post_id), key: o.meta_key, value: o.meta_value } : null;
    case 'options': {
      const n = o.option_name;
      if (OPTION_KEYS.has(n) || n.startsWith('theme_mods_')) return { option_name: n, option_value: o.option_value };
      return null;
    }
    case 'users':
      return { user_email: o.user_email, user_pass: o.user_pass, user_activation_key: o.user_activation_key };
    case 'posts': {
      const type = o.post_type;
      if (SKIP_TYPES.has(type)) return { skipped: type };
      if (o.post_status === 'auto-draft') return { skipped: 'auto-draft' };
      const full = FULL_TYPES.has(type);
      const status = o.post_status;
      const prot = !!o.post_password;
      const light = type === 'attachment' || !full || status !== 'publish' || prot;
      const row = { ...o };
      if (light) {
        row.post_content = '';
        row.post_excerpt = '';
        if (type !== 'attachment') row.guid = '';
      }
      if (PRIVATE_TYPE_RE.test(type)) return { skipped: type };
      row.__protected = prot;
      return row;
    }
    default:
      return o;
  }
}

export function buildModel(b, prefix) {
  const model = emptyModel();
  model.prefix = prefix;

  for (const o of b.options || []) {
    if (o.option_name === 'active_plugins') model.options.active_plugins = phpList(phpUnserialize(o.option_value)).map(String);
    else if (o.option_name.startsWith('theme_mods_')) (model.options.theme_mods ||= {})[o.option_name.slice(11)] = phpUnserialize(o.option_value) || {};
    else model.options[o.option_name] = o.option_value;
  }

  const meta = new Map();
  for (const m of b.postmeta || []) {
    if (!meta.has(m.post_id)) meta.set(m.post_id, {});
    meta.get(m.post_id)[m.key] = m.value;
  }

  for (const r of b.posts || []) {
    if (r.skipped) {
      model.counts.skipped[r.skipped] = (model.counts.skipped[r.skipped] || 0) + 1;
      continue;
    }
    if (r.post_status === 'trash') {
      model.counts.trashed++;
      continue;
    }
    const p = tidyPost({ ...r, meta: meta.get(Number(r.ID)) || {} });
    if (r.__protected) {
      p.protected = true;
      model.counts.protected++;
    }
    if (r.post_status === 'private') model.counts.private++;
    model.posts.set(p.ID, p);
  }

  for (const t of b.terms || []) model.terms.set(Number(t.term_id), { term_id: Number(t.term_id), name: t.name, slug: t.slug });
  for (const t of b.term_taxonomy || []) {
    model.taxonomies.set(Number(t.term_taxonomy_id), { term_id: Number(t.term_id), taxonomy: t.taxonomy, parent: Number(t.parent) || 0 });
  }
  for (const r of b.term_relationships || []) {
    const id = Number(r.object_id);
    if (!model.relationships.has(id)) model.relationships.set(id, []);
    model.relationships.get(id).push(Number(r.term_taxonomy_id));
  }

  for (const u of b.users || []) {
    model.userCount++;
    if (u.user_email) model.canaries.emails.add(String(u.user_email).toLowerCase());
    if (u.user_pass && u.user_pass.length > 8) model.canaries.hashes.add(u.user_pass);
    if (u.user_activation_key && u.user_activation_key.length > 8) model.canaries.hashes.add(u.user_activation_key);
  }
  return model;
}
