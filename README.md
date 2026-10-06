# Кендо Байкал — сайт kendo-baikal.ru

Статический сайт на [Astro](https://astro.build) (SSG, только русский язык). Контент — Markdown в репозитории,
редактируется через git-based CMS (`/admin/`). Архитектура и контракт контента — в [`docs/PLAN.md`](docs/PLAN.md).

## Запуск

Нужен Node.js ≥ 22.12.

```bash
npm ci            # или npm i
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
  content/pages/      страницы: index.md — главная, poleznye-materialy/kalendar.md → /poleznye-materialy/kalendar/
  content/posts/      новости: <slug>.md → /news/<slug>/
  layouts/            Base, Page, Post
  components/         Header (меню с подменю), Sidebar, Footer, Breadcrumbs, PostCard, Pagination, SEO, Cover
  lib/                выборки контента, меню, крошки, даты по-русски
  pages/              маршруты: /, /<slug>/, /news/, /news/<slug>/, /rss.xml, /robots.txt, 404
  styles/             tokens.css (ВСЕ визуальные переменные), fonts.css, global.css
public/               fonts/ (локальные шрифты), favicon.svg, og-default.svg; uploads/ — картинки CMS
scripts/              check-links.mjs (+ check-links.allow), check-redirects.mjs, gen-nginx-redirects.mjs
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
локально в `src/styles/fonts.css` (без внешних CDN). Первый проход дизайна перенесён из `design-import/` (тема «ink-and-wash»): сепия `#e3ddcd`, текст `#222`, акцент `#6b3909`,
контейнер 950 px, две колонки (контент + сайдбар), тёмные «кнопки» меню; текстура бумаги — `public/theme/paper.jpg`.
Меню строится из страниц с `menu: true` (вложенные пути становятся подпунктами, выпадают по наведению/фокусу, на телефоне — раскрыты)
и пунктов `extraNav` в `site.config.ts` (там же «Форум»). Логотип пока текстовый — нужен файл от владельца (см. `docs/CONTENT-TODO.md`). Картинка Open Graph по умолчанию — SVG-заглушка; для соцсетей замените на PNG/JPG 1200×630
и поправьте `ogImage` в `site.config.ts`.

## Редиректы

Редиректы старых URL делает nginx по `redirects.csv` (см. PLAN.md), не Astro. Ключи — `$request_uri` целиком (поддерживаются `/?p=ID`, `/?page_id=ID`, кириллица в процентном кодировании); для адресов со слэшем в конце генератор
`scripts/gen-nginx-redirects.mjs` добавляет и вариант без слэша.
`npm run check:redirects` проверяет формат файла и что цели существуют в `dist/`.

## Что дальше / проверки

- `npm run verify` — astro check, сборка, битые внутренние ссылки, `redirects.csv` (все цели есть в `dist/`).
- `scripts/check-links.allow` — файлы, которых пока нет (ждём от владельца); список пустеет по мере добавления.
- Адреса ленты: `/news/` (стр. 1), `/news/page/N/`, запись — `/news/<slug>/`.
- Что надо уточнить у владельца и проверить вручную — [`docs/CONTENT-TODO.md`](docs/CONTENT-TODO.md). Админка — [`docs/ADMIN.md`](docs/ADMIN.md), деплой — [`DEPLOY.md`](DEPLOY.md).
- Скриншоты первого прохода дизайна — `docs/screenshots/`.
