import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, FIXTURE_SECRETS } from './make-fixture.mjs';
import { runExport, EXIT } from '../src/run.mjs';
import { parseFrontmatter, validateFrontmatter } from '../src/validate.mjs';
import { tmp, read, exists } from './helpers.mjs';
import { walk } from '../src/util.mjs';

let fx;
let out;
let res;

before(async () => {
  const dir = tmp();
  fx = makeFixture(path.join(dir, 'fx'));
  out = path.join(dir, 'out');
  res = await runExport({ sql: fx.sql, wpContent: fx.wpContent, siteUrl: fx.siteUrl, out, quiet: true });
});

const fm = (rel) => parseFrontmatter(read(out, rel));

test('прогон завершается успешно, секретов нет', () => {
  assert.equal(res.exitCode, EXIT.OK);
  assert.equal(res.report.secretsScan.hard.length, 0);
});

test('структура вывода: content/pages, content/posts, public/uploads, design-import, redirects.csv, отчёты', () => {
  for (const p of ['content/pages/index.md', 'content/pages/klub.md', 'content/pages/klub/istoriya.md', 'content/pages/contacts.md', 'content/posts/pervyy-turnir.md', 'content/posts/second-post.md', 'content/posts/second-post-2.md', 'redirects.csv', 'report.md', 'report.json', 'design-import/menu.json', 'design-import/tokens.json', 'design-import/templates.md', 'public/uploads/2021/05/photo.jpg']) {
    assert.ok(exists(out, p), `нет ${p}`);
  }
});

test('frontmatter всех файлов валиден по контракту PLAN.md', () => {
  const files = walk(path.join(out, 'content')).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, 7);
  for (const f of files) {
    const rel = path.relative(out, f).replace(/\\/g, '/');
    const parsed = parseFrontmatter(fs.readFileSync(f, 'utf8'));
    assert.ok(parsed, `frontmatter не разобран: ${rel}`);
    const errors = validateFrontmatter(rel.startsWith('content/pages') ? 'page' : 'post', parsed.data);
    assert.deepEqual(errors, [], rel);
  }
  assert.deepEqual(res.report.validation.problems, []);
});

test('поля страниц и постов', () => {
  const home = fm('content/pages/index.md').data;
  assert.equal(home.title, 'Главная');
  assert.equal(home.menu, true);
  assert.equal(home.order, 10);
  const club = fm('content/pages/klub.md').data;
  assert.equal(club.menu, true);
  assert.equal(club.image, '/uploads/2021/06/gallery1.jpg');
  assert.equal(fm('content/pages/klub/istoriya.md').data.menu, undefined); // вложенный пункт меню не top-level
  const post = fm('content/posts/pervyy-turnir.md').data;
  assert.equal(post.date, '2021-05-01T12:30:00Z');
  assert.equal(post.updated, '2021-06-10T09:00:00Z');
  assert.equal(post.category, 'Турниры');
  assert.deepEqual(post.tags, ['кендо', 'соревнования']);
  assert.equal(post.cover, '/uploads/2021/05/photo.jpg');
  assert.equal(post.description, 'Описание из Yoast про первый турнир');
  assert.equal(fm('content/posts/second-post.md').data.category, undefined); // «Без рубрики» не переносится
});

test('slug: кириллица транслитерирована, дубликаты различаются, вложенные страницы в подпапках', () => {
  assert.ok(exists(out, 'content/posts/pervyy-turnir.md'));
  assert.ok(exists(out, 'content/pages/klub/istoriya.md'));
  assert.ok(exists(out, 'content/posts/second-post-2.md'));
});

test('режим --slug-mode keep сохраняет кириллицу', async () => {
  const o2 = path.join(tmp(), 'o');
  await runExport({ sql: fx.sql, wpContent: fx.wpContent, siteUrl: fx.siteUrl, out: o2, quiet: true, slugMode: 'keep' });
  assert.ok(exists(o2, 'content/pages/клуб.md'));
  assert.ok(exists(o2, 'content/posts/первый-турнир.md'));
});

