import fs from 'node:fs';
import { emptyModel, tidyPost } from './wpdata.mjs';
import { decodeEntities } from './html2md.mjs';

/** Запасной вход: файл WordPress → Инструменты → Экспорт (WXR). Авторы (wp:author) игнорируются. */

function cdata(s) {
  if (s == null) return '';
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return m ? m[1] : decodeEntities(s);
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`);
  const m = re.exec(block);
  return m ? cdata(m[1]) : '';
}

export function loadWxr(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const model = emptyModel();
  model.source = 'wxr';
  model.options.siteurl = tag(xml.split('<item>')[0], 'wp:base_site_url') || tag(xml.split('<item>')[0], 'link');
  model.options.home = tag(xml.split('<item>')[0], 'wp:base_blog_url') || model.options.siteurl;
  model.options.blogname = tag(xml.split('<item>')[0], 'title');
  model.options.blogdescription = tag(xml.split('<item>')[0], 'description');

  const ttBySlug = new Map();
  let nextTt = 1;
  const getTt = (taxonomy, slug, name) => {
    const k = `${taxonomy}:${slug}`;
    if (!ttBySlug.has(k)) {
      const id = nextTt++;
      ttBySlug.set(k, id);
      model.terms.set(id, { term_id: id, name: name || slug, slug });
      model.taxonomies.set(id, { term_id: id, taxonomy, parent: 0 });
    }
    return ttBySlug.get(k);
  };

  for (const block of xml.split('<item>').slice(1)) {
    const item = block.split('</item>')[0];
    const type = tag(item, 'wp:post_type');
    const status = tag(item, 'wp:status');
    if (['revision', 'auto-draft', 'customize_changeset', 'oembed_cache', 'wp_global_styles'].includes(type)) {
      model.counts.skipped[type] = (model.counts.skipped[type] || 0) + 1;
      continue;
    }
    if (status === 'trash') { model.counts.trashed++; continue; }
    const password = tag(item, 'wp:post_password');
    const full = ['post', 'page', 'attachment', 'nav_menu_item', 'wp_block'].includes(type) && status === 'publish' && !password;
    const meta = {};
    for (const m of item.matchAll(/<wp:postmeta>([\s\S]*?)<\/wp:postmeta>/g)) {
      meta[tag(m[1], 'wp:meta_key')] = tag(m[1], 'wp:meta_value');
    }
    const keepMeta = {};
    for (const k of ['_thumbnail_id', '_wp_attached_file', '_wp_attachment_image_alt', '_menu_item_type', '_menu_item_menu_item_parent', '_menu_item_object', '_menu_item_object_id', '_menu_item_url', '_yoast_wpseo_metadesc', 'rank_math_description']) {
      if (meta[k] != null) keepMeta[k] = meta[k];
    }
    const id = Number(tag(item, 'wp:post_id'));
    const attachmentUrl = tag(item, 'wp:attachment_url');
    const post = tidyPost({
      ID: id,
      post_type: type,
      post_status: status,
      post_name: tag(item, 'wp:post_name'),
      post_title: tag(item, 'title'),
      post_content: full ? tag(item, 'content:encoded') : '',
      post_excerpt: full ? tag(item, 'excerpt:encoded') : '',
      post_date: tag(item, 'wp:post_date'),
      post_date_gmt: tag(item, 'wp:post_date_gmt'),
      post_modified: tag(item, 'wp:post_modified'),
      post_modified_gmt: tag(item, 'wp:post_modified_gmt'),
      post_parent: tag(item, 'wp:post_parent'),
      menu_order: tag(item, 'wp:menu_order'),
      guid: type === 'attachment' ? attachmentUrl : '',
      post_mime_type: '',
      meta: keepMeta,
      permalink: tag(item, 'link'),
    });
    if (type === 'attachment' && attachmentUrl && !post.meta._wp_attached_file) {
      const m = /\/wp-content\/uploads\/(.+)$/.exec(attachmentUrl);
      if (m) post.meta._wp_attached_file = m[1];
    }
    if (password) { post.protected = true; model.counts.protected++; }
    if (status === 'private') model.counts.private++;
    model.posts.set(id, post);
    const tts = [];
    for (const c of item.matchAll(/<category\s+domain="([^"]+)"\s+nicename="([^"]*)"[^>]*>([\s\S]*?)<\/category>/g)) {
      tts.push(getTt(c[1], decodeEntities(c[2]), cdata(c[3])));
    }
    if (tts.length) model.relationships.set(id, tts);
  }
  return model;
}
