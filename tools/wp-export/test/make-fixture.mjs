// Синтетическая «копия WordPress»: SQL-дамп + wp-content. Реальных данных здесь нет.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_SECRETS = {
  email: 'owner-secret@example.com',
  hash: '$P$B1234567890abcdefghijklmnopqrstu',
  salt: 'put your unique phrase here',
};

export const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\0') + "'";
};
export const ser = (v) => {
  if (typeof v === 'string') return `s:${Buffer.byteLength(v)}:"${v}";`;
  if (typeof v === 'number') return `i:${v};`;
  if (Array.isArray(v)) return `a:${v.length}:{${v.map((x, i) => `i:${i};${ser(x)}`).join('')}}`;
  const e = Object.entries(v);
  return `a:${e.length}:{${e.map(([k, x]) => `${ser(isNaN(k) ? k : Number(k))}${ser(x)}`).join('')}}`;
};

const P = 'wp_';

export function insert(table, cols, rows, chunk = 3) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    out.push(`INSERT INTO \`${P}${table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ${rows.slice(i, i + chunk).map((r) => '(' + r.map(q).join(',') + ')').join(',')};`);
  }
  return out.join('\n');
}

export const POST_COLS = ['ID', 'post_author', 'post_date', 'post_date_gmt', 'post_content', 'post_title', 'post_excerpt', 'post_status', 'comment_status', 'ping_status', 'post_password', 'post_name', 'to_ping', 'pinged', 'post_modified', 'post_modified_gmt', 'post_content_filtered', 'post_parent', 'guid', 'menu_order', 'post_type', 'post_mime_type', 'comment_count'];

export function post(o) {
  const d = o.date || '2021-05-01 10:00:00';
  const row = {
    ID: o.ID, post_author: 1, post_date: d, post_date_gmt: o.gmt || d, post_content: o.content ?? '', post_title: o.title ?? '', post_excerpt: o.excerpt ?? '',
    post_status: o.status || 'publish', comment_status: 'open', ping_status: 'open', post_password: o.password || '', post_name: o.name ?? '', to_ping: '', pinged: '',
    post_modified: o.modified || d, post_modified_gmt: o.modified || d, post_content_filtered: '', post_parent: o.parent || 0, guid: o.guid || `https://kendo-baikal.ru/?p=${o.ID}`,
    menu_order: o.menu_order || 0, post_type: o.type || 'post', post_mime_type: o.mime || '', comment_count: 0,
  };
  return POST_COLS.map((c) => row[c]);
}

export const SITE = 'https://kendo-baikal.ru';
const enc = (s) => encodeURIComponent(s).toLowerCase();

