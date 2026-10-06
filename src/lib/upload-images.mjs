import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadSize } from './image-size.mjs';

/**
 * Интеграция Astro: после сборки дописывает картинкам из Markdown (<img src="/uploads/…">) размеры из файла
 * (нет сдвига вёрстки), decoding=async; первая картинка страницы — fetchpriority=high (кандидат на LCP), остальные — lazy.
 * Markdown-плагины в Astro 7 требуют отдельного пакета, поэтому правим готовый HTML.
 */
export default function uploadImages() {
  return {
    name: 'upload-images',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const root = fileURLToPath(dir);
        const files = [];
        const walk = async (d) => {
          for (const e of await readdir(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) await walk(p);
            else if (e.name.endsWith('.html')) files.push(p);
          }
        };
        await walk(root);
        for (const file of files) {
          const html = await readFile(file, 'utf8');
          let first = true;
          const out = html.replace(/<img\b[^>]*>/g, (tag) => {
            const src = /\ssrc="(\/uploads\/[^"]+)"/.exec(tag)?.[1];
            if (!src || /\swidth=/.test(tag)) return tag;
            const size = uploadSize(src);
            const extra = [];
            if (size) extra.push(`width="${size.width}"`, `height="${size.height}"`);
            if (!/\sdecoding=/.test(tag)) extra.push('decoding="async"');
            if (first) extra.push('fetchpriority="high"');
            else if (!/\sloading=/.test(tag)) extra.push('loading="lazy"');
            first = false;
            return tag.replace(/\s*\/?>$/, ` ${extra.join(' ')}>`);
          });
          if (out !== html) await writeFile(file, out);
        }
      },
    },
  };
}
