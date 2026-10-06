import fs from 'node:fs';
import path from 'node:path';
import { walk, decodeSafe } from './util.mjs';
import { EMAIL, normalizeEmail, maskEmail } from './secrets.mjs';

/**
 * Скрытие e-mail пользователей WordPress в Markdown (по умолчанию включено; отключается --keep-user-emails).
 * Адрес → «[адрес скрыт]»; если он внутри mailto:-ссылки — заменяется вся ссылка.
 * Возвращает { total, items: [{ file, line, count, masked[] }] } — без реальных адресов.
 */
export const REDACTED = '[адрес скрыт]';

const MD_MAILTO = /\[(?:[^\]\\]|\\.)*\]\(\s*<?mailto:([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/gi;
const HTML_MAILTO = /<a\b[^>]*\bhref\s*=\s*["']mailto:([^"']*)["'][^>]*>[\s\S]*?<\/a>/gi;
const AUTOLINK = /<(?:mailto:)?((?:[A-Za-z0-9._%+-]|\\[_*])+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})>/gi;

export function redactText(text, userEmails) {
  const hits = []; // { line, masked }
  const userEmailsIn = (target) =>
    decodeSafe(target.split('?')[0])
      .split(/[,;]/)
      .map((x) => normalizeEmail(x.trim()))
      .filter((x) => userEmails.has(x));
  let out = text;
  // порядок важен: сначала целые ссылки, потом одиночные адреса
  const apply = (re, getTarget) => {
    out = out.replace(re, (m, target, offset) => {
      const found = userEmailsIn(getTarget(target));
      if (!found.length) return m;
      hits.push({ line: lineAt2(offset), masked: maskEmail(found[0]) });
      return REDACTED;
    });
  };
  // номер строки считаем по тексту на момент прохода (замены не меняют число переводов строк)
  const lineAt2 = (idx) => out.slice(0, idx).split('\n').length;
  apply(MD_MAILTO, (t) => t);
  apply(HTML_MAILTO, (t) => t);
  out = out.replace(AUTOLINK, (m, addr, offset) => {
    const e = normalizeEmail(addr);
    if (!userEmails.has(e)) return m;
    hits.push({ line: lineAt2(offset), masked: maskEmail(e) });
    return REDACTED;
  });
  out = out.replace(EMAIL, (m, offset) => {
    const e = normalizeEmail(m);
    if (!userEmails.has(e)) return m;
    hits.push({ line: lineAt2(offset), masked: maskEmail(e) });
    return REDACTED;
  });
  return { text: out, hits };
}

export function redactUserEmails(outDir, userEmails) {
  const items = [];
  let total = 0;
  if (!userEmails?.size) return { total, items };
  const dir = path.join(outDir, 'content');
  for (const file of walk(dir)) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const { text: out, hits } = redactText(text, userEmails);
    if (!hits.length) continue;
    fs.writeFileSync(file, out);
    const rel = path.relative(outDir, file).replace(/\\/g, '/');
    const byLine = new Map();
    for (const h of hits) {
      const r = byLine.get(h.line) || { file: rel, line: h.line, count: 0, masked: new Set() };
      r.count++;
      r.masked.add(h.masked);
      byLine.set(h.line, r);
    }
    for (const r of [...byLine.values()].sort((a, b) => a.line - b.line)) items.push({ file: r.file, line: r.line, count: r.count, masked: [...r.masked] });
    total += hits.length;
  }
  return { total, items };
}
