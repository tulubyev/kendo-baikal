import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, data);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(2)} МБ`;
}

/** Рекурсивный обход каталога, возвращает абсолютные пути файлов. */
export function walk(dir, { skip = () => false } = {}) {
  const out = [];
  const rec = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (skip(p, e)) continue;
      if (e.isDirectory()) rec(p);
      else if (e.isFile()) out.push(p);
    }
  };
  rec(dir);
  return out.sort();
}

/** Безопасно соединяет базу и относительный путь; null, если путь выходит за базу. */
export function safeJoin(base, rel) {
  const full = path.resolve(base, rel);
  const b = path.resolve(base);
  if (full !== b && !full.startsWith(b + path.sep)) return null;
  return full;
}

export function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Лояльное декодирование процентного кодирования: регистр %XX не важен, «битые» (обрезанные WordPress
 * на 200 байтах) последовательности не ломают всю строку — неверные байты превращаются в U+FFFD.
 * Годится для сравнения путей: обе стороны проходят через одну функцию.
 */
export function decodeLenient(s) {
  const dec = new TextDecoder('utf-8', { fatal: false });
  return String(s).replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => dec.decode(Uint8Array.from(run.slice(1).split('%').map((h) => parseInt(h, 16)))));
}

/** Кодирует только то, что ломает Markdown/URL, оставляя кириллицу читаемой. */
export function encodePathForUrl(p) {
  return p.replace(/[ ()#?%"'<>\[\]]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/** Полное процентное кодирование пути, как в $request_uri у nginx. */
export function encodePathStrict(p) {
  return p.split('/').map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
}

export function csvCell(v) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function mdEscapeCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function createLogger({ quiet = false } = {}) {
  const warnings = [];
  return {
    warnings,
    info: (m) => !quiet && console.log(m),
    warn: (m) => {
      warnings.push(m);
      if (!quiet) console.warn(`⚠️  ${m}`);
    },
  };
}
