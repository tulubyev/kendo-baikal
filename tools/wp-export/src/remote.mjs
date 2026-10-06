import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir } from './util.mjs';
import { slugify } from './slug.mjs';

/**
 * Скачивание внешних картинок/документов (опция --download-remote).
 * Конвертация синхронная, поэтому на месте ссылки пишется токен wpx-remote://N; после загрузки
 * rewrite() заменяет токены на /uploads/remote/… (или возвращает исходный URL + TODO для недоступных).
 * Только встроенный fetch (Node ≥ 20), без зависимостей.
 */

export const USER_AGENT = 'kendo-baikal-wp-export/1.0 (+https://github.com/tulubyev/kendo-baikal; one-off migration of own site content)';

const TOKEN_RE = /wpx-remote:\/\/(\d+)/g;
const IMG_TOKEN_RE = /!\[([^\]]*)\]\(wpx-remote:\/\/(\d+)((?:\s+"[^"]*")?)\)/g;

const DOC_TYPES = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/rtf': 'rtf',
};
const IMG_TYPE_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };

/** Определение типа по сигнатуре файла → { kind: 'image'|'pdf', ext } | null */
export function sniffType(buf) {
  const b = buf;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', ext: 'jpg' };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', ext: 'png' };
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return { kind: 'image', ext: 'gif' };
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', ext: 'webp' };
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(avif|avis)$/.test(b.subarray(8, 12).toString('latin1'))) return { kind: 'image', ext: 'avif' };
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return { kind: 'image', ext: 'bmp' };
  if (b.length >= 4 && (b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))) return { kind: 'image', ext: 'tif' };
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === '%PDF') return { kind: 'pdf', ext: 'pdf' };
  return null;
}

const mb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) : (n / 1048576).toFixed(3)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeNetError(e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'таймаут';
  const code = e?.cause?.code || e?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'домен не найден (DNS)';
  if (code === 'ECONNREFUSED') return 'соединение отклонено';
  if (code === 'ECONNRESET') return 'соединение разорвано';
  if (code && /CERT|SSL|TLS/i.test(String(code))) return `ошибка сертификата (${code})`;
  return `ошибка сети${code ? ` (${code})` : e?.message ? ` (${e.message})` : ''}`;
}

class Retryable extends Error {}

export class RemoteImages {
  constructor({ cacheDir, concurrency = 5, timeoutMs = 20000, retries = 3, backoffMs = 1000, maxBytes = 25 * 1024 * 1024, userAgent = USER_AGENT, hostOverrides = {}, hostGiveUpAfter = 3 } = {}) {
    this.cacheDir = cacheDir;
    this.concurrency = Math.max(1, concurrency);
    this.timeoutMs = timeoutMs;
    this.retries = Math.max(1, retries);
    this.backoffMs = backoffMs;
    this.maxBytes = maxBytes;
    this.userAgent = userAgent;
    this.hostOverrides = hostOverrides; // для тестов: { 'pp.userapi.com': 'http://127.0.0.1:1234' }
    this.hostGiveUpAfter = hostGiveUpAfter;
    this.entries = new Map(); // key → entry
    this.byId = [];
    this.hostFail = new Map();
    this.hostOk = new Set();
    this.index = { version: 1, urls: {}, hashes: {} };
  }

  /**
   * candidates — адреса по порядку предпочтения; original — как ссылка выглядела в тексте (вернётся при неудаче).
   * Возвращает токен для подстановки в Markdown.
   */
  register({ candidates, original, source = '' }) {
    const key = candidates[0];
    let e = this.entries.get(key);
    if (!e) {
      e = { id: this.byId.length, key, candidates, original, usedBy: new Set(), status: 'pending' };
      this.entries.set(key, e);
      this.byId.push(e);
    }
    if (source) e.usedBy.add(source);
    return `wpx-remote://${e.id}`;
  }

  get size() {
    return this.entries.size;
  }

