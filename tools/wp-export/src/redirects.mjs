import { csvCell, encodePathStrict } from './util.mjs';

/** redirects.csv по контракту PLAN.md: from,to,status (пути от корня, в процентном кодировании). */
export function buildRedirects(plan, model, media) {
  const rows = [];
  const seen = new Set();
  const add = (from, to, status = 301) => {
    if (!from || !to || from === to) return;
    if (seen.has(from)) return;
    seen.add(from);
    rows.push({ from, to, status });
  };
  const newTarget = (p) => encodePathStrict(p);

  for (const e of [...plan.pages, ...plan.posts]) {
    for (const old of plan.oldPaths.get(e.id) || []) add(old, newTarget(e.newPath));
  }
  if (plan.blogEntry) for (const old of plan.oldPaths.get(plan.blogEntry.id) || []) add(old, '/news/');

  const categoryBase = (model.options.category_base || 'category').replace(/^\/|\/$/g, '');
  const tagBase = (model.options.tag_base || 'tag').replace(/^\/|\/$/g, '');
  for (const c of plan.allCategories) add(`/${categoryBase}/${encodePathStrict(decode(c.slug))}/`, '/news/');
  for (const t of plan.allTags) add(`/${tagBase}/${encodePathStrict(decode(t.slug))}/`, '/news/');
  add('/feed/', '/rss.xml');
  add('/?feed=rss2', '/rss.xml');

  for (const rel of [...media.files.keys()].sort()) add('/wp-content/uploads/' + encodePathStrict(rel), '/uploads/' + encodePathStrict(rel));
  for (const a of media.aliases()) add('/wp-content/uploads/' + encodePathStrict(a.from), '/uploads/' + encodePathStrict(a.to));

  const csv = 'from,to,status\n' + rows.map((r) => [r.from, r.to, r.status].map(csvCell).join(',')).join('\n') + '\n';
  return { rows, csv };
}

function decode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}
