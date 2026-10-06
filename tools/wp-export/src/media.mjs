import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, safeJoin, walk } from './util.mjs';

const SIZE_SUFFIX = /-\d+x\d+(?=\.[A-Za-z0-9]+$)/;

/** Реестр используемых файлов из wp-content/uploads. Копируются только реально использованные. */
export class MediaRegistry {
  constructor({ uploadsDir = null, maxBytes = 1024 * 1024 } = {}) {
    this.uploadsDir = uploadsDir && fs.existsSync(uploadsDir) ? uploadsDir : null;
    this.maxBytes = maxBytes;
    this.files = new Map(); // rel (как в /uploads/<rel>) → { src, size, usedBy:Set }
    this.missing = new Map(); // rel → Set(usedBy)
    this.cache = new Map();
  }

  /** rel — путь внутри uploads (декодированный). Возвращает { path: '/uploads/..', ok } */
  resolve(relRaw, usedBy = '') {
    const rel = relRaw.replace(/^\/+/, '').replace(/\\/g, '/');
    const key = rel;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = this._locate(rel);
      this.cache.set(key, hit);
    }
    if (hit.ok) {
      const f = this.files.get(hit.rel) || { src: hit.src, size: hit.size, usedBy: new Set() };
      f.usedBy.add(usedBy);
      this.files.set(hit.rel, f);
    } else {
      if (!this.missing.has(rel)) this.missing.set(rel, new Set());
      this.missing.get(rel).add(usedBy);
    }
    return { path: '/uploads/' + (hit.ok ? hit.rel : rel), ok: hit.ok, unknown: hit.unknown };
  }

  _locate(rel) {
    if (!this.uploadsDir) return { ok: false, unknown: true, rel };
    const tryRel = (r) => {
      const full = safeJoin(this.uploadsDir, r);
      if (!full) return null;
      try {
        const st = fs.statSync(full);
        return st.isFile() ? { ok: true, rel: r, src: full, size: st.size } : null;
      } catch {
        return null;
      }
    };
    return tryRel(rel) || (SIZE_SUFFIX.test(rel) ? tryRel(rel.replace(SIZE_SUFFIX, '')) : null) || { ok: false, rel };
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
    for (const [rel, f] of this.files) {
      total += f.size;
      list.push({ file: rel, size: f.size });
      if (f.size > this.maxBytes) heavy.push({ file: rel, size: f.size });
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
      notCopied: Math.max(0, uploadsTotal - this.files.size),
    };
  }
}

MediaRegistry.prototype.aliases = function aliases() {
  const out = [];
  for (const [req, hit] of this.cache) if (hit.ok && hit.rel !== req) out.push({ from: req, to: hit.rel });
  return out;
};