  _loadCache() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.cacheDir, 'index.json'), 'utf8'));
      if (j?.version === 1) this.index = { version: 1, urls: j.urls || {}, hashes: j.hashes || {} };
    } catch { /* нет кэша */ }
  }

  _saveCache() {
    ensureDir(this.cacheDir);
    fs.writeFileSync(path.join(this.cacheDir, 'index.json'), JSON.stringify(this.index, null, 1) + '\n');
  }

  _cacheFile(name) {
    return path.join(this.cacheDir, 'files', name);
  }

  /** Выполнить все загрузки. progress(done, total, entry). */
  async run({ progress } = {}) {
    this._loadCache();
    ensureDir(path.join(this.cacheDir, 'files'));
    const list = [...this.entries.values()];
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const e = list[next++];
        try {
          await this._process(e);
        } catch (err) {
          e.status = 'failed';
          e.reason = `внутренняя ошибка: ${err.message}`;
        }
        done++;
        if (done % 25 === 0) this._saveCache(); // чтобы после Ctrl+C уже скачанное не терялось
        progress?.(done, list.length, e);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, list.length) }, worker));
    this._saveCache();
  }

  async _process(e) {
    for (const url of e.candidates) {
      const cached = this.index.urls[url];
      if (cached && fs.existsSync(this._cacheFile(cached.file))) {
        Object.assign(e, { status: 'ok', file: cached.file, contentType: cached.contentType, size: cached.size, fromCache: true, url });
        return;
      }
    }
    const reasons = [];
    for (const url of e.candidates) {
      const r = await this._download(url);
      if (r.ok) {
        const name = this._store(url, r);
        Object.assign(e, { status: 'ok', file: name, contentType: r.contentType, size: r.buf.length, fromCache: false, url });
        return;
      }
      reasons.push(e.candidates.length > 1 ? `${new URL(url).host}: ${r.reason}` : r.reason);
    }
    e.status = 'failed';
    e.reason = reasons.join('; ');
  }

  _store(url, r) {
    const hash = crypto.createHash('sha1').update(r.buf).digest('hex').slice(0, 12);
    let name = this.index.hashes[hash];
    if (!name || !fs.existsSync(this._cacheFile(name))) {
      let base = 'file';
      try {
        base = slugify(decodeURIComponent(path.posix.basename(new URL(url).pathname)).replace(/\.[A-Za-z0-9]{1,5}$/, ''), 'translit').slice(0, 40) || 'file';
      } catch { /* оставляем file */ }
      name = `${base}-${hash}.${r.ext}`;
      fs.writeFileSync(this._cacheFile(name), r.buf);
      this.index.hashes[hash] = name;
    }
    this.index.urls[url] = { file: name, contentType: r.contentType, size: r.buf.length };
    return name;
  }

  _fetchUrl(url) {
    const u = new URL(url);
    const ov = this.hostOverrides[u.host];
    if (!ov) return url;
    const o = new URL(ov);
    u.protocol = o.protocol;
    u.host = o.host;
    return u.href;
  }

  async _download(url) {
    let host = '';
    try { host = new URL(url).host; } catch { return { ok: false, reason: 'некорректный адрес' }; }
    if (!/^https?:/i.test(url)) return { ok: false, reason: 'не http(s)' };
    if (!this.hostOk.has(host) && (this.hostFail.get(host) || 0) >= this.hostGiveUpAfter) {
      return { ok: false, reason: `хост недоступен (пропущено после ${this.hostGiveUpAfter} неудач подряд)` };
    }
    let reason = 'неизвестная ошибка';
    let serverAnswered = false;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const r = await this._attempt(url);
        this.hostOk.add(host); // сервер отвечает — недоступным не считаем
        this.hostFail.set(host, 0);
        return r;
      } catch (err) {
        serverAnswered = err instanceof Retryable; // HTTP 429/5xx — сервер жив
        reason = serverAnswered ? err.message : describeNetError(err);
        if (attempt < this.retries) await sleep(this.backoffMs * 2 ** (attempt - 1));
      }
    }
    if (serverAnswered) this.hostOk.add(host);
    else this.hostFail.set(host, (this.hostFail.get(host) || 0) + 1);
    return { ok: false, reason };
  }

  async _attempt(url) {
    const res = await fetch(this._fetchUrl(url), {
      redirect: 'follow',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'User-Agent': this.userAgent, Accept: 'image/*,application/pdf;q=0.9,*/*;q=0.1' },
    });
    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel().catch(() => {});
      throw new Retryable(`HTTP ${res.status}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const len = Number(res.headers.get('content-length'));
    if (len > this.maxBytes) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `файл слишком большой (${mb(len)} МБ, лимит ${mb(this.maxBytes)} МБ)` };
    }
    if (contentType === 'image/svg+xml') {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'SVG не скачивается (может содержать скрипты)' };
    }
    const typeOk = contentType.startsWith('image/') || contentType in DOC_TYPES || /^(application|binary)\/octet-stream$/.test(contentType);
    if (!typeOk) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `не изображение и не документ (Content-Type: ${contentType || 'не указан'})` };
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > this.maxBytes) {
        await res.body.cancel?.().catch(() => {});
        return { ok: false, reason: `файл слишком большой (лимит ${mb(this.maxBytes)} МБ)` };
      }
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    if (!buf.length) return { ok: false, reason: 'пустой ответ' };
    const sniff = sniffType(buf);
    let ext;
    if (contentType in DOC_TYPES) {
      ext = DOC_TYPES[contentType];
      if (ext === 'pdf' && sniff?.kind !== 'pdf') return { ok: false, reason: 'содержимое не похоже на PDF' };
    } else {
      if (!sniff) return { ok: false, reason: `содержимое не похоже на изображение (Content-Type: ${contentType || 'не указан'})` };
      ext = sniff.ext;
    }
    return { ok: true, buf, contentType, ext: ext || IMG_TYPE_EXT[contentType] || 'bin' };
  }

  /** Копирует скачанное в <out>/public/uploads/remote/ */
  copyTo(outDir) {
    const dest = path.join(outDir, 'public', 'uploads', 'remote');
    for (const e of this.entries.values()) {
      if (e.status !== 'ok') continue;
      ensureDir(dest);
      fs.copyFileSync(this._cacheFile(e.file), path.join(dest, e.file));
    }
  }

  /** Подставляет в Markdown локальные пути вместо токенов. */
  rewrite(text) {
    if (!text.includes('wpx-remote://')) return text;
    const local = (e) => `/uploads/remote/${e.file}`;
    let out = text.replace(IMG_TOKEN_RE, (_, alt, id, title) => {
      const e = this.byId[Number(id)];
      if (!e) return _;
      return e.status === 'ok' ? `![${alt}](${local(e)}${title})` : `![${alt}](${e.original}${title}) <!-- TODO(wp-export): картинка недоступна -->`;
    });
    out = out.replace(TOKEN_RE, (m, id) => {
      const e = this.byId[Number(id)];
      return e ? (e.status === 'ok' ? local(e) : e.original) : m;
    });
    return out;
  }

  stats() {
    const hosts = {};
    let downloaded = 0;
    let fromCache = 0;
    let bytes = 0;
    const failures = [];
    for (const e of this.entries.values()) {
      let h = '';
      try { h = new URL(e.key).host; } catch { /* пусто */ }
      const hh = (hosts[h] ||= { ok: 0, failed: 0 });
      if (e.status === 'ok') {
        downloaded++;
        hh.ok++;
        bytes += e.size || 0;
        if (e.fromCache) fromCache++;
      } else {
        hh.failed++;
        failures.push({ url: e.key, reason: e.reason || 'не скачано', usedBy: [...e.usedBy] });
      }
    }
    return { enabled: true, total: this.entries.size, downloaded, fromCache, failed: failures.length, bytes, hosts, failures };
  }
}
