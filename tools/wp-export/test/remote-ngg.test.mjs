// Внешние картинки (--download-remote), локальные файлы вне uploads, Photon, NextGEN Gallery,
// внутренние ссылки, скрытие e-mail. Всё на синтетических данных и локальном http-сервере.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeFixture, insert, post, ser, POST_COLS, FIXTURE_SECRETS } from './make-fixture.mjs';
import { runExport, EXIT } from '../src/run.mjs';
import { RemoteImages, sniffType } from '../src/remote.mjs';
import { redactText } from '../src/redact.mjs';
import { parseFrontmatter } from '../src/validate.mjs';
import { tmp, read, exists } from './helpers.mjs';
import { walk } from '../src/util.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG2 = Buffer.concat([PNG, Buffer.from('trailing')]); // тот же формат, другое содержимое
const JPG2_MARK = 'jpg2';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);
const SITE = 'https://kendo-baikal.ru';

// ---------------------------------------------------------------- локальный сервер
const hits = new Map();
let server;
let base;
let flakyCount = 0;

async function startServer() {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.set(u.pathname, (hits.get(u.pathname) || 0) + 1);
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };
    switch (u.pathname) {
      case '/c851036/v851036484/5d41d/k4aTMkr4kEo.jpg': return send(200, 'image/jpeg', PNG); // тип врёт — расширение по сигнатуре
      case '/impg/abc.jpg': return send(200, 'image/jpeg', JPG);
      case '/same-bytes-other-url.jpg': return send(200, 'image/jpeg', PNG); // тот же контент → дедупликация по хэшу
      case '/dead.png':
      case '/gone.jpg': return send(404, 'text/plain', 'nf');
      case '/not-image.jpg': return send(200, 'text/html', '<html>captcha</html>');
      case '/fake-image.jpg': return send(200, 'image/jpeg', '<html>not really</html>');
      case '/kendo-baikal.ru/wp-content/uploads/2019/09/gone.jpg': return send(200, 'image/jpeg', Buffer.concat([JPG, Buffer.from(JPG2_MARK)]));
      case '/other.example.org/pic.png': return send(200, 'image/png', PNG2);
      case '/rules.pdf': return send(200, 'application/pdf', '%PDF-1.4 test');
      case '/flaky.jpg': return ++flakyCount < 2 ? send(503, 'text/plain', 'busy') : send(200, 'image/jpeg', JPG);
      case '/slow.jpg': return setTimeout(() => send(200, 'image/jpeg', JPG), 1500);
      case '/big.jpg': return send(200, 'image/jpeg', Buffer.concat([JPG, Buffer.alloc(5000)]));
      case '/vector.svg': return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>');
      default: return send(404, 'text/plain', 'nf');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
after(() => new Promise((r) => server.close(r)));

const HOSTS = ['pp.userapi.com', 'sun9-30.userapi.com', 'www.livejournal.ru', 'i0.wp.com', 'i1.wp.com', 'i2.wp.com', 'html.example.net', 'docs.example.net', 'flaky.example.net', 'slow.example.net', 'big.example.net', 'svg.example.net'];
const remoteOpts = () => ({ hostOverrides: Object.fromEntries(HOSTS.map((h) => [h, base])), timeoutMs: 400, backoffMs: 5, retries: 3, concurrency: 4 });

// ---------------------------------------------------------------- фикстура
const nggTables = () => [
  'CREATE TABLE `wp_ngg_gallery` (\n  `gid` bigint NOT NULL,\n  `name` varchar(255),\n  `slug` varchar(255),\n  `path` mediumtext,\n  `title` mediumtext,\n  `galdesc` mediumtext,\n  `pageid` bigint,\n  `previewpic` bigint,\n  `author` bigint\n);',
  insert('ngg_gallery', ['gid', 'name', 'slug', 'path', 'title', 'galdesc', 'pageid', 'previewpic', 'author'], [
    [1, 'turnir-2018', 'turnir-2018', 'wp-content/gallery/turnir-2018', 'Турнир 2018', '', 0, 1, 1],
    [2, 'lost', 'lost', 'wp-content/gallery/lost', 'Потерянная', '', 0, 0, 1],
    [3, 'unused', 'unused', 'wp-content/gallery/unused', 'Неиспользуемая', '', 0, 0, 1],
  ]),
  insert('ngg_pictures', ['pid', 'image_slug', 'post_id', 'galleryid', 'filename', 'description', 'alttext', 'imagedate', 'exclude', 'sortorder', 'meta_data'], [
    [1, 'a', 0, 1, 'a.jpg', 'Первое фото <b>турнира</b>', 'a', '2018-01-01 00:00:00', 0, 2, 'YTowOnt9'],
    [2, 'b', 0, 1, 'фото б.jpg', '', 'Второе', '2018-01-01 00:00:00', 0, 1, 'YTowOnt9'],
    [3, 'h', 0, 1, 'hidden.jpg', 'скрыто', 'h', '2018-01-01 00:00:00', 1, 3, 'YTowOnt9'],
    [10, 'x', 0, 2, 'x.jpg', 'нет файла', 'x', '2018-01-01 00:00:00', 0, 0, 'YTowOnt9'],
    [11, 'u', 0, 3, 'u.jpg', '', 'u', '2018-01-01 00:00:00', 0, 0, 'YTowOnt9'],
  ]),
  // без CREATE и без списка колонок — как бывает в реальных дампах
  `INSERT INTO \`wp_ngg_album\` VALUES (1,'Альбом','albom',0,'','${ser(['1', '2'])}',0);`,
].join('\n');

const img = (u, extra = '') => `<img src="${u}" alt="" ${extra}/>`;
const OUR = 'http://kendo-baikal.ru'; // как в реальной базе: http, без www

const POSTS = [
  post({ ID: 401, title: 'Галереи', name: 'galerei', date: '2022-01-01 10:00:00', content: [
    'Начало', '[nggallery id=1]', '[ngg src="galleries" ids="1"]', '[singlepic id=2 w=320]', '[slideshow id=1]', '[album id=1]', '[nggallery id=99]', '[ngg src="recent"]',
    img(`${OUR}/wp-content/gallery/turnir-2018/a.jpg`), // прямая ссылка на файл вне uploads
    `<a href="${OUR}/wp-content/ngg/note.txt">служебный</a> <a href="${OUR}/wp-content/plugins/x/readme.txt">плагин</a>`,
  ].join('\n\n') }),
  post({ ID: 402, title: 'Внешние', name: 'vneshnie', date: '2022-02-01 10:00:00', content: [
    img('https://pp.userapi.com/c851036/v851036484/5d41d/k4aTMkr4kEo.jpg'),
    img('https://pp.userapi.com/c851036/v851036484/5d41d/k4aTMkr4kEo.jpg'), // дубль URL
    `<a href="https://pp.userapi.com/c851036/v851036484/5d41d/k4aTMkr4kEo.jpg">${img('https://pp.userapi.com/c851036/v851036484/5d41d/k4aTMkr4kEo.jpg')}</a>`,
    img('https://sun9-30.userapi.com/impg/abc.jpg?size=604x453&quality=96&type=album'),
    img('https://sun9-30.userapi.com/same-bytes-other-url.jpg'),
    img('http://www.livejournal.ru/dead.png'),
    img('https://pp.userapi.com/gone.jpg'),
    img('https://html.example.net/not-image.jpg'),
    img('https://pp.userapi.com/fake-image.jpg'),
    img(`https://i1.wp.com/kendo-baikal.ru/wp-content/uploads/2021/05/photo.jpg?resize=300%2C200&ssl=1`), // наш файл есть локально
    img(`https://i2.wp.com/kendo-baikal.ru/wp-content/uploads/2019/09/gone.jpg?w=640&ssl=1`), // нашего файла нет → скачать
    img('https://i0.wp.com/other.example.org/pic.png?ssl=1'), // чужой домен через Photon
    img('https://flaky.example.net/flaky.jpg'),
    img('https://slow.example.net/slow.jpg'),
    img('https://big.example.net/big.jpg'),
    img('https://svg.example.net/vector.svg'),
    '<a href="https://docs.example.net/rules.pdf">Правила</a> и <a href="https://example.org/page.html">страница</a>',
  ].join('\n\n') }),
  post({ ID: 403, title: 'Ссылки', name: 'ssylki', date: '2022-03-01 10:00:00', content: [
    `<a href="${OUR}/2021/05/01/%D0%9F%D0%95%D0%A0%D0%92%D0%AB%D0%99-%d1%82%d1%83%d1%80%d0%bd%d0%b8%d1%80/#more-101">смешанный регистр и #more</a>`,
    `<a href="https://www.kendo-baikal.ru/2021/07/15/second-post/#comment-77">www, https, #comment</a>`,
    `<a href="${OUR}/?p=101">p-id</a> <a href="${OUR}/?page_id=4">page-id</a> <a href="${OUR}/index.php?p=102">index.php</a>`,
    `<a href="${OUR}/klub/istoriya">без слэша</a> <a href="${OUR}/%D0%9A%D0%9B%D0%A3%D0%91/istoriya/">кириллица заглавными</a>`,
    `<a href="${OUR}/%D0%BF%D0%B5%D1%80%D0%B2%D1%8B%D0%B9-%D1%82%D1%83%D1%80%D0%BD%D0%B8%D1%80/">только slug</a>`,
    `<a href="${OUR}/2018/01/19/wrong-slug/#more-102">неверный путь, верный ID</a>`,
    `<a href="${OUR}/2021/09/09/test-%D0%B4%D0%B5%D0%B6%D0%B/">обрезанный slug</a>`,
    `<a href="${OUR}/2018/01/19/no-such-post/#more-9999">нет такой записи</a>`,
    `<a href="${OUR}/2021/05/01/draft-post/">черновик</a>`,
    `<a href="/glavnaya/">относительная</a> <a href="/2021/07/15/second-post/comment-page-2/#comments">страница комментариев</a>`,
  ].join('\n\n') }),
  post({ ID: 404, title: 'Почта', name: 'pochta', date: '2022-04-01 10:00:00', content: [
    `Пишите на ${FIXTURE_SECRETS.email} или <a href="mailto:${FIXTURE_SECRETS.email}?subject=Hi">сюда</a>, а ещё <a href="mailto:Owner-Secret@Example.com">${FIXTURE_SECRETS.email}</a>.`,
    'Контакт клуба: club@kendo-baikal.ru',
  ].join('\n\n') }),
  post({ ID: 405, title: 'Обрезанный', name: 'test-%d0%b4%d0%b5%d0%b6%d0%b', date: '2021-09-09 10:00:00', content: 'Slug этой записи обрезан посреди %-последовательности.' }),
];

function makeExtraFixture({ withNgg = true } = {}) {
  const dir = tmp();
  const f = makeFixture(path.join(dir, 'fx'));
  const w = (rel, data) => { const p = path.join(f.wpContent, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
  w('gallery/turnir-2018/a.jpg', PNG);
  w('gallery/turnir-2018/фото б.jpg', PNG);
  w('gallery/turnir-2018/hidden.jpg', PNG);
  w('gallery/turnir-2018/thumbs/thumbs_a.jpg', PNG);
  w('gallery/turnir-2018/dynamic/a-100x100.jpg', PNG);
  w('gallery/unused/u.jpg', PNG);
  w('ngg/note.txt', 'служебный файл');
  w('plugins/x/readme.txt', 'плагин');
  // размещаем «http, без www» как в реальной базе
  let sql = fs.readFileSync(f.sql, 'utf8');
  sql = sql.replace(/'siteurl','https:\/\/kendo-baikal\.ru'/, "'siteurl','http://kendo-baikal.ru'").replace(/'home','https:\/\/kendo-baikal\.ru'/, "'home','http://kendo-baikal.ru'");
  const extra = [
    withNgg ? nggTables() : '',
    insert('posts', POST_COLS, POSTS, 5),
    '',
  ].join('\n');
  sql = sql.replace('/*!40101 SET CHARACTER_SET_CLIENT', extra + '\n/*!40101 SET CHARACTER_SET_CLIENT');
  fs.writeFileSync(f.sql, sql);
  return { dir, f };
}

const ALLOW = ['club@kendo-baikal.ru'];
let ctx;
let res;
let out;
before(async () => {
  await startServer(); // один хук: хуки верхнего уровня node:test стартуют параллельно
  const { dir, f } = makeExtraFixture();
  ctx = { dir, f };
  out = path.join(dir, 'out');
  res = await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: SITE, out, quiet: true, downloadRemote: true, remote: remoteOpts(), remoteMaxMb: 0.002, allowEmails: ALLOW });
});

const body = (rel) => parseFrontmatter(read(out, rel)).body;

// ---------------------------------------------------------------- внешние картинки
test('--download-remote: скачанные картинки лежат в public/uploads/remote, ссылки переписаны, расширение по сигнатуре', () => {
  const md = body('content/posts/vneshnie.md');
  const remote = walk(path.join(out, 'public/uploads/remote')).map((p) => path.basename(p));
  assert.ok(!md.includes('i2.wp.com') && /!\[\]\(\/uploads\/remote\/gone-[0-9a-f]{12}\.jpg\)/.test(md), 'Photon нашего домена переписан');
  assert.match(md, /!\[\]\(\/uploads\/remote\/k4atmkr4keo-[0-9a-f]{12}\.png\)/); // тип врёт (image/jpeg), по сигнатуре png
  assert.match(md, /!\[\]\(\/uploads\/remote\/abc-[0-9a-f]{12}\.jpg\)/);
  assert.ok(!/userapi\.com\/c851036/.test(md), 'внешняя ссылка не должна остаться, в том числе в <a> вокруг картинки');
  assert.ok(remote.some((n) => /^pic-[0-9a-f]{12}\.png$/.test(n)), 'Photon с чужого домена');
  assert.ok(remote.some((n) => /^gone-[0-9a-f]{12}\.jpg$/.test(n)), 'Photon нашего домена, файла нет локально → скачан');
  assert.ok(remote.some((n) => /^rules-[0-9a-f]{12}\.pdf$/.test(n)), 'документ PDF');
  assert.ok(!md.includes('flaky.example.net') && hits.get('/flaky.jpg') === 2, '503 → повтор → успех');
  assert.match(md, /\[Правила\]\(\/uploads\/remote\/rules-[0-9a-f]{12}\.pdf\)/);
  assert.match(md, /\[страница\]\(https:\/\/example\.org\/page\.html\)/, 'обычные внешние ссылки не скачиваются');
});

test('дедупликация: один URL качается один раз; одинаковый контент по разным URL — один файл', () => {
  assert.equal(hits.get('/c851036/v851036484/5d41d/k4aTMkr4kEo.jpg'), 1);
  const pngs = walk(path.join(out, 'public/uploads/remote')).filter((p) => p.endsWith('.png'));
  const hashes = new Set(pngs.map((p) => fs.readFileSync(p).toString('base64')));
  assert.equal(pngs.length, hashes.size, 'нет файлов-дубликатов по содержимому');
  const md = body('content/posts/vneshnie.md');
  const m = [...md.matchAll(/!\[\]\((\/uploads\/remote\/[^)]+)\)/g)].map((x) => x[1]);
  const same = m.filter((x) => /^\/uploads\/remote\/(k4atmkr4keo|same-bytes-other-url)-/.test(x));
  assert.equal(new Set(same.map((x) => x.split('-').pop())).size, 1, 'тот же хэш в имени');
});

