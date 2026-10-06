import fs from 'node:fs';
import path from 'node:path';
import { walk } from './util.mjs';

/** Проверка выгруженных md-файлов по контракту docs/PLAN.md. */

export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(': ');
    if (i < 0) return null;
    try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 2)); } catch { return null; }
  }
  return { data, body: text.slice(m[0].length) };
}

const PAGE_KEYS = new Set(['title', 'description', 'menu', 'order', 'image', 'draft']);
const POST_KEYS = new Set(['title', 'description', 'date', 'updated', 'category', 'tags', 'cover', 'draft']);

export function validateFrontmatter(type, d) {
  const errors = [];
  const allowed = type === 'page' ? PAGE_KEYS : POST_KEYS;
  for (const k of Object.keys(d)) if (!allowed.has(k)) errors.push(`лишнее поле «${k}»`);
  const str = (k, req) => {
    if (d[k] === undefined) { if (req) errors.push(`нет обязательного поля «${k}»`); return; }
    if (typeof d[k] !== 'string' || (req && !d[k].trim())) errors.push(`поле «${k}» должно быть непустой строкой`);
  };
  str('title', true);
  str('description');
  if (type === 'page') {
    if (d.menu !== undefined && typeof d.menu !== 'boolean') errors.push('menu должно быть boolean');
    if (d.order !== undefined && typeof d.order !== 'number') errors.push('order должно быть числом');
    if (d.image !== undefined && !(typeof d.image === 'string' && d.image.startsWith('/uploads/'))) errors.push('image должно начинаться с /uploads/');
  } else {
    str('date', true);
    if (typeof d.date === 'string' && Number.isNaN(Date.parse(d.date))) errors.push('date не является датой');
    if (d.updated !== undefined && Number.isNaN(Date.parse(d.updated))) errors.push('updated не является датой');
    str('category');
    if (d.tags !== undefined && !(Array.isArray(d.tags) && d.tags.every((t) => typeof t === 'string'))) errors.push('tags должно быть массивом строк');
    if (d.cover !== undefined && !(typeof d.cover === 'string' && d.cover.startsWith('/uploads/'))) errors.push('cover должно начинаться с /uploads/');
  }
  if (d.draft !== undefined && typeof d.draft !== 'boolean') errors.push('draft должно быть boolean');
  return errors;
}

export function validateOutput(outDir) {
  const problems = [];
  let checked = 0;
  for (const [kind, sub] of [['page', 'pages'], ['post', 'posts']]) {
    const base = path.join(outDir, 'content', sub);
    if (!fs.existsSync(base)) continue;
    for (const f of walk(base)) {
      if (!f.endsWith('.md')) continue;
      checked++;
      const rel = path.relative(outDir, f).replace(/\\/g, '/');
      const fm = parseFrontmatter(fs.readFileSync(f, 'utf8'));
      if (!fm) { problems.push({ file: rel, error: 'не удалось разобрать frontmatter' }); continue; }
      for (const e of validateFrontmatter(kind, fm.data)) problems.push({ file: rel, error: e });
      const slug = path.basename(f, '.md');
      if (!/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(slug)) problems.push({ file: rel, error: 'имя файла не похоже на slug' });
      if (kind === 'post' && path.dirname(f) !== base) problems.push({ file: rel, error: 'посты должны лежать в content/posts без подпапок' });
    }
  }
  return { checked, problems };
}