export function makeFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const wp = path.join(dir, 'wp-content');
  const w = (rel, data) => {
    const f = path.join(wp, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  };

  // ---------------- uploads ----------------
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  w('uploads/2020/01/logo.png', png);
  w('uploads/2020/01/icon.png', png);
  w('uploads/2021/05/photo.jpg', Buffer.concat([png, Buffer.alloc(2000, 1)]));
  w('uploads/2021/05/photo-300x200.jpg', png); // миниатюра — не должна копироваться, если не используется
  w('uploads/2021/05/photo-150x150.jpg', png);
  w('uploads/2021/05/heavy.jpg', Buffer.alloc(1_300_000, 7));
  w('uploads/2021/05/фото кендо.jpg', png);
  w('uploads/2021/06/gallery1.jpg', png);
  w('uploads/2021/06/gallery2.jpg', png);
  w('uploads/docs/rules.pdf', Buffer.from('%PDF-1.4 fake'));
  w('uploads/unused.jpg', png);
  w('uploads/unused-150x150.jpg', png);

  // ---------------- темы ----------------
  w('themes/kendo-parent/style.css', `/*
Theme Name: Kendo Parent
Version: 1.2
Author: Someone
*/
:root { --brand: #b3202a; --ink: #222222; }
body { background: #fafafa; color: var(--ink); font-family: "PT Sans", Arial, sans-serif; font-size: 17px; line-height: 1.6; }
a { color: var(--brand); }
a:hover { color: #7a1119; }
h1, h2, h3 { font-family: "Oswald", sans-serif; color: #111; }
h1 { font-size: 2.6rem; } h2 { font-size: 2rem; } h3 { font-size: 1.5rem; }
.container { max-width: 1140px; margin: 0 auto; }
.btn, .wp-block-button__link { background-color: var(--brand); border-radius: 6px; color: #fff; }
.card { border-radius: 8px; background: #fff; }
.site-header { background: #1b1b1b; }
.site-footer { background: #111111; }
@media (max-width: 600px) { .container { max-width: 100%; } }
@font-face { font-family: "Oswald"; src: url("fonts/oswald.woff2") format("woff2"); font-weight: 700; }
.hero { background-image: url(images/hero.jpg); }
`);
  w('themes/kendo-parent/fonts/oswald.woff2', Buffer.from('wOF2fake'));
  w('themes/kendo-parent/images/hero.jpg', png);
  w('themes/kendo-parent/images/logo-light.png', png);
  w('themes/kendo-parent/theme.json', JSON.stringify({ version: 2, settings: { color: { palette: [{ slug: 'primary', name: 'Primary', color: '#b3202a' }] }, layout: { contentSize: '760px', wideSize: '1140px' } } }));
  w('themes/kendo-parent/header.php', `<!DOCTYPE html><html <?php language_attributes(); ?>><head><?php wp_head(); ?></head><body>
<header class="site-header" id="masthead"><div class="container"><?php the_custom_logo(); ?>
<nav class="main-nav"><?php wp_nav_menu(array('theme_location' => 'primary')); ?></nav></div></header>`);
  w('themes/kendo-parent/footer.php', `<footer class="site-footer"><div class="container"><?php dynamic_sidebar('footer-1'); ?><p>&copy; <?php bloginfo('name'); ?></p></div></footer><?php wp_footer(); ?></body></html>`);
  w('themes/kendo-parent/front-page.php', `<?php get_header(); ?><main id="main"><section class="hero"><h1><?php the_title(); ?></h1></section><section class="news"><?php while (have_posts()) : the_post(); get_template_part('template-parts/card', 'news'); endwhile; ?></section></main><?php get_footer(); ?>`);
  w('themes/kendo-parent/single.php', `<?php get_header(); ?><main><article><h1><?php the_title(); ?></h1><?php the_post_thumbnail(); ?><div class="entry-content"><?php the_content(); ?></div></article><?php get_sidebar(); ?></main><?php get_footer(); ?>`);
  w('themes/kendo-parent/functions.php', `<?php define('DB_PASSWORD', 'must-never-be-copied'); ?>`);
  w('themes/kendo-child/style.css', `/*
Theme Name: Kendo Child
Template: kendo-parent
*/
.btn { border-radius: 10px; }
`);
  w('themes/other-theme/style.css', '/* Theme Name: Unused */ body{color:red}');

  // ---------------- SQL ----------------
  const tpl = '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;';
  const sql = [];
  sql.push('-- MySQL dump 10.13  Distrib 8.0.0', '-- Host: localhost    Database: wp; secret; thing', '--', tpl, '/*!40101 SET NAMES utf8mb4 */;', '');

  // options
  sql.push(`DROP TABLE IF EXISTS \`${P}options\`;`, `CREATE TABLE \`${P}options\` (\n  \`option_id\` bigint unsigned NOT NULL AUTO_INCREMENT,\n  \`option_name\` varchar(191) NOT NULL DEFAULT '',\n  \`option_value\` longtext NOT NULL,\n  \`autoload\` varchar(20) NOT NULL DEFAULT 'yes',\n  PRIMARY KEY (\`option_id\`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  sql.push(`LOCK TABLES \`${P}options\` WRITE;`);
  const opts = [
    ['siteurl', SITE], ['home', SITE], ['blogname', 'Кендо Байкал'], ['blogdescription', 'Федерация кендо'],
    ['active_plugins', ser(['contact-form-7/wp-contact-form-7.php', 'wordpress-seo/wp-seo.php', 'revslider/revslider.php', 'strange-plugin/strange.php', 'akismet/akismet.php'])],
    ['stylesheet', 'kendo-child'], ['template', 'kendo-parent'], ['permalink_structure', '/%year%/%monthnum%/%day%/%postname%/'],
    ['show_on_front', 'page'], ['page_on_front', '2'], ['page_for_posts', '5'], ['site_icon', '41'],
    ['theme_mods_kendo-child', ser({ custom_logo: 40, nav_menu_locations: { primary: 20 } })],
    ['auth_key_secret', FIXTURE_SECRETS.salt], // не из белого списка — читаться не должно
    ['transient_big', 'x'.repeat(5000)],
  ].map(([n, v], i) => [i + 1, n, v, 'yes']);
  sql.push(insert('options', ['option_id', 'option_name', 'option_value', 'autoload'], opts, 20), 'UNLOCK TABLES;', '');

  // users (чувствительное!)
  sql.push(`CREATE TABLE \`${P}users\` (\n  \`ID\` bigint unsigned NOT NULL,\n  \`user_login\` varchar(60),\n  \`user_pass\` varchar(255),\n  \`user_nicename\` varchar(50),\n  \`user_email\` varchar(100),\n  \`user_url\` varchar(100),\n  \`user_registered\` datetime,\n  \`user_activation_key\` varchar(255),\n  \`user_status\` int,\n  \`display_name\` varchar(250)\n);`);
  sql.push(insert('users', ['ID', 'user_login', 'user_pass', 'user_nicename', 'user_email', 'user_url', 'user_registered', 'user_activation_key', 'user_status', 'display_name'], [[1, 'admin', FIXTURE_SECRETS.hash, 'admin', FIXTURE_SECRETS.email, '', '2020-01-01 00:00:00', '', 0, 'Admin']]), '');
  sql.push(insert('comments', ['comment_ID', 'comment_author_email', 'comment_content'], [[1, 'commenter@example.org', 'Привет; как дела?']]), '');

  // terms
  sql.push(insert('terms', ['term_id', 'name', 'slug', 'term_group'], [
    [10, 'Турниры', enc('турниры'), 0], [11, 'Без рубрики', 'uncategorized', 0], [12, 'кендо', enc('кендо'), 0], [13, 'соревнования', 'sorevnovaniya', 0], [20, 'Главное меню', 'main-menu', 0],
  ]));
  sql.push(insert('term_taxonomy', ['term_taxonomy_id', 'term_id', 'taxonomy', 'description', 'parent', 'count'], [
    [10, 10, 'category', '', 0, 1], [11, 11, 'category', '', 0, 0], [12, 12, 'post_tag', '', 0, 1], [13, 13, 'post_tag', '', 0, 1], [20, 20, 'nav_menu', '', 0, 5],
  ]));
  sql.push(insert('term_relationships', ['object_id', 'term_taxonomy_id', 'term_order'], [
    [101, 10, 0], [101, 12, 0], [101, 13, 0], [102, 11, 0], [31, 20, 0], [32, 20, 0], [33, 20, 0], [34, 20, 0], [35, 20, 0],
  ]));

  // postmeta (до posts, как в настоящем дампе)
  const meta = [
    [40, '_wp_attached_file', '2020/01/logo.png'], [41, '_wp_attached_file', '2020/01/icon.png'], [42, '_wp_attached_file', '2021/05/photo.jpg'],
    [42, '_wp_attachment_image_alt', 'Фото с турнира'], [43, '_wp_attached_file', '2021/05/heavy.jpg'], [44, '_wp_attached_file', 'docs/rules.pdf'],
    [45, '_wp_attached_file', '2021/06/gallery1.jpg'], [46, '_wp_attached_file', '2021/06/gallery2.jpg'],
    [101, '_thumbnail_id', '42'], [3, '_thumbnail_id', '45'], [101, '_edit_lock', 'не нужно'], [101, '_yoast_wpseo_metadesc', 'Описание из Yoast про первый турнир'],
    [31, '_menu_item_type', 'post_type'], [31, '_menu_item_object', 'page'], [31, '_menu_item_object_id', '2'], [31, '_menu_item_menu_item_parent', '0'],
    [32, '_menu_item_type', 'post_type'], [32, '_menu_item_object', 'page'], [32, '_menu_item_object_id', '3'], [32, '_menu_item_menu_item_parent', '0'],
    [33, '_menu_item_type', 'post_type'], [33, '_menu_item_object', 'page'], [33, '_menu_item_object_id', '4'], [33, '_menu_item_menu_item_parent', '32'],
    [34, '_menu_item_type', 'post_type'], [34, '_menu_item_object', 'page'], [34, '_menu_item_object_id', '5'], [34, '_menu_item_menu_item_parent', '0'],
    [35, '_menu_item_type', 'custom'], [35, '_menu_item_object', 'custom'], [35, '_menu_item_object_id', '35'], [35, '_menu_item_menu_item_parent', '0'], [35, '_menu_item_url', 'https://example.org/partner'],
  ].map(([pid, k, v], i) => [i + 1, pid, k, v]);
  sql.push(insert('postmeta', ['meta_id', 'post_id', 'meta_key', 'meta_value'], meta, 10), '');

  // posts
  const g = (c) => c;
  const posts = [
    post({ ID: 2, type: 'page', title: 'Главная', name: 'glavnaya', menu_order: 1, content: g(`<!-- wp:heading {"level":1} -->\n<h1>Кендо на Байкале</h1>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>Добро пожаловать! Читайте <a href="${SITE}/клуб/istoriya/">историю клуба</a> и <a href="${SITE}/?p=101">первый турнир</a>. Это ''двойные'' кавычки; и точка с запятой.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:image {"id":42} -->\n<figure class="wp-block-image"><img src="${SITE}/wp-content/uploads/2021/05/photo-300x200.jpg" alt="Фото" class="wp-image-42"/><figcaption>Подпись к фото</figcaption></figure>\n<!-- /wp:image -->\n\n<!-- wp:more -->\n<!--more-->\n<!-- /wp:more -->\n\n<!-- wp:file -->\n<div class="wp-block-file"><a href="${SITE}/wp-content/uploads/docs/rules.pdf">Правила</a><a href="${SITE}/wp-content/uploads/docs/rules.pdf" class="wp-block-file__button" download>Скачать</a></div>\n<!-- /wp:file -->`) }),
    post({ ID: 3, type: 'page', title: 'Клуб', name: enc('клуб'), menu_order: 2, content: `Клуб основан давно.\n\n[caption id="attachment_42" align="aligncenter" width="300"]<img src="/wp-content/uploads/2021/05/%D1%84%D0%BE%D1%82%D0%BE%20%D0%BA%D0%B5%D0%BD%D0%B4%D0%BE.jpg" alt="Кендо" /> Тренировка[/caption]\n\nГалерея:\n\n[gallery ids="45,46"]\n\n[[escaped]] и [Фото] остаются.\n\n[video src="https://example.org/clip.mp4"]` }),
    post({ ID: 4, type: 'page', title: 'История клуба', name: 'istoriya', parent: 3, menu_order: 1, content: `<h2>Давно</h2>\n<ul><li>Пункт <strong>один</strong></li><li>Пункт два<ul><li>вложенный</li></ul></li></ul>\n<table><thead><tr><th>Год</th><th>Событие</th></tr></thead><tbody><tr><td>2001</td><td>Основание</td></tr></tbody></table>\n\n[contact-form-7 id="1" title="Контакты"]\n\n[fancy_thing a="1"]внутри[/fancy_thing]\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nСсылка на [рубрику](${SITE}/category/${enc('турниры')}/) тут HTML: <a href="${SITE}/category/${enc('турниры')}/">рубрика</a> и <a href="${SITE}/nonexistent-page/">битая</a>, <a href="https://external.example.net/x?a=(1)">внешняя</a>.` }),
    post({ ID: 5, type: 'page', title: 'Новости', name: 'novosti', content: '' }),
    post({ ID: 6, type: 'page', title: 'Секретный черновик', name: 'secret-draft', status: 'draft', content: 'ЧЕРНОВИК-СОДЕРЖИМОЕ-НЕ-ДОЛЖНО-ПОПАСТЬ' }),
    post({ ID: 7, type: 'page', title: 'Приватная', name: 'private-page', status: 'private', content: 'ПРИВАТНОЕ-СОДЕРЖИМОЕ' }),
    post({ ID: 8, type: 'page', title: 'Под паролем', name: 'protected-page', password: 'pw', content: 'ПАРОЛЬ-СОДЕРЖИМОЕ' }),
    post({ ID: 9, type: 'page', title: 'Контакты', name: 'contacts', content: `<p>Приезжайте!</p>\n<form action="/send" method="post"><input name="a"><button>Отправить</button></form>\n<iframe src="https://yandex.ru/map-widget/v1/?um=constructor%3Aabc" width="600" height="400"></iframe>\n<script>alert('x')</script>` }),
    post({ ID: 101, title: 'Первый турнир', name: enc('первый-турнир'), date: '2021-05-01 12:30:00', modified: '2021-06-10 09:00:00', content: `Турнир прошёл отлично.\nВторая строка.\n\n<img src="${SITE}/wp-content/uploads/2021/05/photo-300x200.jpg" alt="Фото" />\n\n<a href="${SITE}/wp-content/uploads/2021/05/heavy.jpg"><img src="${SITE}/wp-content/uploads/2021/05/heavy.jpg" /></a>\n\n<a href="/wp-content/uploads/docs/rules.pdf">Правила (PDF)</a> <img src="/wp-content/uploads/missing/nope.jpg" />` }),
    post({ ID: 102, title: 'Second post', name: 'second-post', date: '2021-07-15 08:00:00', content: `<!-- wp:paragraph -->\n<p>Привет, мир!</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:embed {"url":"https://youtu.be/dQw4w9WgXcQ","type":"video","providerNameSlug":"youtube"} -->\n<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">\nhttps://youtu.be/dQw4w9WgXcQ\n</div></figure>\n<!-- /wp:embed -->\n\n<!-- wp:block {"ref":60} /-->` }),
    post({ ID: 103, title: 'Draft post', name: 'draft-post', status: 'draft', content: 'ЧЕРНОВИК-ПОСТА' }),
    post({ ID: 104, title: 'Second post', name: 'second-post', date: '2021-08-01 08:00:00', content: '<p>Дубликат slug.</p>' }),
    post({ ID: 60, type: 'wp_block', title: 'Подвал блока', name: 'reusable', content: '<!-- wp:paragraph -->\n<p>Повторно используемый блок.</p>\n<!-- /wp:paragraph -->' }),
    post({ ID: 40, type: 'attachment', status: 'inherit', title: 'logo', name: 'logo', mime: 'image/png', guid: `${SITE}/wp-content/uploads/2020/01/logo.png` }),
    post({ ID: 41, type: 'attachment', status: 'inherit', title: 'icon', name: 'icon', mime: 'image/png', guid: `${SITE}/wp-content/uploads/2020/01/icon.png` }),
    post({ ID: 42, type: 'attachment', status: 'inherit', title: 'photo', name: 'photo', mime: 'image/jpeg', parent: 101, guid: `${SITE}/wp-content/uploads/2021/05/photo.jpg` }),
    post({ ID: 43, type: 'attachment', status: 'inherit', title: 'heavy', name: 'heavy', mime: 'image/jpeg', guid: `${SITE}/wp-content/uploads/2021/05/heavy.jpg` }),
    post({ ID: 44, type: 'attachment', status: 'inherit', title: 'rules', name: 'rules', mime: 'application/pdf', guid: `${SITE}/wp-content/uploads/docs/rules.pdf` }),
    post({ ID: 45, type: 'attachment', status: 'inherit', title: 'g1', name: 'g1', mime: 'image/jpeg', guid: `${SITE}/wp-content/uploads/2021/06/gallery1.jpg` }),
    post({ ID: 46, type: 'attachment', status: 'inherit', title: 'g2', name: 'g2', mime: 'image/jpeg', guid: `${SITE}/wp-content/uploads/2021/06/gallery2.jpg` }),
    post({ ID: 200, type: 'revision', status: 'inherit', title: 'Rev', name: '101-revision-v1', parent: 101, content: 'РЕВИЗИЯ-НЕ-ДОЛЖНА-ПОПАСТЬ' }),
    post({ ID: 201, type: 'post', status: 'auto-draft', title: 'Auto Draft', name: '' }),
    post({ ID: 202, type: 'shop_order', status: 'wc-completed', title: 'Order – customer@example.org', name: 'order-1', content: 'ЗАКАЗ' }),
    post({ ID: 300, type: 'tribe_events', title: 'Турнир по кендо 2022', name: 'tournament-2022', content: 'Событие' }),
    post({ ID: 31, type: 'nav_menu_item', title: '', name: '31', menu_order: 1 }),
    post({ ID: 32, type: 'nav_menu_item', title: 'О клубе', name: '32', menu_order: 2 }),
    post({ ID: 33, type: 'nav_menu_item', title: '', name: '33', menu_order: 3 }),
    post({ ID: 34, type: 'nav_menu_item', title: 'Новости', name: '34', menu_order: 4 }),
    post({ ID: 35, type: 'nav_menu_item', title: 'Партнёр', name: '35', menu_order: 5 }),
  ];
  sql.push(`CREATE TABLE \`${P}posts\` (\n${POST_COLS.map((c) => `  \`${c}\` longtext`).join(',\n')},\n  PRIMARY KEY (\`ID\`),\n  KEY \`post_name\` (\`post_name\`(191))\n) ENGINE=InnoDB;`);
  sql.push(`LOCK TABLES \`${P}posts\` WRITE;`, insert('posts', POST_COLS, posts, 7), 'UNLOCK TABLES;', '');
  sql.push('/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;', '-- Dump completed');

  fs.writeFileSync(path.join(dir, 'dump.sql'), sql.join('\n') + '\n');

  // ---------------- WXR (запасной вход) ----------------
  const wxr = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
