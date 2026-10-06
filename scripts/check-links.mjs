// Проверка собранного сайта: внутренние ссылки, картинки, скрипты и стили в dist/ не битые.
// Запуск: node scripts/check-links.mjs [dist]  (после npm run build)
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const ORIGIN = 'https://kendo-baikal.ru';

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const exists = async (p) => stat(p).then((s) => s.isFile(), () => false);

/** URL → файл в dist (как это сделает nginx: /a/ → /a/index.html, /a → /a или /a/index.html) */
async function resolves(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(dist, p);
  return (await exists(file)) || (!p.endsWith('.html') && (await exists(join(file, 'index.html'))));
}

const ATTR = /\b(?:href|src|poster|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const SRCSET = /\bsrcset\s*=\s*"([^"]*)"/gi;

function refsOf(html) {
  const refs = new Set();
  for (const m of html.matchAll(ATTR)) refs.add(m[1] ?? m[2]);
  for (const m of html.matchAll(SRCSET)) {
    for (const part of m[1].split(',')) refs.add(part.trim().split(/\s+/)[0]);
  }
  return refs;
}

const errors = [];
let files = 0;
let checked = 0;

for await (const file of walk(dist)) {
  if (!file.endsWith('.html')) continue;
  files++;
  const page = '/' + posix.relative(dist, file).split('\\').join('/');
  const pageUrl = page.endsWith('/index.html') ? page.slice(0, -'index.html'.length) : page;
  const html = await readFile(file, 'utf8');
  // JSON-LD и прочие <script type=application/ld+json> не содержат ссылок-атрибутов, но уберём на всякий случай
  const body = html.replace(/<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g, '');
  for (let ref of refsOf(body)) {
    ref = ref.trim();
    if (!ref || ref.startsWith('#')) continue;
    if (/^(mailto:|tel:|data:|javascript:|sms:)/i.test(ref)) continue;
    if (ref.startsWith(ORIGIN)) ref = ref.slice(ORIGIN.length) || '/';
    if (/^(https?:)?\/\//i.test(ref)) continue; // внешние не проверяем
    const url = new URL(ref, `http://x${pageUrl}`);
    checked++;
    if (!(await resolves(url.pathname))) errors.push(`${pageUrl}  →  ${ref}`);
  }
}

if (errors.length) {
  console.error(`✗ Битые внутренние ссылки (${errors.length}):`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(`✓ check-links: ${files} страниц, ${checked} внутренних ссылок — без ошибок`);
