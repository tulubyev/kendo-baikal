# Кендо Байкал — сайт kendo-baikal.ru

Статический сайт на [Astro](https://astro.build) (SSG, только русский язык). Контент — Markdown в репозитории,
редактируется через git-based CMS (`/admin/`). Архитектура и контракт контента — в [`docs/PLAN.md`](docs/PLAN.md).

## Запуск

Нужен Node.js ≥ 22.12.

```bash
npm i
npm run dev        # http://localhost:4321
npm run build      # статика в dist/
npm run preview    # посмотреть собранный dist/
npm run verify     # astro check + сборка + проверка ссылок + проверка redirects.csv
```

## Структура

```
src/
  site.config.ts      название, описание, контакты, соцсети, доп. пункты меню, OG-картинка
  content.config.ts   схемы коллекций pages и posts (zod)
  content/pages/      страницы: index.md — главная, club/history.md → /club/history/
  content/posts/      новости: <slug>.md → /news/<slug>/
  layouts/            Base, Page, Post
  components/         Header, Footer, Breadcrumbs, PostCard, Pagination, SEO, Cover
  lib/                выборки контента, меню, крошки, даты по-русски
  pages/              маршруты: /, /<slug>/, /news/, /news/<slug>/, /rss.xml, /robots.txt, 404
  styles/             tokens.css (ВСЕ визуальные переменные), fonts.css, global.css
public/               fonts/ (локальные шрифты), favicon.svg, og-default.svg; uploads/ — картинки CMS
scripts/              check-links.mjs, check-redirects.mjs
```

## Как добавлять контент

**Страница** — файл `src/content/pages/<slug>.md` (вложенность через папки):

```md
---
title: О клубе            # обязательно
description: Кратко       # SEO
menu: true                # показать в главном меню
order: 10                 # порядок в меню
image: /uploads/club.jpg  # необязательно
draft: false              # true — не собирается
---
Текст в Markdown.
```

**Новость** — `src/content/posts/<slug>.md`: поля `title`, `date` (обязательны), `description`, `updated`,
`category`, `tags`, `cover`, `draft`. Попадает в ленту `/news/`, RSS и блок на главной.

Картинки кладутся в `public/uploads/` и вставляются как `/uploads/имя.jpg`.
Название клуба, контакты, соцсети и пункты меню вне страниц — в `src/site.config.ts`.

## Дизайн

Все цвета, шрифты, размеры, отступы и радиусы — CSS-переменные в `src/styles/tokens.css`; шрифты подключены
локально в `src/styles/fonts.css` (без внешних CDN). Перенос дизайна из `design-import/` — замена значений токенов
и точечная правка компонентов. Картинка Open Graph по умолчанию — SVG-заглушка; для соцсетей замените на PNG/JPG 1200×630
и поправьте `ogImage` в `site.config.ts`.

## Редиректы

Редиректы старых URL делает nginx по `redirects.csv` (см. PLAN.md), не Astro.
`npm run check:redirects` проверяет формат файла и что цели существуют в `dist/`.
