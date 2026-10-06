import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Контракт полей описан в docs/PLAN.md. Конфиг админки (public/admin) обязан ему соответствовать.

const upload = z.string().startsWith('/uploads/');

const pages = defineCollection({
  // index.md → id "index" (главная); club/history.md → id "club/history"
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    menu: z.boolean().default(false),
    order: z.number().optional(),
    image: upload.optional(),
    draft: z.boolean().default(false),
  }),
});

const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).default([]),
    cover: upload.optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { pages, posts };