test('не экспортируются черновики, приватные, под паролем, ревизии, заказы, пользователи', () => {
  const all = walk(out).filter((f) => /\.(md|json|csv)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const bad of ['ЧЕРНОВИК-СОДЕРЖИМОЕ', 'ПРИВАТНОЕ-СОДЕРЖИМОЕ', 'ПАРОЛЬ-СОДЕРЖИМОЕ', 'ЧЕРНОВИК-ПОСТА', 'РЕВИЗИЯ-НЕ', 'ЗАКАЗ', FIXTURE_SECRETS.email, FIXTURE_SECRETS.hash, FIXTURE_SECRETS.salt, 'commenter@example.org', 'customer@example.org']) {
    assert.ok(!all.includes(bad), `в выводе найдено: ${bad}`);
  }
  assert.ok(!exists(out, 'content/pages/secret-draft.md'));
  assert.ok(!exists(out, 'content/pages/private-page.md'));
  assert.ok(!exists(out, 'content/pages/protected-page.md'));
  assert.ok(!exists(out, 'content/posts/draft-post.md'));
});

test('черновики перечислены в отчёте без содержимого', () => {
  const titles = res.report.drafts.map((d) => d.title);
  assert.ok(titles.includes('Секретный черновик') && titles.includes('Draft post'));
  assert.ok(res.report.drafts.every((d) => !('content' in d)));
  assert.equal(res.report.counts.privateOrProtected.private, 1);
  assert.equal(res.report.counts.privateOrProtected.protected, 1);
});

