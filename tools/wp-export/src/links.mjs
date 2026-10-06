import { decodeSafe, encodePathForUrl } from './util.mjs';
import { normalizeKey } from './site.mjs';

const PHOTON_HOST = /^i[0-3]\.wp\.com$/i;
const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i;
// якоря WordPress, которых на новом сайте нет: #more-123, #comment-45, #respond, #comments
const DEAD_FRAGMENT = /^#(more-\d*|comment-\d*|comments|respond)$/i;

/** Переписывание ссылок: внутренние → новые пути, файлы wp-content → /uploads/…, учёт ссылок для отчёта. */
export function createLinkResolver({ plan, model, media, remote = null }) {
  const categoryBase = (model.options.category_base || 'category').replace(/^\/|\/$/g, '');
  const tagBase = (model.options.tag_base || 'tag').replace(/^\/|\/$/g, '');
  const stats = {
    internalOk: 0,
    internalBroken: [], // { source, url, reason }
    internalFuzzy: [], // { source, url, how, to } — сопоставлено не по точному пути
    unsupportedAssets: [], // ссылки на файлы вне uploads, которые не удалось перенести
    external: [], // { source, url, kind }
    mailto: 0,
    tel: 0,
    taxonomyRedirected: 0,
  };
  let source = '';
  let pendingTodo = '';

  const ext = (u) => u.replace(/[ ()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const isOurHost = (h) => plan.hosts.has(String(h).replace(/^www\./, '').toLowerCase());

  // записи, которые есть в базе, но не экспортируются (для понятной причины в отчёте)
  let hiddenBySlug = null;
  const hiddenInfo = (pathname, id) => {
    if (id) {
      const p = model.posts.get(Number(id));
      if (p && (p.post_type === 'post' || p.post_type === 'page')) return `запись «${p.post_title}» есть в базе, но не опубликована (статус: ${p.protected ? 'под паролем' : p.post_status})`;
      return null;
    }
    if (!hiddenBySlug) {
      hiddenBySlug = new Map();
      for (const p of model.posts.values()) {
        if (!['post', 'page'].includes(p.post_type) || !p.post_name || plan.byId.has(p.ID)) continue;
        hiddenBySlug.set(normalizeKey('/' + p.post_name + '/'), p);
      }
    }
    const segs = normalizeKey(pathname).split('/').filter(Boolean);
    const p = segs.length ? hiddenBySlug.get(`/${segs[segs.length - 1]}/`) : null;
    return p ? `запись «${p.post_title}» есть в базе, но не опубликована (статус: ${p.protected ? 'под паролем' : p.post_status})` : null;
  };

  /** Ищет запись по пути; fallback-и: суффиксы комментариев/фида, #more-ID, единственный slug. */
  function findEntry(pathname, hash) {
    const { byPath, bySlug } = plan.urlIndex;
    const tries = [pathname];
    const stripped = pathname.replace(/\/(comment-page-\d+|feed|embed|amp)\/?$/i, '/');
    if (stripped !== pathname) tries.push(stripped);
    for (const t of tries) {
      const e = byPath.get(normalizeKey(t));
      if (e) return { e };
    }
    const more = /^#more-(\d+)$/i.exec(hash);
    if (more) {
      const e = plan.byId.get(Number(more[1]));
      if (e) return { e, how: 'по ID из якоря #more-' + more[1] };
    }
    const key = normalizeKey(pathname);
    if (!/^\/\d{4}(\/\d{1,2}){0,2}\/$/.test(key)) {
      const segs = key.split('/').filter(Boolean);
      const list = segs.length ? bySlug.get(`/${segs[segs.length - 1]}/`) : null;
      if (list?.length === 1) return { e: list[0], how: 'по slug (путь не совпал с постоянной ссылкой)' };
    }
    return null;
  }

  const remoteOk = () => remote && source !== 'menu';
  const wantsDownload = (kind, pathname) => kind === 'img' || (kind === 'a' && (IMG_EXT.test(pathname) || DOC_EXT.test(pathname)));
  const token = (candidates, original) => remote.register({ candidates, original, source });

  function rewriteUrl(raw, kind) {
    pendingTodo = '';
    const url = String(raw || '').trim();
    if (!url) return url;
    if (url.startsWith('#')) return url;
    if (/^mailto:/i.test(url)) { stats.mailto++; return url; }
    if (/^tel:/i.test(url)) { stats.tel++; return url; }
    if (/^(javascript|data):/i.test(url)) return url;
    // уже готовый путь нового сайта (например, фото галерей)
    if (/^\/uploads\//.test(url)) return url;

    let u;
    try {
      u = new URL(url, plan.site ? plan.site + '/' : 'http://localhost/');
    } catch {
      return ext(url);
    }
    const isAbs = /^[a-z][a-z0-9+.-]*:|^\/\//i.test(url);
    const host = u.host.toLowerCase();
    const cleanHash = DEAD_FRAGMENT.test(u.hash) ? '' : u.hash;

    // Photon (Jetpack): i0/i1/i2.wp.com/<домен>/<путь>?resize=…&ssl=1
    let photon = null;
    if (PHOTON_HOST.test(host)) {
      const m = /^\/([^/]+)(\/.*)?$/.exec(u.pathname);
      if (m) photon = { domain: decodeSafe(m[1]).toLowerCase(), rest: m[2] || '/' };
    }

    const originalCandidates = () => {
      const proto = url.startsWith('//') ? ['https:', 'http:'] : [u.protocol];
      return proto.map((p) => `${p}//${u.host}${u.pathname}${photon ? '' : u.search}`);
    };

    // ---- внешняя ссылка (в том числе Photon с чужого домена) ----
    if (photon ? !isOurHost(photon.domain) : isAbs && !isOurHost(host)) {
      if (/^https?:$/i.test(u.protocol)) stats.external.push({ source, url: u.href, kind });
      if (remoteOk() && /^https?:$/i.test(u.protocol) && wantsDownload(kind, photon ? photon.rest : u.pathname)) {
        const cands = photon ? [`https://${u.host}${u.pathname}`, `https://${photon.domain}${photon.rest}`, `http://${photon.domain}${photon.rest}`] : originalCandidates();
        return token(cands, ext(url));
      }
      return ext(url);
    }

    // ---- внутренняя ссылка (в том числе Photon с нашего домена: путь берём как локальный файл) ----
    const pathname = decodeSafe(photon ? photon.rest : u.pathname);
    const search = photon ? '' : u.search;
    const hash = photon ? '' : cleanHash;
    const photonFallback = photon && remoteOk()
      ? [`https://${u.host}${u.pathname}`, `https://${photon.domain}${photon.rest}`, `http://${photon.domain}${photon.rest}`]
      : null;
    const missingFile = (reason) => {
      if (photonFallback) return token(photonFallback, ext(url));
      stats.internalBroken.push({ source, url: u.href, reason });
      return photon ? ext(url) : null;
    };

    const um = /^\/wp-content\/uploads\/(.+)$/i.exec(pathname);
    if (um) {
      const r = media.resolve(um[1], source);
      if (r.ok || r.unknown) return encodePathForUrl(r.path) + hash;
      return missingFile('файл не найден в wp-content/uploads') ?? encodePathForUrl(r.path) + hash;
    }
    const wm = /^\/wp-content\/(.+)$/i.exec(pathname);
    if (wm) {
      const r = media.resolveWpContent(wm[1], source);
      if (r.ok) return encodePathForUrl(r.path) + hash;
      if (!r.denied && !r.unknown && photonFallback) return token(photonFallback, ext(url));
      stats.unsupportedAssets.push({ source, url: u.href });
      return ext(pathname + search + hash);
    }
    if (/^\/wp-includes\//i.test(pathname)) {
      stats.unsupportedAssets.push({ source, url: u.href });
      return ext(pathname + search + hash);
    }

    const q = u.searchParams;
    const qid = !photon && (q.get('p') || q.get('page_id') || q.get('attachment_id'));
    if (qid) {
      const att = plan.attachments.get(Number(qid));
      if (att?.file && (q.get('attachment_id') || !plan.urlIndex.byQuery.has(`p:${qid}`))) {
        const r = media.resolve(att.file, source);
        return encodePathForUrl(r.path) + hash;
      }
      const e = plan.urlIndex.byQuery.get(`p:${qid}`);
      if (e) { stats.internalOk++; return encodePathForUrl(e.newPath) + hash; }
      return broken(u, `${hiddenInfo(null, qid) || 'запись не опубликована или не экспортирована'}`, hash);
    }

    if (pathname === '/' || pathname === '' || /^\/index\.php\/?$/i.test(pathname)) {
      if (kind !== 'img') stats.internalOk++;
      return '/' + hash;
    }
    const found = findEntry(pathname, u.hash);
    if (found) {
      stats.internalOk++;
      if (found.how) stats.internalFuzzy.push({ source, url: u.href, how: found.how, to: found.e.newPath });
      return encodePathForUrl(found.e.newPath) + hash;
    }

    const first = normalizeKey(pathname).split('/')[1];
    if (first === categoryBase || first === tagBase) { stats.taxonomyRedirected++; return '/news/' + hash; }
    if (first === 'feed') return '/rss.xml';
    if (/\.[a-z0-9]{2,5}$/i.test(pathname) && !/\.(html?|php)$/i.test(pathname)) {
      // файл вне wp-content (например, /files/doc.pdf) — оставляем как есть
      stats.unsupportedAssets.push({ source, url: u.href });
      return ext(pathname + hash);
    }
    return broken(u, hiddenInfo(pathname) || 'страница не найдена среди опубликованных', hash);
  }

  /** Ссылка на отсутствующую запись: абсолютный старый адрес + TODO + строка в отчёте. */
  function broken(u, reason, hash) {
    stats.internalBroken.push({ source, url: u.href, reason });
    pendingTodo = `ссылка на отсутствующую запись (оставлен старый адрес): ${reason}`;
    const old = new URL(u.href);
    old.hash = '';
    return ext(old.href) + (hash && !DEAD_FRAGMENT.test(hash) ? hash : '');
  }

  return {
    stats,
    setSource: (s) => { source = s; },
    rewriteUrl,
    takeTodo: () => { const t = pendingTodo; pendingTodo = ''; return t; },
  };
}
