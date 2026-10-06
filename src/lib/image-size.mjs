import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Размеры JPEG/PNG/GIF/WebP по заголовку файла (без зависимостей); undefined, если не удалось. */
export function imageSize(file) {
  try {
    const b = readFileSync(file);
    if (b.toString('latin1', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b.toString('latin1', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const kind = b.toString('latin1', 12, 16);
      if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      return undefined;
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch {
    /* файла нет или он не читается — размеры не нужны */
  }
  return undefined;
}

/** Размеры файла из public/ по его URL (/uploads/...). Сборка идёт из корня проекта. */
export const uploadSize = (src) => imageSize(join(process.cwd(), 'public', decodeURI(src)));
