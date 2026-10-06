import fs from 'node:fs';
import path from 'node:path';
import { walk } from './util.mjs';

/** Самопроверка вывода на секреты/личные данные. */

const TEXT_EXT = /\.(md|csv|json|css|txt|html?|xml|svg|js|mjs|yml|yaml|map)$/i;

const HASH_PATTERNS = [
  ['хэш пароля WordPress ($P$ / $H$)', /\$[PH]\$[./0-9A-Za-z]{20,}/],
  ['хэш пароля WordPress ($wp$)', /\$wp\$[./0-9A-Za-z$]{20,}/],
  ['bcrypt-хэш', /\$2[abxy]\$\d\d\$[./0-9A-Za-z]{40,}/],
  ['закрытый ключ', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['токен GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['ключ AWS', /\bAKIA[0-9A-Z]{16}\b/],
];
const WPCONFIG = /\b(AUTH_KEY|SECURE_AUTH_KEY|LOGGED_IN_KEY|NONCE_KEY|AUTH_SALT|SECURE_AUTH_SALT|LOGGED_IN_SALT|NONCE_SALT|DB_PASSWORD|DB_USER|DB_HOST|DB_NAME)\b\s*['"]?\s*[,=]/;
// в Markdown конвертер экранирует «_» и «*» (john\_doe@…), поэтому в локальной части допускаем «\_» и «\*»
export const EMAIL = /(?:[A-Za-z0-9._%+-]|\\[_*])+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
export const normalizeEmail = (s) => s.replace(/\\/g, '').toLowerCase();
const NOT_EMAIL_TLD = /\.(png|jpe?g|gif|webp|svg|avif|css|js|mjs|woff2?|ttf|otf|ico|map)$/i;

export function maskEmail(e) {
  const [l, d] = e.split('@');
  return `${l[0]}${'*'.repeat(Math.max(1, Math.min(l.length - 1, 5)))}@${d}`;
}

/**
 * Возвращает { hard:[], emails:[], scanned } — hard: хэши/ключи/«канарейки» из дампа (аварийно),
 * emails: адреса e-mail в тексте (требуют подтверждения владельца): { file, email (маска), raw, lines[] }.
 *
 * keepUserEmails — владелец явно оставил e-mail пользователей WordPress в тексте (--keep-user-emails):
 * в content/**.md они проверяются как обычные адреса (нужен --allow-email), в остальных файлах остаются аварийными.
 */
export function scanOutput(outDir, { canaries, allowEmails = [], skip = () => false, keepUserEmails = false } = {}) {
  const hard = [];
  const emailMap = new Map();
  const allow = allowEmails.map((a) => a.toLowerCase());
  const isAllowed = (e) => allow.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
  const canaryEmails = canaries?.emails || new Set();
  const canaryHashes = [...(canaries?.hashes || [])];
  let scanned = 0;

  for (const file of walk(outDir)) {
    const rel = path.relative(outDir, file).replace(/\\/g, '/');
    if (skip(rel) || !TEXT_EXT.test(file)) continue;
    let text;
    try {
      const st = fs.statSync(file);
      if (st.size > 20 * 1024 * 1024) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    scanned++;
    for (const [name, re] of HASH_PATTERNS) if (re.test(text)) hard.push({ file: rel, kind: name });
    if (WPCONFIG.test(text)) hard.push({ file: rel, kind: 'константы wp-config.php (ключи/соли/доступ к БД)' });
    for (const h of canaryHashes) if (text.includes(h)) hard.push({ file: rel, kind: 'значение из таблицы пользователей WordPress (хэш/ключ)' });
    const emailsExempt = rel.startsWith('design-import/theme/') || rel.startsWith('design-import/screenshots/');
    const isContentMd = /^content\/.+\.md$/.test(rel);
    for (const m of emailsExempt ? [] : text.matchAll(EMAIL)) {
      const e = normalizeEmail(m[0]);
      if (NOT_EMAIL_TLD.test(e)) continue;
      if (canaryEmails.has(e) && !(keepUserEmails && isContentMd)) { hard.push({ file: rel, kind: `e-mail пользователя WordPress (${maskEmail(e)})` }); continue; }
      if (isAllowed(e)) continue;
      const k = rel + '\0' + e;
      if (!emailMap.has(k)) emailMap.set(k, { file: rel, email: maskEmail(e), raw: e, lines: [], userEmail: canaryEmails.has(e) });
      const line = text.slice(0, m.index).split('\n').length;
      const rec = emailMap.get(k);
      if (!rec.lines.includes(line)) rec.lines.push(line);
    }
  }
  const uniq = (arr, key) => [...new Map(arr.map((x) => [key(x), x])).values()];
  return { hard: uniq(hard, (x) => x.file + x.kind), emails: [...emailMap.values()], scanned };
}
