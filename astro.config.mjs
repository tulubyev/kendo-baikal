// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Статическая сборка (SSG): на VPS раздаётся nginx, серверного рантайма нет.
export default defineConfig({
  site: 'https://kendo-baikal.ru',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap()],
});
