import { formatBytes, mdEscapeCell, uniq } from './util.mjs';
import { describePlugin } from './plugins.mjs';

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

export function buildReport({ model, plan, collected, links, mediaStats, redirects, design, shots, validation, warnings, opts }) {
  const siteName = model.options.blogname || '';
  const types = {};
  for (const p of model.posts.values()) {
    const t = (types[p.post_type] ||= { total: 0, publish: 0, draft: 0, other: 0 });
    t.total++;
    if (p.post_status === 'publish' && !p.protected) t.publish++;
    else if (['draft', 'pending', 'future'].includes(p.post_status)) t.draft++;
    else t.other++;
  }

  const plugins = (model.options.active_plugins || []).map((p) => ({ file: p, ...describePlugin(p) }));
  const externalByHost = {};
  for (const l of links.stats.external) {
    const h = hostOf(l.url);
    if (!h) continue;
    (externalByHost[h] ||= new Set()).add(l.url);
  }
  const embedsBy = {};
  for (const e of collected.embeds) (embedsBy[e.kind] ||= []).push(e);

  const manual = [...collected.manual.entries()].map(([source, reasons]) => ({ source, reasons: [...reasons] }));
  const shortcodes = Object.entries(collected.shortcodes).map(([name, s]) => ({ name, kind: s.kind, sources: [...s.sources] }));

  const data = {
    generatedAt: new Date().toISOString(),
    site: { name: siteName, url: plan.site, description: model.options.blogdescription || '', permalinkStructure: model.options.permalink_structure || '(по умолчанию: ?p=ID)', theme: model.options.stylesheet || '', parentTheme: model.options.template && model.options.template !== model.options.stylesheet ? model.options.template : null, frontPage: plan.frontPageId ? plan.byId.get(plan.frontPageId)?.newPath || null : null, source: model.source, tablePrefix: model.prefix },
    counts: {
      pages: plan.pages.length,
      posts: plan.posts.length,
      media: { used: mediaStats.copied, totalBytes: mediaStats.totalBytes },
      attachmentsInDb: plan.attachments.size,
      drafts: plan.drafts.length,
      privateOrProtected: { private: model.counts.private, protected: model.counts.protected },
      trashed: model.counts.trashed,
      redirects: redirects.rows.length,
      usersInDump: model.userCount,
    },
    postTypes: types,
    otherPostTypes: plan.otherTypes,
    skippedTypes: model.counts.skipped,
    plugins,
    menu: collected.menu || null,
    menus: (plan.menus || []).map((m) => ({ name: m.name, locations: m.locations, items: m.count })),
    forms: collected.forms,
    embeds: collected.embeds,
    shortcodes,
    links: {
      internalOk: links.stats.internalOk,
      internalBroken: links.stats.internalBroken,
      unsupportedAssets: links.stats.unsupportedAssets,
      externalCount: links.stats.external.length,
      externalHosts: Object.fromEntries(Object.entries(externalByHost).map(([h, s]) => [h, [...s].sort()])),
      mailto: links.stats.mailto,
      categoryOrTagLinksToNews: links.stats.taxonomyRedirected,
    },
    media: mediaStats,
    drafts: plan.drafts,
    slugChanges: plan.slugChanges,
    manual,
    emptyContent: collected.emptyContent,
    design: design && { themes: design.themes, templates: design.templates.map((t) => t.theme + '/' + t.file), branding: design.branding, warnings: design.warnings, notes: design.notes, copiedFiles: design.copied.length },
    screenshots: shots || null,
    validation,
    warnings,
    notes: plan.notes,
    secretsScan: null,
    opts: { maxImageBytes: opts.maxImageBytes },
  };
  return data;
}

