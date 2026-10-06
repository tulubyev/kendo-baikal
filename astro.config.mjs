// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import uploadImages from './src/lib/upload-images.mjs';

// Статическая сборка (SSG): на VPS раздаётся nginx, серверного рантайма нет.
export default defineConfig({
  site: 'https://kendo-baikal.ru',
  output: 'static',
  trailingSlash: 'always',
  // CSS целиком в <style>: нет блокирующего запроса, весь стиль ≈ 13 КБ (на страницу)
  build: { format: 'directory', inlineStylesheets: 'always' },
  integrations: [uploadImages(), sitemap({ filter: (page) => !page.endsWith('/search/') })],
});
