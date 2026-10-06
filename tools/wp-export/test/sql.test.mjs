import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readStatements, parseInsert, parseCreateTable } from '../src/sql.mjs';
import { phpUnserialize } from '../src/php.mjs';
import { tmp } from './helpers.mjs';

async function collect(file, want = () => true) {
  const out = [];
  for await (const s of readStatements(file, want)) out.push(s);
  return out;
}

test('разбор INSERT: экранирование, NULL, числа, кавычки и «;» внутри строк', () => {
  const stmt = "INSERT INTO `wp_t` VALUES (1,'it\\'s; ok','a''b',NULL,-2.5,'line\\nbreak\\\\',0x41,X'4243'),(2,'',\"dq \\\"x\\\"\",1e3,_binary 'raw',b'1');";
  const ins = parseInsert(stmt);
  assert.equal(ins.table, 'wp_t');
  const rows = [...ins.rows];
  assert.deepEqual(rows[0], [ '1', "it's; ok", "a'b", null, '-2.5', 'line\nbreak\\', 'A', 'BC' ]);
  assert.deepEqual(rows[1], ['2', '', 'dq "x"', '1e3', 'raw', '1']);
});

test('разбор INSERT с явным списком колонок', () => {
  const ins = parseInsert("INSERT INTO `wp_posts` (`ID`,`post_title`) VALUES (1,'А'),(2,'Б');");
  assert.deepEqual(ins.columns, ['ID', 'post_title']);
  assert.equal([...ins.rows].length, 2);
});

test('CREATE TABLE → колонки', () => {
  const ct = parseCreateTable("CREATE TABLE `wp_x` (\n  `a` int NOT NULL,\n  `b` varchar(10),\n  PRIMARY KEY (`a`)\n) ENGINE=InnoDB;");
  assert.deepEqual(ct, { table: 'wp_x', columns: ['a', 'b'] });
});

test('потоковый сплиттер: комментарии, «;» и кавычки в значениях, фильтр таблиц', async () => {
  const dir = tmp();
  const file = path.join(dir, 'd.sql');
  fs.writeFileSync(file, [
    '-- header; with semicolon',
    '/*!40101 SET x=1 */;',
    "INSERT INTO `wp_users` VALUES (1,'secret;value');",
    "INSERT INTO `wp_posts` VALUES (1,'a -- not comment; still string'),",
    "(2,'multi\\nline /* not comment */');",
    '# hash comment',
    "INSERT INTO `wp_posts` VALUES (3,'x');",
  ].join('\n'));
  const all = await collect(file);
  const posts = await collect(file, (t) => t === 'wp_posts');
  assert.equal(all.filter((s) => /wp_users/.test(s)).length, 1);
  assert.equal(posts.length, 2);
  assert.match(posts[0], /not comment; still string/);
  assert.equal([...parseInsert(posts[0]).rows].length, 2);
});

test('gzip-дамп читается', async () => {
  const dir = tmp();
  const file = path.join(dir, 'd.sql.gz');
  fs.writeFileSync(file, zlib.gzipSync("INSERT INTO `wp_posts` VALUES (1,'Привет');\n"));
  const s = await collect(file);
  assert.equal([...parseInsert(s[0]).rows][0][1], 'Привет');
});

test('большой дамп (~30 МБ) разбирается без раздувания памяти', async () => {
  const dir = tmp();
  const file = path.join(dir, 'big.sql');
  const fd = fs.openSync(file, 'w');
  const body = 'x'.repeat(2000).replace(/x/g, 'я');
  for (let i = 0; i < 3000; i++) {
    const rows = [];
    for (let j = 0; j < 5; j++) rows.push(`(${i * 5 + j},'${body}\\'')`);
    fs.writeSync(fd, `INSERT INTO \`wp_posts\` VALUES ${rows.join(',')};\n`);
  }
  fs.closeSync(fd);
  let n = 0;
  for await (const s of readStatements(file, () => true)) n += [...parseInsert(s).rows].length;
  assert.equal(n, 15000);
});

test('php unserialize: UTF-8 длины в байтах, вложенные массивы', () => {
  const v = phpUnserialize('a:2:{s:8:"тест";a:1:{i:0;s:3:"abc";}s:1:"n";i:5;}');
  assert.deepEqual(v, { тест: { 0: 'abc' }, n: 5 });
  assert.equal(phpUnserialize('мусор'), null);
});