test('Gutenberg, шорткоды, таблицы, вложенные списки, встраивания в Markdown', () => {
  const home = fm('content/pages/index.md').body;
  assert.ok(!/wp:|<!--more/.test(home));
  assert.match(home, /^## Кендо на Байкале$/m);
  assert.match(home, /\[историю клуба\]\(\/klub\/istoriya\/\)/); // ссылка со старого кириллического адреса переписана
  assert.match(home, /\[первый турнир\]\(\/news\/pervyy-turnir\/\)/); // /?p=101
  assert.match(home, /!\[Фото\]\(\/uploads\/2021\/05\/photo-300x200\.jpg\)\n\n\*Подпись к фото\*/);
  assert.ok(!/Скачать/.test(home)); // кнопка wp:file отброшена
  assert.match(home, /\[Правила\]\(\/uploads\/docs\/rules\.pdf\)/);

  const club = fm('content/pages/klub.md').body;
  assert.match(club, /!\[Кендо\]\(\/uploads\/2021\/05\/фото%20кендо\.jpg\)\n\n\*Тренировка\*/);
  assert.match(club, /!\[\]\(\/uploads\/2021\/06\/gallery1\.jpg\)/);
  assert.match(club, /!\[\]\(\/uploads\/2021\/06\/gallery2\.jpg\)/);

  const hist = fm('content/pages/klub/istoriya.md').body;
  assert.match(hist, /- Пункт два\n  - вложенный/);
  assert.match(hist, /\| Год \| Событие \|/);
  assert.match(hist, /TODO\(wp-export\): форма \[contact-form-7\]/);
  assert.match(hist, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(hist, /\[рубрика\]\(\/news\/\)/);

  const contacts = fm('content/pages/contacts.md').body;
  assert.ok(!/alert\(/.test(contacts));
  assert.match(contacts, /<iframe src="https:\/\/yandex\.ru\/map-widget/);

  const p2 = fm('content/posts/second-post.md').body;
  assert.match(p2, /Повторно используемый блок/);
});

test('медиа: копируются только используемые, миниатюры не используемые пропущены', () => {
  const copied = walk(path.join(out, 'public/uploads')).map((f) => path.relative(path.join(out, 'public/uploads'), f).replace(/\\/g, '/')).sort();
  assert.deepEqual(copied, ['2021/05/heavy.jpg', '2021/05/photo-300x200.jpg', '2021/05/photo.jpg', '2021/05/фото кендо.jpg', '2021/06/gallery1.jpg', '2021/06/gallery2.jpg', 'docs/rules.pdf']);
  assert.ok(!exists(out, 'public/uploads/unused.jpg'));
  assert.ok(!exists(out, 'public/uploads/2021/05/photo-150x150.jpg'));
  assert.ok(!exists(out, 'public/uploads/2020/01/logo.png')); // логотип — в design-import, не в uploads
});

test('медиа: предупреждение о тяжёлых файлах и об отсутствующих', () => {
  const m = res.report.media;
  assert.deepEqual(m.heavy.map((h) => h.file), ['2021/05/heavy.jpg']);
  assert.ok(m.totalBytes > 1_300_000);
  assert.deepEqual(m.missing.map((x) => x.file), ['missing/nope.jpg']);
  assert.ok(res.report.warnings.some((w) => /Тяжёлый файл/.test(w)));
});

test('если уменьшенной версии нет — ссылка заменяется на оригинал', async () => {
  const dir = tmp();
  const f = makeFixture(path.join(dir, 'fx'));
  fs.rmSync(path.join(f.wpContent, 'uploads/2021/05/photo-300x200.jpg'));
  const o = path.join(dir, 'o');
  await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: f.siteUrl, out: o, quiet: true });
  assert.match(read(o, 'content/pages/index.md'), /!\[Фото\]\(\/uploads\/2021\/05\/photo\.jpg\)/);
  assert.match(read(o, 'redirects.csv'), /\/wp-content\/uploads\/2021\/05\/photo-300x200\.jpg,\/uploads\/2021\/05\/photo\.jpg,301/);
});

test('redirects.csv: формат, старые URL по permalink_structure, /?p=ID, категории, uploads', () => {
  const csv = read(out, 'redirects.csv').trim().split('\n');
  assert.equal(csv[0], 'from,to,status');
  const rows = new Map(csv.slice(1).map((l) => { const [from, to, status] = l.split(','); return [from, { to, status }]; }));
  assert.equal(rows.get('/?p=101').to, '/news/pervyy-turnir/');
  assert.equal(rows.get('/2021/05/01/%D0%BF%D0%B5%D1%80%D0%B2%D1%8B%D0%B9-%D1%82%D1%83%D1%80%D0%BD%D0%B8%D1%80/').to, '/news/pervyy-turnir/');
  assert.equal(rows.get('/2021/07/15/second-post/').to, '/news/second-post/');
  assert.equal(rows.get('/2021/08/01/second-post/').to, '/news/second-post-2/');
  assert.equal(rows.get('/?page_id=4').to, '/klub/istoriya/');
  assert.equal(rows.get('/%D0%BA%D0%BB%D1%83%D0%B1/istoriya/').to, '/klub/istoriya/');
  assert.equal(rows.get('/glavnaya/').to, '/');
  assert.equal(rows.get('/category/%D1%82%D1%83%D1%80%D0%BD%D0%B8%D1%80%D1%8B/').to, '/news/');
  assert.equal(rows.get('/wp-content/uploads/docs/rules.pdf').to, '/uploads/docs/rules.pdf');
  for (const [from, v] of rows) {
    assert.ok(from.startsWith('/') && v.to.startsWith('/'));
    assert.equal(v.status, '301');
    assert.notEqual(from, v.to);
  }
  assert.equal(rows.size, csv.length - 1, 'повторяющиеся from');
});

test('отчёт: плагины, меню, формы, встраивания, ссылки, типы записей', () => {
  const r = res.report;
  assert.equal(r.counts.pages, 4);
  assert.equal(r.counts.posts, 3);
  const cats = Object.fromEntries(r.plugins.map((p) => [p.slug, p.category]));
  assert.equal(cats['contact-form-7'], 'Формы');
  assert.equal(cats['wordpress-seo'], 'SEO');
  assert.equal(cats.revslider, 'Слайдеры');
  assert.equal(cats['strange-plugin'], 'Неизвестно');
  assert.deepEqual(r.menu.items.map((i) => i.title), ['Главная', 'О клубе', 'Новости', 'Партнёр']);
  assert.equal(r.menu.items[1].children[0].href, '/klub/istoriya/');
  assert.ok(r.forms.some((f) => f.source === 'page:contacts'));
  assert.ok(r.forms.some((f) => /contact-form-7/.test(f.what)));
  assert.ok(r.embeds.some((e) => e.kind === 'youtube') && r.embeds.some((e) => e.kind === 'map'));
  assert.ok(r.links.internalBroken.some((b) => /nonexistent-page/.test(b.url)));
  assert.ok(r.links.externalHosts['external.example.net']);
  assert.ok(r.otherPostTypes.tribe_events);
  assert.ok(r.manual.some((m) => m.source === 'page:klub/istoriya' && m.reasons.some((x) => /fancy_thing/.test(x))));
  const md = read(out, 'report.md');
  for (const h of ['## Итого', '## Плагины', '## Меню', '## Формы', '## Внешние встраивания', '## Ссылки', '## Медиа', '## Черновики', '## Требует ручного внимания', '## Дизайн']) assert.ok(md.includes(h), h);
});

test('design-import: CSS, шрифты, логотип, токены, шаблоны; PHP не копируется', () => {
  const d = path.join(out, 'design-import');
  assert.ok(exists(d, 'theme/kendo-parent/style.css'));
  assert.ok(exists(d, 'theme/kendo-child/style.css'));
  assert.ok(exists(d, 'theme/kendo-parent/fonts/oswald.woff2'));
  assert.ok(exists(d, 'theme/kendo-parent/images/hero.jpg')); // на неё ссылается CSS
  assert.ok(exists(d, 'branding/logo.png'));
  assert.ok(exists(d, 'branding/site-icon.png'));
  assert.ok(!exists(d, 'theme/other-theme/style.css'));
  assert.ok(walk(d).every((f) => !f.endsWith('.php')));
  const t = JSON.parse(read(d, 'tokens.json'));
  assert.equal(t.colors.background, '#fafafa');
  assert.equal(t.colors.text, '#222222');
  assert.equal(t.colors.link, '#b3202a');
  assert.equal(t.colors.accent, '#b3202a');
  assert.match(t.fonts.body, /PT Sans/);
  assert.equal(t.fonts.fontFaces[0].family, 'Oswald');
  assert.equal(t.sizes.body, '17px');
  assert.equal(t.sizes.h1, '2.6rem');
  assert.equal(t.container.maxWidth, '1140px');
  assert.equal(t.container.contentSize, '760px');
  assert.equal(t.radius.default, '6px'); // 6px чаще, чем 8/10px
  const names = JSON.parse(read(d, 'templates.json')).map((x) => x.file);
  assert.ok(['header.php', 'footer.php', 'front-page.php', 'single.php'].every((n) => names.includes(n)));
  const tpl = read(d, 'templates.md');
  assert.match(tpl, /menu:primary/);
  assert.match(tpl, /widgets:footer-1/);
  assert.match(tpl, /<header\.site-header#masthead>/);
  assert.match(tpl, /Подключает: include:header, part:template-parts\/card-news, include:footer/);
});

test('menu.json: дерево главного меню', () => {
  const menu = JSON.parse(read(out, 'design-import/menu.json'));
  assert.equal(menu.items[1].children[0].title, 'История клуба');
  assert.equal(menu.items[3].kind, 'external');
});

test('повторный запуск очищает старый вывод', async () => {
  fs.writeFileSync(path.join(out, 'content/pages/stale.md'), 'x');
  await runExport({ sql: fx.sql, wpContent: fx.wpContent, siteUrl: fx.siteUrl, out, quiet: true });
  assert.ok(!exists(out, 'content/pages/stale.md'));
});

test('без wp-content всё равно работает (медиа не копируется)', async () => {
  const o = path.join(tmp(), 'o');
  const r = await runExport({ sql: fx.sql, siteUrl: fx.siteUrl, out: o, quiet: true });
  assert.equal(r.exitCode, EXIT.OK);
  assert.ok(!exists(o, 'public/uploads/2021/05/photo.jpg'));
  assert.match(read(o, 'content/posts/pervyy-turnir.md'), /\/uploads\/2021\/05\/photo-300x200\.jpg/);
});

test('ошибки запуска понятны', async () => {
  await assert.rejects(runExport({ out: tmp() }), /--sql/);
  await assert.rejects(runExport({ sql: '/nonexistent.sql', out: tmp() }), /не найден/);
});
