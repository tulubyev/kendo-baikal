import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeFixture, FIXTURE_SECRETS } from './make-fixture.mjs';
import { runExport, EXIT } from '../src/run.mjs';
import { loadWxr } from '../src/wxr.mjs';
import { scanOutput } from '../src/secrets.mjs';
import { tmp, read, exists } from './helpers.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/export.mjs');

function withDump(mutate) {
  const dir = tmp();
  const f = makeFixture(path.join(dir, 'fx'));
  fs.writeFileSync(f.sql, mutate(fs.readFileSync(f.sql, 'utf8')));
  return { f, out: path.join(dir, 'out') };
}

test('e-mail в тексте страницы → громкое предупреждение и код 4; --allow-email снимает', async () => {
  const { f, out } = withDump((s) => s.replace('Приезжайте!', 'Пишите: club@kendo-baikal.ru'));
  const origErr = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  let r;
  try { r = await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: f.siteUrl, out, quiet: true }); } finally { console.error = origErr; }
  assert.equal(r.exitCode, EXIT.EMAILS);
  assert.ok(logged.join('\n').includes('E-MAIL'));
  assert.ok(r.report.secretsScan.emails.some((e) => e.file.endsWith('contacts.md') && e.email.startsWith('c')));
  assert.ok(!read(out, 'report.md').includes('club@kendo-baikal.ru'), 'в отчёте адрес должен быть замаскирован');
  const r2 = await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: f.siteUrl, out, quiet: true, allowEmails: ['club@kendo-baikal.ru'] });
  assert.equal(r2.exitCode, EXIT.OK);
  const r3 = await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: f.siteUrl, out, quiet: true, allowEmails: ['@kendo-baikal.ru'] });
  assert.equal(r3.exitCode, EXIT.OK);
});

test('e-mail пользователя WordPress в тексте → аварийный код 3', async () => {
  const { f, out } = withDump((s) => s.replace('Приезжайте!', `Админ: ${FIXTURE_SECRETS.email}`));
  const origErr = console.error;
  console.error = () => {};
  let r;
  try { r = await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: f.siteUrl, out, quiet: true, allowEmails: [FIXTURE_SECRETS.email] }); } finally { console.error = origErr; }
  assert.equal(r.exitCode, EXIT.SECRETS, 'даже --allow-email не отключает проверку e-mail пользователей');
  assert.ok(r.report.secretsScan.hard.length >= 1);
});

test('хэш пароля, попавший в контент → код 3', async () => {
  const { f, out } = withDump((s) => s.replace('Приезжайте!', `Хэш ${FIXTURE_SECRETS.hash}`));
  const origErr = console.error;
  console.error = () => {};
  let r;
  try { r = await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: f.siteUrl, out, quiet: true }); } finally { console.error = origErr; }
  assert.equal(r.exitCode, EXIT.SECRETS);
  assert.ok(r.report.secretsScan.hard.some((h) => /хэш/i.test(h.kind)));
});

test('сканер секретов находит $P$, $wp$, bcrypt, константы wp-config', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.md'), 'x $P$B1234567890abcdefghijklmnopqrstu y');
  fs.writeFileSync(path.join(dir, 'b.json'), '{"h":"$wp$2y$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012"}');
  fs.writeFileSync(path.join(dir, 'c.css'), "define('AUTH_KEY', 'abc');");
  fs.writeFileSync(path.join(dir, 'd.md'), 'логотип logo@2x.png не e-mail; а вот me@example.com — да');
  const r = scanOutput(dir, {});
  assert.deepEqual([...new Set(r.hard.map((h) => h.file))].sort(), ['a.md', 'b.json', 'c.css']);
  assert.deepEqual(r.emails.map((e) => e.raw), ['me@example.com']);
});

test('копия дизайна не содержит PHP, а дамп-секреты из functions.php не копируются', async () => {
  const dir = tmp();
  const f = makeFixture(path.join(dir, 'fx'));
  const out = path.join(dir, 'out');
  await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: f.siteUrl, out, quiet: true });
  const all = [];
  (function rec(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? rec(p) : all.push(p); } })(out);
  assert.ok(all.every((p) => !p.endsWith('.php') && !p.endsWith('.sql')));
  for (const p of all.filter((x) => /\.(md|json|csv|css)$/.test(x))) assert.ok(!fs.readFileSync(p, 'utf8').includes('must-never-be-copied'));
});

test('WXR-режим: страницы, посты, термины; авторы и черновики не попадают в вывод', async () => {
  const dir = tmp();
  const f = makeFixture(path.join(dir, 'fx'));
  const model = loadWxr(f.wxr);
  assert.equal(model.posts.size, 3);
  const out = path.join(dir, 'out');
  const origErr = console.error;
  console.error = () => {};
  let r;
  try { r = await runExport({ wxr: f.wxr, siteUrl: f.siteUrl, out, quiet: true }); } finally { console.error = origErr; }
  assert.equal(r.exitCode, EXIT.OK);
  assert.ok(exists(out, 'content/pages/wxr-page.md'));
  const post = read(out, 'content/posts/wxr-post.md');
  assert.match(post, /category: "Турниры"/);
  assert.match(post, /tags: \["кендо"\]/);
  assert.match(post, /description: "Краткое"/);
  assert.match(read(out, 'content/pages/wxr-page.md'), /\[ссылкой\]\(\/news\/wxr-post\/\)/);
  const all = fs.readdirSync(out, { recursive: true }).filter((x) => /\.(md|json|csv)$/.test(x)).map((x) => read(out, x)).join('\n');
  assert.ok(!all.includes('СЕКРЕТ-WXR') && !all.includes(FIXTURE_SECRETS.email));
});

test('CLI: справка, ошибка без аргументов, успешный запуск', () => {
  const help = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--sql/);
  const bad = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--sql/);
  const dir = tmp();
  const f = makeFixture(path.join(dir, 'fx'));
  const ok = spawnSync(process.execPath, [BIN, '--sql', f.sql, '--wp-content', f.wpContent, '--site-url', f.siteUrl, '--out', path.join(dir, 'o')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /проверка на секреты и e-mail пройдена/);
});

test('скриншоты: отсутствие Playwright не ломает экспорт', async () => {
  const dir = tmp();
  const f = makeFixture(path.join(dir, 'fx'));
  const r = await runExport({ sql: f.sql, wpContent: f.wpContent, siteUrl: f.siteUrl, out: path.join(dir, 'o'), quiet: true, screenshotsFrom: 'http://127.0.0.1:9' });
  assert.equal(r.exitCode, EXIT.OK);
  assert.equal(r.report.screenshots.ok, false);
});
