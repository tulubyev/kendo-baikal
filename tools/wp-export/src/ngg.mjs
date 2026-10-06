import fs from 'node:fs';
import path from 'node:path';
import { safeJoin, encodePathForUrl } from './util.mjs';
import { slugify } from './slug.mjs';
import { decodeEntities } from './html2md.mjs';

/**
 * NextGEN Gallery: шорткоды [nggallery], [ngg], [ngg_images], [singlepic], [slideshow], [album] →
 * список изображений в Markdown. Фото копируются в public/uploads/gallery/<slug галереи>/,
 * миниатюры (thumbs/, dynamic/) не копируются.
 */

const NAMES = new Set(['nggallery', 'ngg', 'ngg_images', 'singlepic', 'slideshow', 'album', 'nggalbum']);
export const isNggShortcode = (name) => NAMES.has(String(name).toLowerCase());

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const ids = (v) => String(v ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const oneLine = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function createNgg({ model, media, wpContentDir, slugMode = 'translit' }) {
  const ngg = model.ngg;
  if (!ngg || (!ngg.galleries.size && !ngg.pictures.size && !ngg.albums.size)) return null;

  const slugOfGid = new Map();
  const takenSlugs = new Set();
  const gallerySlug = (g) => {
    if (slugOfGid.has(g.gid)) return slugOfGid.get(g.gid);
    let base = slugify(g.slug || g.title || g.name, slugMode) || `gallery-${g.gid}`;
    let s = base;
    let n = 2;
    while (takenSlugs.has(s)) s = `${base}-${n++}`;
    takenSlugs.add(s);
    slugOfGid.set(g.gid, s);
    return s;
  };

  const usage = new Map(); // gid → { usedBy:Set, copied:number, missing:[] }
  const use = (gid) => {
    if (!usage.has(gid)) usage.set(gid, { usedBy: new Set(), copied: 0, missing: [], seen: new Set() });
    return usage.get(gid);
  };
  const notFound = []; // { what, id, source }
  const unsupported = []; // { what, source }

  const picById = new Map();
  for (const list of ngg.pictures.values()) for (const p of list) picById.set(p.pid, p);

  /** Копирует файл картинки; возвращает { url, alt, caption } или null (нет на диске). */
  const prepare = (pic, source) => {
    const g = ngg.galleries.get(pic.gid);
    if (!g || !wpContentDir) return null;
    const u = use(pic.gid);
    u.usedBy.add(source);
    let rest = String(g.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    rest = rest.replace(/^wp-content\//i, '');
    const rel = `${rest}/${pic.filename}`.replace(/^\/+/, '');
    const abs = safeJoin(wpContentDir, rel);
    const reg = abs && media.registerGalleryFile(gallerySlug(g), pic.filename, abs, source, `/wp-content/${rel}`);
    if (!reg) {
      if (!u.missing.includes(pic.filename)) u.missing.push(pic.filename);
      return null;
    }
    if (!u.seen.has(pic.pid)) { u.seen.add(pic.pid); u.copied++; }
    const desc = oneLine(pic.description);
    const altText = oneLine(pic.alttext);
    const alt = altText || desc || path.parse(pic.filename).name;
    return { url: encodePathForUrl(reg.path), alt, caption: altText && desc && desc !== altText ? desc : '' };
  };

  const itemsHtml = (items) =>
    `<ul>${items.map((i) => `<li><img src="${esc(i.url)}" alt="${esc(i.alt)}">${i.caption ? ` <em>${esc(i.caption)}</em>` : ''}</li>`).join('')}</ul>`;

  const todo = (text) => `\n\n<!-- TODO(wp-export): ${text} -->\n\n`;

  /** HTML одной галереи (или TODO). withHeading — заголовок с названием галереи. */
  const galleryHtml = (gid, source, { withHeading, ctx }) => {
    const g = ngg.galleries.get(gid);
    if (!g) {
      notFound.push({ what: 'галерея', id: gid, source });
      ctx.onNote?.(`Галерея NextGEN id=${gid} не найдена в базе`);
      return todo(`галерея NextGEN id=${gid} не найдена в базе`);
    }
    use(gid).usedBy.add(source);
    const pics = (ngg.pictures.get(gid) || []).filter((p) => !p.exclude);
    const items = pics.map((p) => prepare(p, source)).filter(Boolean);
    const title = oneLine(g.title || g.name);
    const head = withHeading && title ? `<h3>${esc(title)}</h3>` : '';
    if (!items.length) {
      ctx.onNote?.(`Галерея NextGEN «${title || gid}»: ${pics.length ? 'файлы фотографий не найдены в wp-content' : 'в галерее нет фотографий'}`);
      return `\n\n${head}${todo(`галерея NextGEN «${title || gid}» — ${pics.length ? 'файлы фотографий не найдены' : 'нет фотографий'}`)}`;
    }
    const lost = use(gid).missing.length;
    if (lost) ctx.onNote?.(`Галерея NextGEN «${title || gid}»: не найдено файлов — ${lost} (см. отчёт)`);
    return `\n\n${head}${itemsHtml(items)}\n\n`;
  };

  const albumHtml = (id, source, ctx, depth = 0) => {
    const al = ngg.albums.get(id);
    if (!al) {
      notFound.push({ what: 'альбом', id, source });
      ctx.onNote?.(`Альбом NextGEN id=${id} не найден в базе`);
      return todo(`альбом NextGEN id=${id} не найден в базе`);
    }
    albumUse.set(id, (albumUse.get(id) || new Set()).add(source));
    let out = '';
    for (const entry of al.order) {
      const m = /^a(\d+)$/i.exec(entry);
      if (m) { if (depth < 3) out += albumHtml(Number(m[1]), source, ctx, depth + 1); }
      else if (/^\d+$/.test(entry)) out += galleryHtml(Number(entry), source, { withHeading: true, ctx });
    }
    return out || todo(`альбом NextGEN «${oneLine(al.name) || id}» пуст`);
  };
  const albumUse = new Map();

  const picturesHtml = (pidList, source, ctx) => {
    const items = [];
    for (const pid of pidList) {
      const pic = picById.get(Number(pid));
      if (!pic) { notFound.push({ what: 'изображение', id: pid, source }); ctx.onNote?.(`Изображение NextGEN id=${pid} не найдено в базе`); continue; }
      const it = prepare(pic, source);
      if (it) items.push(it);
    }
    return items.length ? `\n\n${itemsHtml(items)}\n\n` : todo(`изображения NextGEN (${pidList.join(', ')}) не найдены`);
  };

  /** Возвращает HTML для шорткода (его дальше превратит html2md в Markdown). */
  function render(nameRaw, a, ctx = {}) {
    const name = String(nameRaw).toLowerCase();
    const source = ctx.source || '';
    ctx.onShortcode?.(name, 'converted');
    const gals = (list, withHeading) => list.map((g) => galleryHtml(Number(g), source, { withHeading: withHeading ?? list.length > 1, ctx })).join('');
    switch (name) {
      case 'nggallery':
      case 'slideshow':
        return gals(ids(a.id));
      case 'singlepic': {
        const pid = Number(a.id);
        const pic = picById.get(pid);
        if (!pic) { notFound.push({ what: 'изображение', id: pid, source }); ctx.onNote?.(`Изображение NextGEN id=${pid} не найдено в базе`); return todo(`изображение NextGEN id=${pid} не найдено в базе`); }
        const it = prepare(pic, source);
        return it ? `\n\n<p><img src="${esc(it.url)}" alt="${esc(it.alt)}">${it.caption ? ` <em>${esc(it.caption)}</em>` : ''}</p>\n\n` : todo(`изображение NextGEN id=${pid} — файл не найден`);
      }
      case 'album':
      case 'nggalbum':
        return ids(a.id).map((i) => albumHtml(Number(i), source, ctx)).join('');
      case 'ngg':
      case 'ngg_images': {
        const src = String(a.src || a.source || 'galleries').toLowerCase();
        if (src === 'galleries') return gals(ids(a.ids || a.gallery_ids || a.container_ids || a.id));
        if (src === 'albums') return ids(a.ids || a.album_ids || a.container_ids || a.id).map((i) => albumHtml(Number(i), source, ctx)).join('');
        if (src === 'images') return picturesHtml(ids(a.ids || a.image_ids), source, ctx);
        unsupported.push({ what: `[${name} src="${src}"]`, source });
        ctx.onNote?.(`NextGEN: источник «${src}» не поддерживается`);
        return todo(`NextGEN [${name} src="${src}"] не перенесён`);
      }
      default:
        return undefined;
    }
  }

  function report() {
    const galleries = [...ngg.galleries.values()].map((g) => {
      const u = usage.get(g.gid);
      const pics = (ngg.pictures.get(g.gid) || []).filter((p) => !p.exclude);
      return {
        gid: g.gid,
        title: oneLine(g.title || g.name) || `(галерея ${g.gid})`,
        slug: u ? gallerySlug(g) : null,
        photos: pics.length,
        copied: u?.copied || 0,
        missingFiles: u?.missing || [],
        usedBy: u ? [...u.usedBy].filter(Boolean) : [],
      };
    }).sort((a, b) => a.gid - b.gid);
    return {
      galleries,
      albums: [...ngg.albums.values()].map((al) => ({ id: al.id, title: oneLine(al.name) || `(альбом ${al.id})`, usedBy: [...(albumUse.get(al.id) || [])] })),
      notFound,
      unsupported,
      photosCopied: galleries.reduce((s, g) => s + g.copied, 0),
    };
  }

  return { render, report };
}
