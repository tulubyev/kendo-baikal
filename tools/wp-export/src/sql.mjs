import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';

/**
 * Потоковый разбор mysqldump без MySQL.
 * Файл читается построчно (mysqldump экранирует переводы строк внутри значений),
 * автомат состояний собирает операторы, оканчивающиеся «;» вне кавычек/комментариев.
 * Операторы для таблиц, которые нам не нужны, отбрасываются сразу (память не копится).
 */

const HEAD_RE = /^\s*(INSERT\s+(?:IGNORE\s+)?INTO|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+`?([^`\s(]+)`?/i;

export function openSqlStream(file) {
  let stream = fs.createReadStream(file);
  if (/\.gz$/i.test(file)) stream = stream.pipe(zlib.createGunzip());
  return stream;
}

export async function* readStatements(file, wantTable = () => true) {
  const rl = readline.createInterface({ input: openSqlStream(file), crlfDelay: Infinity });
  let parts = [];
  let size = 0;
  let mode = 0; // 0 обычный, 1 ', 2 ", 3 `, 5 /* */
  let decided = false;
  let keep = false;
  const state = { head: null };

  const reset = () => {
    parts = [];
    size = 0;
    decided = false;
    keep = false;
    state.head = null;
  };
  const push = (text) => {
    if (!text) return;
    if (decided && !keep) return;
    parts.push(text);
    size += text.length;
    if (!decided && size >= 160) decide();
  };
  const decide = () => {
    const m = HEAD_RE.exec(parts.join(''));
    decided = true;
    keep = !!m && wantTable(m[2], /^insert/i.test(m[1]) ? 'insert' : 'create');
    if (!keep) {
      parts = [];
      size = 0;
    }
  };

  const queue = [];
  for await (const rawLine of rl) {
    const line = rawLine + '\n';
    let i = 0;
    let start = 0;
    const n = line.length;
    while (i < n) {
      if (mode === 0) {
        const c = line[i];
        if (c === ';') {
          push(line.slice(start, i));
          if (!decided) decide();
          if (keep) queue.push(parts.join(''));
          reset();
          start = ++i;
        } else if (c === "'" ) { mode = 1; i++; }
        else if (c === '"') { mode = 2; i++; }
        else if (c === '`') { mode = 3; i++; }
        else if (c === '#' || (c === '-' && line[i + 1] === '-' && /\s/.test(line[i + 2] ?? ' '))) {
          push(line.slice(start, i));
          i = n;
          start = n;
        } else if (c === '/' && line[i + 1] === '*') {
          push(line.slice(start, i));
          mode = 5;
          i += 2;
          start = i;
        } else i++;
      } else if (mode === 1) {
        // внутри '...': ищем следующий \ или '
        const re = /['\\]/g;
        re.lastIndex = i;
        const m = re.exec(line);
        if (!m) { i = n; continue; }
        if (m[0] === '\\') i = m.index + 2;
        else { i = m.index + 1; if (line[i] === "'") i++; else mode = 0; }
      } else if (mode === 2) {
        const re = /["\\]/g;
        re.lastIndex = i;
        const m = re.exec(line);
        if (!m) { i = n; continue; }
        if (m[0] === '\\') i = m.index + 2;
        else { i = m.index + 1; if (line[i] === '"') i++; else mode = 0; }
      } else if (mode === 3) {
        const e = line.indexOf('`', i);
        if (e < 0) i = n;
        else { i = e + 1; mode = 0; }
      } else if (mode === 5) {
        const e = line.indexOf('*/', i);
        if (e < 0) { i = n; start = n; }
        else { i = e + 2; start = i; mode = 0; }
      }
    }
    if (mode === 0 || mode === 1 || mode === 2 || mode === 3) push(line.slice(start));
    while (queue.length) yield queue.shift();
  }
}

/** Имена колонок из CREATE TABLE. */
export function parseCreateTable(stmt) {
  const m = HEAD_RE.exec(stmt);
  if (!m) return null;
  const cols = [];
  const body = stmt.slice(stmt.indexOf('(') + 1);
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const cm = /^`([^`]+)`\s+\S+/.exec(line);
    if (cm) cols.push(cm[1]);
    else if (/^(PRIMARY|UNIQUE|KEY|FULLTEXT|SPATIAL|CONSTRAINT|\))/i.test(line)) break;
  }
  return { table: m[2], columns: cols };
}

function unescapeSql(s) {
  if (!s.includes('\\')) return s;
  return s.replace(/\\([0nrtbZ\\'"%_])|\\(.)/gs, (_, a, b) => {
    switch (a) {
      case '0': return '\0';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'Z': return '\x1a';
      case '%': return '\\%';
      case '_': return '\\_';
      case undefined: return b;
      default: return a;
    }
  });
}

/** Разбирает INSERT → { table, columns|null, rows: Generator<Array> }. */
export function parseInsert(stmt) {
  const m = /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?([^`\s(]+)`?\s*(?:\(([^)]*)\))?\s*VALUES\s*/i.exec(stmt);
  if (!m) return null;
  const columns = m[2] ? m[2].split(',').map((c) => c.trim().replace(/^`|`$/g, '')) : null;
  const from = m[0].length;
  return { table: m[1], columns, rows: rows(stmt, from) };
}

function* rows(s, i) {
  const n = s.length;
  while (i < n) {
    while (i < n && s[i] !== '(') i++;
    if (i >= n) return;
    i++;
    const row = [];
    for (;;) {
      while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t') i++;
      const c = s[i];
      if (c === "'" || c === '"') {
        let j = i + 1;
        let hasEsc = false;
        const reQ = c === "'" ? /['\\]/g : /["\\]/g;
        for (;;) {
          reQ.lastIndex = j;
          const mm = reQ.exec(s);
          if (!mm) { j = n; break; }
          if (mm[0] === '\\' || s[mm.index + 1] === c) { hasEsc = true; j = mm.index + 2; continue; }
          j = mm.index;
          break;
        }
        let raw = s.slice(i + 1, j);
        if (hasEsc) raw = unescapeSql(raw.split(c + c).join(c));
        row.push(raw);
        i = j + 1;
      } else {
        if (/^_binary\s/i.test(s.slice(i, i + 8))) {
          i += 7;
          continue;
        }
        if ((c === 'x' || c === 'X' || c === 'b' || c === 'B') && s[i + 1] === "'") {
          const e = s.indexOf("'", i + 2);
          const lit = s.slice(i + 2, e);
          row.push(/^[xX]$/.test(c) ? Buffer.from(lit, 'hex').toString('utf8') : lit);
          i = e + 1;
        } else {
        // число, NULL, hex
        let j = i;
        while (j < n && s[j] !== ',' && s[j] !== ')') j++;
        const tok = s.slice(i, j).trim();
        if (/^NULL$/i.test(tok)) row.push(null);
        else if (/^0x[0-9a-f]+$/i.test(tok)) row.push(Buffer.from(tok.slice(2), 'hex').toString('utf8'));
        else row.push(tok);
        i = j;
        }
      }
      while (s[i] === ' ' || s[i] === '\n') i++;
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ')') { i++; break; }
      if (i >= n) break;
      i++; // защита от зацикливания на мусоре
    }
    yield row;
  }
}
