import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, safeJoin, walk } from './util.mjs';

const SIZE_SUFFIX = /-\d+x\d+(?=\.[A-Za-z0-9]+$)/;

// Из wp-content не копируем код, конфиги и служебные папки — только то, что может быть картинкой/документом.
const DENY_TOP = new Set(['plugins', 'mu-plugins', 'upgrade', 'cache', 'languages', 'backup', 'backups', 'backup-db', 'wflogs']);
const DENY_EXT = /\.(php\d?|phtml|phar|sql|env|htaccess|htpasswd|ini|log|sh|bash|exe|bat|cgi|pl|py|rb|asp|aspx|jsp|bak|conf|key|pem)$/i;

/**
 * Реестр используемых файлов из wp-content. Копируются только реально использованные.
 * Файл из uploads попадает в public/uploads/<тот же путь>; из других папок wp-content
 * (gallery/, ngg/…) — в public/uploads/<папка>/…; фото галерей NextGEN — в public/uploads/gallery/<slug галереи>/.
 */
export class MediaRegistry {
  constructor({ uploadsDir = null, wpContentDir = null, maxBytes = 1024 * 1024 } = {}) {
    this.uploadsDir = uploadsDir && fs.existsSync(uploadsDir) ? uploadsDir : null;
    this.wpContentDir = wpContentDir && fs.existsSync(wpContentDir) ? wpContentDir : null;
    this.maxBytes = maxBytes;
    this.files = new Map(); // dest (как в /uploads/<dest>) → { src, size, usedBy:Set, old:Set }
    this.srcToDest = new Map();
    this.missing = new Map(); // rel → Set(usedBy)
    this.cache = new Map();
    this.galleryDest = new Set(); // dest, попавшие из галерей
  }

  _add(dest, src, size, usedBy, oldUrls) {
    let d = this.srcToDest.get(src);
    if (!d) {
      d = dest;
      // коллизия с другим файлом, занявшим это имя
      if (this.files.has(d) && this.files.get(d).src !== src) d = 'wp-content/' + dest;
      this.srcToDest.set(src, d);
    }
    const f = this.files.get(d) || { src, size, usedBy: new Set(), old: new Set() };
    f.usedBy.add(usedBy);
    for (const o of oldUrls) f.old.add(o);
    this.files.set(d, f);
    return d;
  }

  _miss(rel, usedBy) {
    if (!this.missing.has(rel)) this.missing.set(rel, new Set());
    this.missing.get(rel).add(usedBy);
  }

  _find(baseDir, rel) {
    const tryRel = (r) => {
      const full = safeJoin(baseDir, r);
      if (!full) return null;
      try {
        const st = fs.statSync(full);
        return st.isFile() ? { ok: true, rel: r, src: full, size: st.size } : null;
      } catch {
        return null;
      }
    };
    return tryRel(rel) || (SIZE_SUFFIX.test(rel) ? tryRel(rel.replace(SIZE_SUFFIX, '')) : null);
  }

  /** rel — путь внутри uploads (декодированный). Возвращает { path: '/uploads/..', ok } */
  resolve(relRaw, usedBy = '') {
    const rel = relRaw.replace(/^\/+/, '').replace(/\\/g, '/');
    let hit = this.cache.get('u:' + rel);
    if (!hit) {
      hit = this.uploadsDir ? this._find(this.uploadsDir, rel) || { ok: false, rel } : { ok: false, unknown: true, rel };
      this.cache.set('u:' + rel, hit);
    }
    if (hit.ok) {
      const dest = this._add(hit.rel, hit.src, hit.size, usedBy, ['/wp-content/uploads/' + hit.rel, '/wp-content/uploads/' + rel]);
      return { path: '/uploads/' + dest, ok: true };
    }
    this._miss(rel, usedBy);
    return { path: '/uploads/' + rel, ok: false, unknown: hit.unknown };
  }

  /** rel — путь внутри wp-content, но не в uploads (gallery/…, ngg/…, themes/…). */
  resolveWpContent(relRaw, usedBy = '') {
    const rel = relRaw.replace(/^\/+/, '').replace(/\\/g, '/');
    const top = rel.split('/')[0].toLowerCase();
    if (DENY_TOP.has(top) || DENY_EXT.test(rel)) return { ok: false, denied: true, path: '/wp-content/' + rel };
    if (!this.wpContentDir) return { ok: false, unknown: true, path: '/wp-content/' + rel };
    let hit = this.cache.get('w:' + rel);
    if (!hit) {
      hit = this._find(this.wpContentDir, rel) || { ok: false, rel };
      this.cache.set('w:' + rel, hit);
    }
    if (hit.ok) {
      const dest = this._add(hit.rel, hit.src, hit.size, usedBy, ['/wp-content/' + hit.rel, '/wp-content/' + rel]);
      return { path: '/uploads/' + dest, ok: true };
    }
    this._miss('wp-content/' + rel, usedBy);
    return { path: '/wp-content/' + rel, ok: false };
  }

  /** Файл галереи NextGEN: absSrc — путь на диске; oldUrl — прежний адрес. Возвращает { path } или null, если файла нет. */
  registerGalleryFile(slug, filename, absSrc, usedBy, oldUrl) {
    let st;
    try {
      st = fs.statSync(absSrc);
      if (!st.isFile()) return null;
    } catch {
      return null;
    }
    const dest = this._add(`gallery/${slug}/${filename}`, absSrc, st.size, usedBy, oldUrl ? [oldUrl] : []);
    this.galleryDest.add(dest);
    return { path: '/uploads/' + dest, dest };
  }

  copyTo(outDir) {
    const dest = path.join(outDir, 'public', 'uploads');
    for (const [rel, f] of this.files) {
      const to = path.join(dest, rel);
      ensureDir(path.dirname(to));
      fs.copyFileSync(f.src, to);
    }
  }

  stats() {
    let total = 0;
    const heavy = [];
    const list = [];
    let fromUploads = 0;
    for (const [rel, f] of this.files) {
      total += f.size;
      list.push({ file: rel, size: f.size });
      if (f.size > this.maxBytes) heavy.push({ file: rel, size: f.size });
      if (this.uploadsDir && f.src.startsWith(this.uploadsDir + path.sep)) fromUploads++;
    }
    heavy.sort((a, b) => b.size - a.size);
    list.sort((a, b) => b.size - a.size);
    let uploadsTotal = 0;
    let uploadsThumbs = 0;
    if (this.uploadsDir) {
      for (const f of walk(this.uploadsDir)) {
        uploadsTotal++;
        if (SIZE_SUFFIX.test(f)) uploadsThumbs++;
      }
    }
    return {
      copied: this.files.size,
      totalBytes: total,
      heavy,
      largest: list.slice(0, 10),
      missing: [...this.missing.entries()].map(([file, by]) => ({ file, usedBy: [...by].filter(Boolean) })),
      uploadsDirFound: !!this.uploadsDir,
      uploadsTotal,
      uploadsThumbnails: uploadsThumbs,
      notCopied: Math.max(0, uploadsTotal - fromUploads),
      outsideUploads: this.files.size - fromUploads - this.galleryDest.size,
      galleryCopied: this.galleryDest.size,
    };
  }
}
