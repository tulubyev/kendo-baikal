/** Минимальный unserialize() для значений опций WordPress (строки считаются по байтам UTF-8). */
export function phpUnserialize(input) {
  if (typeof input !== 'string' || input.length < 2) return null;
  const buf = Buffer.from(input, 'utf8');
  let pos = 0;

  const readUntil = (ch) => {
    const end = buf.indexOf(ch, pos);
    if (end < 0) throw new Error('bad serialize');
    const s = buf.toString('utf8', pos, end);
    pos = end + 1;
    return s;
  };

  const parse = () => {
    const t = String.fromCharCode(buf[pos]);
    pos += 2; // "t:" или "N;"
    switch (t) {
      case 'N':
        return null;
      case 'b':
        return readUntil(';') === '1';
      case 'i':
        return parseInt(readUntil(';'), 10);
      case 'd':
        return parseFloat(readUntil(';'));
      case 's': {
        const len = parseInt(readUntil(':'), 10);
        pos += 1; // "
        const s = buf.toString('utf8', pos, pos + len);
        pos += len + 2; // ";
        return s;
      }
      case 'a': {
        const n = parseInt(readUntil(':'), 10);
        pos += 1; // {
        const obj = {};
        for (let i = 0; i < n; i++) {
          const k = parse();
          obj[k] = parse();
        }
        pos += 1; // }
        return obj;
      }
      case 'O': {
        readUntil(':'); // длина имени класса
        readUntil(':'); // "Class"
        const n = parseInt(readUntil(':'), 10);
        pos += 1;
        const obj = {};
        for (let i = 0; i < n; i++) {
          const k = parse();
          obj[k] = parse();
        }
        pos += 1;
        return obj;
      }
      default:
        throw new Error('unsupported serialize type ' + t);
    }
  };

  try {
    return parse();
  } catch {
    return null;
  }
}

/** Значения PHP-массива → JS-массив (для active_plugins). */
export function phpList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}
