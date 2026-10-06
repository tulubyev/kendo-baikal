// Валидирует redirects.csv (формат — docs/PLAN.md) и проверяет, что цели `to` есть в dist/.
// Сами редиректы делает nginx; здесь только контроль данных. Нет файла — проверка пропускается.
// Запуск: node scripts/check-redirects.mjs [redirects.csv] [dist]
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const csvPath = resolve(process.argv[2] ?? 'redirects.csv');
const dist = resolve(process.argv[3] ?? 'dist');
const STATUSES = new Set(['301', '302', '307', '308']);

let text;
try {
  text = await readFile(csvPath, 'utf8');
} catch {
  console.log('✓ check-redirects: redirects.csv не найден — пропускаю');
  process.exit(0);
}

/** Разбор одной CSV-строки с поддержкой "кавычек" */
function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') (out.push(cur), (cur = ''));
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const exists = async (p) => stat(p).then((s) => s.isFile(), () => false);
async function targetExists(to) {
  let p;
  try {
    p = decodeURIComponent(new URL(to, 'http://x').pathname);
  } catch {
    return false;
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dist, p);
  return (await exists(f)) || (!p.endsWith('.html') && (await exists(join(f, 'index.html'))));
}

const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
const errors = [];
const err = (n, msg) => errors.push(`строка ${n}: ${msg}`);

if (lines[0]?.trim().toLowerCase().replace(/\s/g, '') !== 'from,to,status') {
  err(1, 'первая строка должна быть заголовком «from,to,status»');
}

const seen = new Map();
const rows = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const n = i + 1;
  const cols = parseLine(lines[i]);
  if (cols.length < 2 || cols.length > 3) {
    err(n, `ожидалось 2–3 поля, найдено ${cols.length}`);
    continue;
  }
  const [from, to, status = ''] = cols;
  if (!from.startsWith('/')) err(n, `from должен начинаться с «/»: ${from}`);
  if (!to.startsWith('/') && !/^https?:\/\//.test(to)) err(n, `to должен начинаться с «/» или http(s)://: ${to}`);
  if (status && !STATUSES.has(status)) err(n, `недопустимый статус ${status} (301/302/307/308)`);
  if (from === to) err(n, `from и to совпадают: ${from}`);
  if (seen.has(from)) err(n, `повтор from ${from} (строка ${seen.get(from)})`);
  else seen.set(from, n);
  rows.push({ n, from, to });
}

let checked = 0;
for (const { n, from, to } of rows) {
  if (!to.startsWith('/')) continue; // внешняя цель
  checked++;
  if (!(await targetExists(to))) err(n, `цель ${to} не найдена в dist/ (для ${from})`);
  if (seen.has(to)) err(n, `цепочка/петля: цель ${to} сама является from (строка ${seen.get(to)})`);
}

if (errors.length) {
  console.error(`✗ check-redirects: ${errors.length} ошибок`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(`✓ check-redirects: ${rows.length} правил, ${checked} внутренних целей — без ошибок`);
