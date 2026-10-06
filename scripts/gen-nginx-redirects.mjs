#!/usr/bin/env node
// Генерирует nginx-конфиг редиректов из redirects.csv (формат: from,to,status).
// Использование: node scripts/gen-nginx-redirects.mjs [redirects.csv] [out.conf]
// Нет файла → пустые map. Любая ошибка формата → код выхода 1 (сборка образа падает).
//
// Безопасность: значения попадают в конфиг nginx внутри двойных кавычек, поэтому
// допускается только строгий белый список символов (никаких " $ \ { } ; пробелов,
// управляющих символов, переводов строк). `to` — путь от корня либо https-URL.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [, , inArg = 'redirects.csv', outArg = 'redirects.map.conf'] = process.argv;

const ALLOWED_STATUS = new Set([301, 302, 307, 308]);
const PATH_RE = /^\/(?!\/)[A-Za-z0-9\-._~!*'()@:,+=&%/?]*$/; // один ведущий "/", не "//"
const URL_RE = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9\-._~!*'()@:,+=&%/?]*)?$/;
const MAX_KEY = 200; // map_hash_bucket_size в nginx.conf = 256

function fail(msg) {
  console.error(`gen-nginx-redirects: ${msg}`);
  process.exit(1);
}

// Минимальный разбор CSV с поддержкой кавычек ("a,b", "" внутри).
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (q) fail('незакрытая кавычка в CSV');
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const entries = new Map();
if (existsSync(inArg)) {
  const rows = parseCsv(readFileSync(inArg, 'utf8').replace(/^﻿/, ''));
  if (rows.length) {
    const head = rows[0].map((x) => x.trim().toLowerCase());
    if (head[0] !== 'from' || head[1] !== 'to') fail('первая строка должна быть заголовком: from,to,status');
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      if (r.length < 2 || r.length > 3) fail(`строка ${line}: ожидается 2–3 колонки`);
      const from = r[0].trim();
      const to = r[1].trim();
      const statusRaw = (r[2] ?? '').trim();
      const status = statusRaw === '' ? 301 : Number(statusRaw);
      if (!PATH_RE.test(from)) fail(`строка ${line}: недопустимый from "${from}"`);
      if (!PATH_RE.test(to) && !URL_RE.test(to)) fail(`строка ${line}: недопустимый to "${to}"`);
      if (!ALLOWED_STATUS.has(status)) fail(`строка ${line}: статус ${statusRaw} не из ${[...ALLOWED_STATUS]}`);
      if (from.length > MAX_KEY) fail(`строка ${line}: from длиннее ${MAX_KEY} символов`);
      if (from === to) fail(`строка ${line}: from равен to (петля)`);
      if (entries.has(from)) fail(`строка ${line}: дубликат from "${from}"`);
      entries.set(from, { to, status });
    });
    // Вариант без завершающего «/» (/старый-адрес → цель): иначе такой запрос не совпадёт с ключом map.
    // Явные записи из CSV имеют приоритет; `/?p=1` и подобные (с query) не трогаем.
    for (const [from, e] of [...entries]) {
      if (from.length > 1 && from.endsWith('/') && !from.includes('?')) {
        const bare = from.slice(0, -1);
        if (!entries.has(bare) && bare !== e.to) entries.set(bare, { ...e });
      }
    }
  }
}

// Защита от цепочек/циклов: to одной записи не должен быть from другой.
for (const [from, { to }] of entries) {
  if (entries.has(to)) fail(`цепочка редиректов: ${from} → ${to} → ${entries.get(to).to}`);
}

// nginx `return` принимает только литеральный код, поэтому по одному map на статус.
const q = (s) => `"${s}"`;
let out = '# АВТОГЕНЕРАЦИЯ scripts/gen-nginx-redirects.mjs — не править вручную.\n';
out += `# Записей: ${entries.size}\n`;
for (const code of ALLOWED_STATUS) {
  out += `map $request_uri $redirect_${code} {\n    default "";\n`;
  for (const [from, e] of entries) if (e.status === code) out += `    ${q(from)} ${q(e.to)};\n`;
  out += '}\n';
}

writeFileSync(outArg, out);
console.log(`gen-nginx-redirects: ${entries.size} редиректов → ${outArg}`);
