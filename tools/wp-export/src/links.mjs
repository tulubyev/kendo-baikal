import { decodeSafe, encodePathForUrl } from './util.mjs';
import { normalizeKey } from './site.mjs';

/** Переписывание ссылок: внутренние → новые пути, uploads → /uploads/…, учёт ссылок для отчёта. */
export function createLinkResolver({ plan, model, media }) {
  const categoryBase = (model.options.category_base || 'category').replace(/^\/|\/$/g, '');
  const tagBase = (model.options.tag_base || 'tag').replace(/^\/|\/$/g, '');
  const stats = {
    internalOk: 0,
    internalBroken: [], // { source, url }
    unsupportedAssets: [], // ссылки на /wp-content/ вне uploads
    external: [], // { source, url }
    mailto: 0,
    tel: 0,
    taxonomyRedirected: 0,
  };
  let source = '';

  const ext = (u) => u.replace(/[ ()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

  const attachmentById = (id) => plan.attachments.get(id);

  function rewriteUrl(raw, kind) {
    const url = String(raw || '').trim();
    if (!url) return url;
    if (url.startsWith('#')) return url;
    if (/^mailto:/i.test(url)) { stats.mailto++; return url; }
    if (/^tel:/i.test(url)) { stats.tel++; return url; }
    if (/^(javascript|data):/i.test(url)) return url;

    let u;
    try {
      u = new URL(url, plan.site ? plan.site + '/' : 'http://localhost/');
    } catch {
      return ext(url);
    }
    const host = u.host.replace(/^www\./, '').toLowerCase();
    const internal = plan.hosts.has(host) || (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url) && host === (plan.site ? new URL(plan.site).host.replace(/^www\./, '') : 'localhost'));
    if (!internal) {
      if (/^https?:/i.test(u.protocol)) stats.external.push({ source, url: u.href, kind });
      return ext(url);
    }

    let pathname = decodeSafe(u.pathname);
    const hash = u.hash || '';
    const um = /^\/wp-content\/uploads\/(.+)$/i.exec(pathname);
    if (um) {
      const r = media.resolve(um[1], source);
      if (!r.ok && !r.unknown) stats.internalBroken.push({ source, url: u.href, reason: 'файл не найден в wp-content/uploads' });
      return encodePathForUrl(r.path) + hash;
    }
    if (/^\/wp-(content|includes)\//i.test(pathname)) {
      stats.unsupportedAssets.push({ source, url: u.href });
      return ext(pathname + u.search + hash);
    }

    const q = u.searchParams;
    const qid = q.get('p') || q.get('page_id') || q.get('attachment_id');
    if (qid) {
      const att = q.get('attachment_id') ? attachmentById(Number(qid)) : null;
      if (att?.file) {
        const r = media.resolve(att.file, source);
        return encodePathForUrl(r.path) + hash;
      }
      const e = plan.urlIndex.byQuery.get(`p:${qid}`);
      if (e) { stats.internalOk++; return encodePathForUrl(e.newPath) + hash; }
      stats.internalBroken.push({ source, url: u.href, reason: 'запись не опубликована или не экспортирована' });
      return ext(pathname + u.search + hash);
    }

    if (pathname === '/' || pathname === '') {
      if (kind !== 'img') stats.internalOk++;
      return '/' + hash;
    }
    const key = normalizeKey(pathname);
    const e = plan.urlIndex.byPath.get(key);
    if (e) { stats.internalOk++; return encodePathForUrl(e.newPath) + hash; }

    const first = key.split('/')[1];
    if (first === categoryBase || first === tagBase) { stats.taxonomyRedirected++; return '/news/' + hash; }
    if (first === 'feed') return '/rss.xml';
    if (/\.[a-z0-9]{2,5}$/i.test(pathname) && !/\.(html?|php)$/i.test(pathname)) {
      // файл вне wp-content (например, /files/doc.pdf) — оставляем как есть
      stats.unsupportedAssets.push({ source, url: u.href });
      return ext(pathname + hash);
    }
    stats.internalBroken.push({ source, url: u.href, reason: 'страница не найдена среди опубликованных' });
    return ext(pathname + u.search + hash);
  }

  return {
    stats,
    setSource: (s) => { source = s; },
    rewriteUrl,
  };
}