<title>Кендо Байкал</title>
<link>${SITE}</link>
<description>Федерация</description>
<wp:base_site_url>${SITE}</wp:base_site_url>
<wp:base_blog_url>${SITE}</wp:base_blog_url>
<wp:author><wp:author_id>1</wp:author_id><wp:author_login><![CDATA[admin]]></wp:author_login><wp:author_email><![CDATA[${FIXTURE_SECRETS.email}]]></wp:author_email></wp:author>
<wp:category><wp:term_id>10</wp:term_id><wp:category_nicename><![CDATA[turniry]]></wp:category_nicename><wp:cat_name><![CDATA[Турниры]]></wp:cat_name></wp:category>
<item><title>Страница WXR</title><link>${SITE}/wxr-page/</link><content:encoded><![CDATA[<p>Текст со <a href="${SITE}/wxr-post/">ссылкой</a></p>]]></content:encoded><excerpt:encoded><![CDATA[]]></excerpt:encoded><wp:post_id>11</wp:post_id><wp:post_date><![CDATA[2022-01-01 10:00:00]]></wp:post_date><wp:post_date_gmt><![CDATA[2022-01-01 07:00:00]]></wp:post_date_gmt><wp:post_modified><![CDATA[2022-01-01 10:00:00]]></wp:post_modified><wp:post_modified_gmt><![CDATA[2022-01-01 07:00:00]]></wp:post_modified_gmt><wp:post_name><![CDATA[wxr-page]]></wp:post_name><wp:status><![CDATA[publish]]></wp:status><wp:post_parent>0</wp:post_parent><wp:menu_order>0</wp:menu_order><wp:post_type><![CDATA[page]]></wp:post_type><wp:post_password><![CDATA[]]></wp:post_password></item>
<item><title>Пост WXR</title><link>${SITE}/wxr-post/</link><content:encoded><![CDATA[Просто текст]]></content:encoded><excerpt:encoded><![CDATA[Краткое]]></excerpt:encoded><wp:post_id>12</wp:post_id><wp:post_date><![CDATA[2022-02-01 10:00:00]]></wp:post_date><wp:post_date_gmt><![CDATA[2022-02-01 07:00:00]]></wp:post_date_gmt><wp:post_modified><![CDATA[2022-02-01 10:00:00]]></wp:post_modified><wp:post_modified_gmt><![CDATA[2022-02-01 07:00:00]]></wp:post_modified_gmt><wp:post_name><![CDATA[wxr-post]]></wp:post_name><wp:status><![CDATA[publish]]></wp:status><wp:post_parent>0</wp:post_parent><wp:menu_order>0</wp:menu_order><wp:post_type><![CDATA[post]]></wp:post_type><wp:post_password><![CDATA[]]></wp:post_password><category domain="category" nicename="turniry"><![CDATA[Турниры]]></category><category domain="post_tag" nicename="kendo"><![CDATA[кендо]]></category></item>
<item><title>Черновик WXR</title><wp:post_id>13</wp:post_id><wp:post_name><![CDATA[d]]></wp:post_name><wp:status><![CDATA[draft]]></wp:status><wp:post_type><![CDATA[post]]></wp:post_type><content:encoded><![CDATA[СЕКРЕТ-WXR]]></content:encoded></item>
</channel>
</rss>
`;
  fs.writeFileSync(path.join(dir, 'export.xml'), wxr);

  return { dir, sql: path.join(dir, 'dump.sql'), wxr: path.join(dir, 'export.xml'), wpContent: wp, siteUrl: SITE };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = path.resolve(process.argv[2] || '.fixture');
  const f = makeFixture(target);
  console.log(`Фикстура создана: ${f.dir}\nПопробуйте: node bin/export.mjs --sql ${f.sql} --wp-content ${f.wpContent} --site-url ${f.siteUrl} --out .fixture/out`);
}