test('недоступное остаётся как есть + TODO, причины в отчёте «Не удалось скачать»', () => {
  const md = body('content/posts/vneshnie.md');
  assert.match(md, /!\[\]\(http:\/\/www\.livejournal\.ru\/dead\.png\) <!-- TODO\(wp-export\): картинка недоступна -->/);
  assert.match(md, /!\[\]\(https:\/\/pp\.userapi\.com\/gone\.jpg\) <!-- TODO/);
  assert.match(md, /!\[\]\(https:\/\/html\.example\.net\/not-image\.jpg\) <!-- TODO/);
  assert.match(md, /!\[\]\(https:\/\/slow\.example\.net\/slow\.jpg\) <!-- TODO/);
  assert.match(md, /!\[\]\(https:\/\/big\.example\.net\/big\.jpg\) <!-- TODO/);
  assert.ok(!md.includes('wpx-remote'), 'токены не должны остаться');
  const f = Object.fromEntries(res.report.remote.failures.map((x) => [x.url, x]));
  assert.match(f['http://www.livejournal.ru/dead.png'].reason, /HTTP 404/);
  assert.match(f['https://html.example.net/not-image.jpg'].reason, /не изображение.*text\/html/);
  assert.match(f['https://pp.userapi.com/fake-image.jpg'].reason, /не похоже на изображение/);
  assert.match(f['https://slow.example.net/slow.jpg'].reason, /таймаут/);
  assert.match(f['https://big.example.net/big.jpg'].reason, /слишком большой/);
  assert.match(f['https://svg.example.net/vector.svg'].reason, /SVG/);
  assert.deepEqual(f['http://www.livejournal.ru/dead.png'].usedBy, ['post:vneshnie']);
  const md2 = read(out, 'report.md');
  assert.match(md2, /### Не удалось скачать/);
  assert.match(md2, /livejournal\.ru\/dead\.png \| HTTP 404 \| post:vneshnie/);
  assert.match(md2, /\| pp\.userapi\.com \| \d+ \| \d+ \|/); // список внешних доменов
});

test('счётчики и итоговая строка', () => {
  const r = res.report.remote;
  assert.equal(r.downloaded + r.failed, r.total);
  assert.ok(r.downloaded >= 7 && r.failed >= 7, JSON.stringify({ d: r.downloaded, f: r.failed }));
});

test('кэш: повторный запуск не качает заново, недоступное пробует снова', async () => {
  const before2 = new Map(hits);
  const o2 = out; // тот же каталог — .remote-cache сохраняется
  const r = await runExport({ sql: ctx.f.sql, wpContent: ctx.f.wpContent, siteUrl: SITE, out: o2, quiet: true, downloadRemote: true, remote: remoteOpts(), remoteMaxMb: 0.002, allowEmails: ALLOW });
  assert.equal(hits.get('/c851036/v851036484/5d41d/k4aTMkr4kEo.jpg'), before2.get('/c851036/v851036484/5d41d/k4aTMkr4kEo.jpg'));
  assert.equal(hits.get('/impg/abc.jpg'), before2.get('/impg/abc.jpg'));
  assert.ok(r.report.remote.fromCache >= 7);
  assert.equal(hits.get('/dead.png'), (before2.get('/dead.png') || 0) + 1, 'недоступное пробуется заново');
  assert.ok(exists(o2, '.remote-cache/index.json'));
  assert.ok(exists(o2, 'public/uploads/remote'));
});

test('без --download-remote внешние ссылки не трогаются и в отчёте есть подсказка', async () => {
  const o = path.join(tmp(), 'o');
  const before2 = [...hits.values()].reduce((a, b) => a + b, 0);
  const r = await runExport({ sql: ctx.f.sql, wpContent: ctx.f.wpContent, siteUrl: SITE, out: o, quiet: true, allowEmails: ALLOW });
  assert.equal([...hits.values()].reduce((a, b) => a + b, 0), before2, 'сеть не использовалась');
  assert.match(parseFrontmatter(read(o, 'content/posts/vneshnie.md')).body, /!\[\]\(https:\/\/pp\.userapi\.com\/c851036\/v851036484\/5d41d\/k4aTMkr4kEo\.jpg\)/);
  assert.equal(r.report.remote, null);
  assert.match(read(o, 'report.md'), /--download-remote/);
  assert.ok(!exists(o, '.remote-cache'));
  assert.ok(!exists(o, 'public/uploads/remote'));
});

test('юнит: RemoteImages — сигнатуры, лимит, хост-«мёртвый» пропускается после неудач', async () => {
  assert.equal(sniffType(PNG).ext, 'png');
  assert.equal(sniffType(JPG).ext, 'jpg');
  assert.equal(sniffType(Buffer.from('<html>')), null);
  const r = new RemoteImages({ cacheDir: path.join(tmp(), 'c'), backoffMs: 1, retries: 1, hostGiveUpAfter: 2, concurrency: 1, timeoutMs: 300 });
  const tokens = [1, 2, 3, 4].map((i) => r.register({ candidates: [`http://127.0.0.1:1/dead${i}.jpg`], original: `http://127.0.0.1:1/dead${i}.jpg`, source: 'x' }));
  assert.equal(tokens.length, 4);
  await r.run();
  const reasons = r.stats().failures.map((f) => f.reason);
  assert.equal(reasons.length, 4);
  assert.ok(reasons.slice(2).every((x) => /хост недоступен/.test(x)), reasons.join(' | '));
});

// ---------------------------------------------------------------- Photon и локальные файлы вне uploads
test('Photon нашего домена с локальным файлом → /uploads/…, без скачивания', () => {
  const md = body('content/posts/vneshnie.md');
  assert.match(md, /!\[\]\(\/uploads\/2021\/05\/photo\.jpg\)/);
  assert.ok(!md.includes('i1.wp.com'));
  assert.ok(!hits.has('/kendo-baikal.ru/wp-content/uploads/2021/05/photo.jpg'));
});

test('файлы из wp-content вне uploads копируются в public/uploads, служебное и код — нет', () => {
  const md = body('content/posts/galerei.md');
  assert.match(md, /!\[\]\(\/uploads\/gallery\/turnir-2018\/a\.jpg\)/);
  assert.ok(exists(out, 'public/uploads/gallery/turnir-2018/a.jpg'));
  assert.match(md, /\[служебный\]\(\/uploads\/ngg\/note\.txt\)/);
  assert.ok(exists(out, 'public/uploads/ngg/note.txt'));
  assert.ok(!exists(out, 'public/uploads/plugins'), 'plugins не копируются');
  assert.match(md, /\[плагин\]\(\/wp-content\/plugins\/x\/readme\.txt\)/);
  const csv = read(out, 'redirects.csv');
  assert.match(csv, /\/wp-content\/gallery\/turnir-2018\/a\.jpg,\/uploads\/gallery\/turnir-2018\/a\.jpg,301/);
});

// ---------------------------------------------------------------- NextGEN Gallery
test('NGG: шорткоды разворачиваются в список изображений, подписи из description/alttext', () => {
  const md = body('content/posts/galerei.md');
  // [nggallery id=1]: сначала sortorder=1 («фото б»), потом a; hidden (exclude=1) пропущен
  assert.match(md, /- !\[Второе\]\(\/uploads\/gallery\/turnir-2018\/фото%20б\.jpg\)\n- !\[a\]\(\/uploads\/gallery\/turnir-2018\/a\.jpg\) \*Первое фото турнира\*/);
  assert.ok(!md.includes('hidden.jpg'));
  assert.ok(!/\[(nggallery|ngg|singlepic|slideshow|album)/.test(md.replace(/<!--[\s\S]*?-->/g, '')), 'шорткоды не остались в тексте');
  assert.ok((md.match(/- !\[Второе\]/g) || []).length >= 4, 'nggallery, ngg, slideshow, album и singlepic дают фото');
  assert.match(md, /### Турнир 2018/, 'в альбоме у каждой галереи свой заголовок');
  // singlepic: одна картинка без списка
  assert.match(md, /\n\n!\[Второе\]\(\/uploads\/gallery\/turnir-2018\/[^)]+\)\n\n/);
});

test('NGG: миниатюры thumbs/ и dynamic/ не копируются, копируются только нужные галереи', () => {
  const files = walk(path.join(out, 'public/uploads/gallery')).map((p) => path.relative(path.join(out, 'public/uploads/gallery'), p).replace(/\\/g, '/'));
  assert.deepEqual(files.sort(), ['turnir-2018/a.jpg', 'turnir-2018/фото б.jpg']);
  assert.ok(!files.some((x) => /thumbs|dynamic|hidden|unused/.test(x)));
});

test('NGG: нет галереи / нет файлов → TODO и строка в отчёте; раздел «Галереи»', () => {
  const md = body('content/posts/galerei.md');
  assert.match(md, /<!-- TODO\(wp-export\): галерея NextGEN id=99 не найдена в базе -->/);
  assert.match(md, /<!-- TODO\(wp-export\): NextGEN \[ngg src="recent"\] не перенесён -->/);
  assert.match(md, /### Потерянная\n\n<!-- TODO\(wp-export\): галерея NextGEN «Потерянная» — файлы фотографий не найдены -->/);
  const g = res.report.galleries;
  const byId = Object.fromEntries(g.galleries.map((x) => [x.gid, x]));
  assert.equal(byId[1].title, 'Турнир 2018');
  assert.equal(byId[1].photos, 2);
  assert.equal(byId[1].copied, 2);
  assert.deepEqual(byId[1].usedBy, ['post:galerei']);
  assert.equal(byId[2].copied, 0);
  assert.deepEqual(byId[2].missingFiles, ['x.jpg']);
  assert.deepEqual(byId[3].usedBy, []);
  assert.equal(g.photosCopied, 2);
  assert.ok(g.notFound.some((n) => n.id === 99));
  const rep = read(out, 'report.md');
  assert.match(rep, /## Галереи \(NextGEN Gallery\)/);
  assert.match(rep, /\| 1 \| Турнир 2018 \| 2 \| 2 \| post:galerei \|/);
  assert.match(rep, /\| 3 \| Неиспользуемая \| 1 \| 0 \| не используется \|/);
});

test('NGG: таблиц в дампе нет — ничего не делаем, не падаем', async () => {
  const { f } = makeExtraFixture({ withNgg: false });
  const o = path.join(tmp(), 'o');
  const r = await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: SITE, out: o, quiet: true, allowEmails: ALLOW });
  assert.equal(r.exitCode, EXIT.OK);
  assert.equal(r.report.galleries, null);
  assert.deepEqual(walk(path.join(o, 'public/uploads/gallery')).map((p) => path.relative(o, p).replace(/\\/g, '/')), ['public/uploads/gallery/turnir-2018/a.jpg'], 'только прямая ссылка на файл');
  assert.ok(!read(o, 'report.md').includes('NextGEN Gallery)'));
  assert.match(parseFrontmatter(read(o, 'content/posts/galerei.md')).body, /TODO\(wp-export\): шорткод \[ngg\]/); // как раньше: неизвестный шорткод
});

// ---------------------------------------------------------------- внутренние ссылки
test('внутренние ссылки: регистр %XX, http/https/www, слэш, #more-*/#comment-*, ?p=, ?page_id=, /slug/', () => {
  const md = body('content/posts/ssylki.md');
  assert.match(md, /\[смешанный регистр и #more\]\(\/news\/pervyy-turnir\/\)/);
  assert.match(md, /\[www, https, #comment\]\(\/news\/second-post\/\)/);
  assert.match(md, /\[p-id\]\(\/news\/pervyy-turnir\/\) \[page-id\]\(\/klub\/istoriya\/\) \[index\.php\]\(\/news\/second-post\/\)/);
  assert.match(md, /\[без слэша\]\(\/klub\/istoriya\/\) \[кириллица заглавными\]\(\/klub\/istoriya\/\)/);
  assert.match(md, /\[только slug\]\(\/news\/pervyy-turnir\/\)/);
  assert.match(md, /\[обрезанный slug\]\(\/news\/test-d0-b4-d0-b5-d0-b6-d0-b\/\)/, 'slug, обрезанный посреди %XX, совпал по пути');
  assert.match(md, /\[относительная\]\(\/\) \[страница комментариев\]\(\/news\/second-post\/\)/);
  assert.ok(!/#more-|#comment-|#comments/.test(md.replace(/no-such-post\/#more-9999/, '')), 'мёртвые якоря выброшены');
});

test('внутренние ссылки: #more-ID находит запись, даже если путь не совпал (в отчёте — как нестрогое сопоставление)', () => {
  const md = body('content/posts/ssylki.md');
  assert.match(md, /\[неверный путь, верный ID\]\(\/news\/second-post\/\)/);
  const fz = res.report.links.internalFuzzy;
  assert.ok(fz.some((x) => /wrong-slug/.test(x.url) && /#more-102/.test(x.how)));
  assert.ok(fz.some((x) => /по slug/.test(x.how)));
  assert.ok(!fz.some((x) => /%D0%9F%D0%95%D0%A0/.test(x.url)), 'точное совпадение по пути не считается нестрогим');
});

test('внутренние ссылки: отсутствующие записи — абсолютный старый адрес + TODO + строка в отчёте', () => {
  const md = body('content/posts/ssylki.md');
  assert.match(md, /\[нет такой записи\]\(http:\/\/kendo-baikal\.ru\/2018\/01\/19\/no-such-post\/\) <!-- TODO\(wp-export\): ссылка на отсутствующую запись/);
  assert.match(md, /\[черновик\]\(http:\/\/kendo-baikal\.ru\/2021\/05\/01\/draft-post\/\) <!-- TODO\(wp-export\): ссылка на отсутствующую запись[^>]*не опубликована \(статус: draft\)/);
  const broken = res.report.links.internalBroken.filter((b) => b.source === 'post:ssylki');
  assert.equal(broken.length, 2);
  assert.ok(broken.some((b) => /no-such-post/.test(b.url)));
  assert.match(read(out, 'report.md'), /post:ssylki: http:\/\/kendo-baikal\.ru\/2018\/01\/19\/no-such-post\/#more-9999 — страница не найдена/);
  assert.equal(res.report.links.internalBroken.filter((b) => b.source === 'post:ssylki' && /wrong-slug|test-/.test(b.url)).length, 0);
});

test('редиректы для записи с обрезанным slug содержат «сырой» путь', () => {
  assert.match(read(out, 'redirects.csv'), /^\/2021\/09\/09\/test-%d0%b4%d0%b5%d0%b6%d0%b\/,\/news\/test-d0-b4-d0-b5-d0-b6-d0-b\/,301$/m);
});

// ---------------------------------------------------------------- e-mail
test('e-mail пользователя WP: скрыт в тексте и mailto, отчёт без адресов, код 0', () => {
  const md = read(out, 'content/posts/pochta.md');
  assert.ok(!/owner-secret|Owner-Secret/i.test(md));
  const b = parseFrontmatter(md).body;
  assert.match(b, /Пишите на \[адрес скрыт\] или \[адрес скрыт\], а ещё \[адрес скрыт\]\./);
  assert.ok(b.includes('club@kendo-baikal.ru'), 'посторонний (разрешённый) адрес не трогаем');
  assert.equal(res.exitCode, EXIT.OK);
  const d = res.report.redaction;
  assert.equal(d.mode, 'on');
  assert.ok(d.total >= 4, 'тело (3) + автоописание');
  assert.ok(d.items.every((i) => i.file.startsWith('content/') && i.line > 0 && i.masked.every((m) => /^o\*+@example\.com$/.test(m))));
  const rep = read(out, 'report.md');
  assert.match(rep, /## Скрытые e-mail/);
  assert.match(rep, /\| content\/posts\/pochta\.md \| \d+ \| \d+ \| o\*+@example\.com \|/);
  assert.ok(!/owner-secret/i.test(rep + read(out, 'report.json')));
});

test('юнит redactText: mailto, <a>, автоссылка, экранированные «_» и регистр', () => {
  const u = new Set(['a.b_c@mail.ru']);
  const r = redactText('x [a.b\\_c@mail.ru](mailto:a.b_c@mail.ru) y a.b\\_c@mail.ru z\n<a.b_c@mail.ru> [Пишите](mailto:A.B_C@mail.ru?subject=1) <a href="mailto:a.b_c@mail.ru">link</a> q@q.ru', u);
  assert.equal(r.text, 'x [адрес скрыт] y [адрес скрыт] z\n[адрес скрыт] [адрес скрыт] [адрес скрыт] q@q.ru');
  assert.deepEqual(r.hits.map((h) => h.line).sort(), [1, 1, 2, 2, 2]);
});

test('посторонний e-mail: сообщение с файлом и строкой (маска) и подсказкой --allow-email', async () => {
  const o = path.join(tmp(), 'o');
  const origErr = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  let r;
  try { r = await runExport({ sql: ctx.f.sql, wpContent: ctx.f.wpContent, siteUrl: SITE, out: o, quiet: true }); } finally { console.error = origErr; }
  assert.equal(r.exitCode, EXIT.EMAILS);
  assert.match(logged.join('\n'), /content\/posts\/pochta\.md, строка \d+: c\*+@kendo-baikal\.ru/);
  assert.match(logged.join('\n'), /--allow-email адрес/);
  assert.match(read(o, 'report.md'), /pochta\.md, строка \d+: c\*+@kendo-baikal\.ru/);
});

test('CLI: итоговые строки, флаги', async () => {
  const { spawnSync } = await import('node:child_process');
  const BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../bin/export.mjs');
  const o = path.join(tmp(), 'o');
  const run = (...a) => spawnSync(process.execPath, [BIN, '--sql', ctx.f.sql, '--wp-content', ctx.f.wpContent, '--site-url', SITE, '--out', o, '--allow-email', 'club@kendo-baikal.ru', ...a], { encoding: 'utf8' });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /внешние картинки: не скачивались .*--download-remote.*; фото из галерей скопировано: 2/);
  assert.match(ok.stdout, /e-mail пользователей скрыто: \d+/);
  const both = run('--keep-user-emails', '--redact-user-emails');
  assert.equal(both.status, 2);
  assert.match(both.stderr, /взаимоисключающие/);
  const keep = run('--keep-user-emails');
  assert.equal(keep.status, 4, 'user e-mail остался и не разрешён → код 4');
  const help = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  for (const flag of ['--download-remote', '--redact-user-emails', '--keep-user-emails']) assert.ok(help.stdout.includes(flag), flag);
});