export function renderReportMd(r) {
  const L = [];
  const h = (t, n = 2) => L.push('', `${'#'.repeat(n)} ${t}`, '');
  L.push(`# Отчёт экспорта WordPress → Astro`, '');
  L.push(`Сайт: **${r.site.name || '—'}** (${r.site.url || '—'}) · источник: ${r.site.source === 'wxr' ? 'WXR-файл' : 'SQL-дамп'} · префикс таблиц: \`${r.site.tablePrefix || '—'}\` · ${r.generatedAt}`);
  L.push('', '> Этот отчёт — для вас, **не коммитьте его** в публичный репозиторий (в нём список черновиков и внутренние адреса).');

  h('Итого');
  const c = r.counts;
  L.push('| Что | Количество |', '|---|---|');
  L.push(`| Страницы (экспортировано) | ${c.pages} |`, `| Записи/новости (экспортировано) | ${c.posts} |`, `| Файлов медиа скопировано | ${c.media.used} (${formatBytes(c.media.totalBytes)}) |`, `| Вложений в базе | ${c.attachmentsInDb} |`);
  L.push(`| Черновики/ожидающие (не экспортированы) | ${c.drafts} |`, `| Приватные / под паролем (не экспортированы) | ${c.privateOrProtected.private} / ${c.privateOrProtected.protected} |`, `| В корзине (игнорировано) | ${c.trashed} |`, `| Правил редиректа | ${c.redirects} |`);
  L.push(`| Главная страница | ${r.site.frontPage ? 'есть → index.md' : '**не задана** (на WP — лента записей); главную придётся сделать вручную'} |`);
  L.push(`| Структура ссылок WP | \`${r.site.permalinkStructure}\` |`, `| Активная тема | ${r.site.theme || '—'}${r.site.parentTheme ? ` (родитель: ${r.site.parentTheme})` : ''} |`);

  h('Типы записей');
  L.push('| Тип | Всего | Опубликовано | Черновики | Прочее |', '|---|---|---|---|---|');
  for (const [t, v] of Object.entries(r.postTypes).sort((a, b) => b[1].total - a[1].total)) L.push(`| ${t} | ${v.total} | ${v.publish} | ${v.draft} | ${v.other} |`);
  const other = Object.entries(r.otherPostTypes);
  if (other.length) {
    L.push('', '**Нестандартные типы записей — автоматически НЕ экспортируются** (нужен ручной перенос или отдельное решение):', '');
    for (const [t, v] of other) L.push(`- \`${t}\`: ${v.total} шт., опубликовано ${v.publish}${v.titles.length ? ` — например: ${v.titles.slice(0, 5).map((x) => `«${mdEscapeCell(x)}»`).join(', ')}` : ''}`);
  }
  const sk = Object.entries(r.skippedTypes);
  if (sk.length) L.push('', `Служебные записи (ревизии и т.п.) проигнорированы: ${sk.map(([t, n]) => `${t} — ${n}`).join(', ')}.`);

  h('Плагины и что они значат для Astro');
  if (!r.plugins.length) L.push('Активных плагинов в дампе не найдено (или опция active_plugins отсутствует).');
  else {
    L.push('| Плагин | Категория | Что делать в Astro |', '|---|---|---|');
    for (const p of r.plugins) L.push(`| \`${p.slug}\` | ${p.category} | ${mdEscapeCell(p.advice)} |`);
  }

  h('Меню');
  if (!r.menu) L.push('Меню навигации не найдено.');
  else {
    L.push(`Главное меню: **${r.menu.name}**${r.menu.locations?.length ? ` (расположение: ${r.menu.locations.join(', ')})` : ''}. Сохранено в \`design-import/menu.json\`.`, '');
    const walkMenu = (items, d) => items.forEach((it) => { L.push(`${'  '.repeat(d)}- ${mdEscapeCell(it.title || '(без названия)')} → \`${it.href || (it.kind === 'unresolved' ? '⚠ не найдено' : '—')}\` _(${it.kind})_`); walkMenu(it.children, d + 1); });
    walkMenu(r.menu.items, 0);
    if ((r.menus || []).length > 1) L.push('', 'Другие меню: ' + r.menus.filter((m) => m.name !== r.menu.name).map((m) => `${m.name} (${m.items})`).join(', '));
  }

  h('Формы');
  if (!r.forms.length) L.push('Форм не найдено.');
  else { L.push('Формы на статическом сайте не работают — нужен внешний сервис или замена контактами:', ''); for (const f of r.forms) L.push(`- ${f.source}: ${f.what}`); }

  h('Внешние встраивания');
  const kinds = {};
  for (const e of r.embeds) (kinds[e.kind] ||= []).push(e);
  if (!r.embeds.length) L.push('Не найдено.');
  else for (const [k, list] of Object.entries(kinds)) { L.push(`**${k}** (${list.length}):`); for (const e of list) L.push(`- ${e.source}: ${e.url}`); L.push(''); }

  if (r.shortcodes.length) {
    h('Шорткоды');
    L.push('| Шорткод | Статус | Где |', '|---|---|---|');
    for (const s of r.shortcodes) L.push(`| \`[${s.name}]\` | ${s.kind === 'unknown' ? '⚠ не перенесён' : s.kind === 'form' ? 'форма' : 'сконвертирован'} | ${s.sources.join(', ')} |`);
  }

  h('Ссылки');
  const lk = r.links;
  L.push(`- Внутренние ссылки, переписанные на новые адреса: **${lk.internalOk}**`, `- Ссылки на рубрики/метки (ведут на /news/): ${lk.categoryOrTagLinksToNews}`, `- Внешних ссылок: ${lk.externalCount}, mailto: ${lk.mailto}`);
  if (lk.internalBroken.length) { L.push('', '**Битые внутренние ссылки** (нужно поправить вручную):', ''); for (const b of lk.internalBroken) L.push(`- ${b.source}: ${b.url} — ${b.reason}`); }
  if (lk.unsupportedAssets.length) { L.push('', '**Ссылки на файлы вне uploads** (темы/плагины/прочее):', ''); for (const b of lk.unsupportedAssets) L.push(`- ${b.source}: ${b.url}`); }
  const hosts = Object.entries(lk.externalHosts).sort((a, b) => b[1].length - a[1].length);
  if (hosts.length) { L.push('', '**Внешние домены** (доступность не проверялась — инструмент работает без сети):', ''); for (const [host, urls] of hosts) L.push(`- ${host} — ${urls.length}`); L.push('', 'Полный список — в `report.json`.'); }

  h('Медиа');
  const m = r.media;
  if (!m.uploadsDirFound) L.push('⚠ Папка `wp-content/uploads` не найдена — файлы не скопированы, ссылки переписаны на `/uploads/…`.');
  else {
    L.push(`- Скопировано файлов: **${m.copied}**, общий размер **${formatBytes(m.totalBytes)}**`, `- В uploads всего файлов: ${m.uploadsTotal}, из них миниатюр вида \`-300x200\`: ${m.uploadsThumbnails}; не скопировано (не используются): ${m.notCopied}`);
    if (m.heavy.length) { L.push('', `**Тяжёлые файлы (> ${formatBytes(r.opts.maxImageBytes)}) — стоит оптимизировать:**`, ''); for (const f of m.heavy) L.push(`- ${f.file} — ${formatBytes(f.size)}`); }
    if (m.largest.length) { L.push('', 'Крупнейшие файлы: ' + m.largest.slice(0, 5).map((f) => `${f.file} (${formatBytes(f.size)})`).join(', ')); }
  }
  if (m.missing.length) { L.push('', '**Файлы, упомянутые в контенте, но не найденные:**', ''); for (const f of m.missing) L.push(`- ${f.file}${f.usedBy.length ? ` ← ${f.usedBy.join(', ')}` : ''}`); }

  h('Черновики (не экспортированы, только список)');
  if (!r.drafts.length) L.push('Нет.');
  else { L.push('| ID | Тип | Статус | Название | Изменён |', '|---|---|---|---|---|'); for (const d of r.drafts) L.push(`| ${d.id} | ${d.type} | ${d.status} | ${mdEscapeCell(d.title || '(без названия)')} | ${d.modified} |`); }

  if (r.slugChanges.length) {
    h('Изменённые адреса (slug)');
    L.push('Кириллические/небезопасные адреса преобразованы; старые адреса в `redirects.csv`.', '', '| Тип | Было | Стало |', '|---|---|---|');
    for (const s of r.slugChanges.slice(0, 200)) L.push(`| ${s.type} | ${mdEscapeCell(s.from)} | ${s.to} |`);
  }

  h('Требует ручного внимания');
  if (!r.manual.length) L.push('Ничего особенного не обнаружено.');
  else for (const x of r.manual) L.push(`- **${x.source}** — ${x.reasons.join('; ')}`);

  h('Дизайн');
  if (!r.design) L.push('Не экспортировался.');
  else {
    L.push(`Темы: ${r.design.themes.map((t) => `${t.slug} (${t.role}${t['Theme Name'] ? ', «' + t['Theme Name'] + '»' : ''})`).join('; ') || '—'}`, `Шаблонов описано: ${r.design.templates.length}; скопировано файлов: ${r.design.copiedFiles}; брендинг: ${r.design.branding.map((b) => b.role).join(', ') || 'не найден'}`);
    for (const w of r.design.warnings) L.push(`- ⚠ ${w}`);
    for (const n of r.design.notes) L.push(`- ℹ ${n}`);
  }
  if (r.screenshots) L.push('', r.screenshots.ok ? `Скриншоты: ${r.screenshots.shots.length} файл(ов) в design-import/screenshots/` : `Скриншоты не сделаны: ${r.screenshots.error || 'нет'}`);

  h('Проверка результата по контракту');
  L.push(`Проверено md-файлов: ${r.validation.checked}; ошибок: ${r.validation.problems.length}`);
  for (const p of r.validation.problems) L.push(`- ${p.file}: ${p.error}`);

  if (r.warnings.length || r.notes.length) {
    h('Предупреждения');
    for (const w of uniq([...r.warnings, ...r.notes])) L.push(`- ${w}`);
  }

  h('Проверка на секреты');
  const s = r.secretsScan;
  if (!s) L.push('Не выполнялась.');
  else {
    L.push(`Просканировано файлов: ${s.scanned}. ${s.hard.length ? '🛑 **НАЙДЕНЫ СЕКРЕТЫ — НЕ КОММИТЬТЕ ВЫВОД!**' : 'Хэшей паролей, ключей wp-config и данных пользователей не найдено.'}`);
    for (const x of s.hard) L.push(`- 🛑 ${x.file}: ${x.kind}`);
    if (s.emails.length) {
      L.push('', '⚠ **В тексте найдены e-mail адреса.** Если это публичные контакты клуба — подтвердите их флагом `--allow-email адрес`; иначе удалите из текста перед коммитом:', '');
      for (const e of s.emails) L.push(`- ${e.file}: ${e.email}`);
    }
  }
  return L.join('\n') + '\n';
}
