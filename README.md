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
public/               fonts/ (локальные шрифты), favicon.svg, og-default.jpg, theme/ (картинки оформления), search.js; uploads/ — картинки CMS
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

Источник — скриншоты настоящего старого сайта (`design-import/screenshots/old-*.webp`) и тема «ink-and-wash» (`design-import/theme/`).
Все цвета, шрифты, размеры, отступы — CSS-переменные в `src/styles/tokens.css`; шрифт Inter — локально (`src/styles/fonts.css`), без внешних CDN.
Картинки оформления (`public/theme/*.webp`) — перекодированные ресурсы старой темы: тушевой пейзаж шапки (`topbg.webp`, 20 КБ), кисти меню и заголовков, плашка даты, лента пагинации, подвал с горами.

- **Шапка и меню.** Название сайта — «Байкальская Федерация Кендо» (`site.config.ts`). Меню — плоский список страниц с `menu: true` (родитель, затем подпункты) + `extraNav`;
  на десктопе — два ряда «кистей», на телефоне — кнопка «Меню» (чекбокс + CSS, без JS).
- **Лента.** Плашка даты слева от «листа бумаги» (на телефоне — строкой над заголовком), заголовок, «Рубрика», картинка слева (первая картинка записи или `cover`), текст справа, чернильный разделитель, пагинация «1 2 3 4 5 » »»».
- **Сайдбар.** Поиск и блок «Страницы» — дерево всех страниц, по алфавиту, как на старом сайте.
- **Поиск.** [Pagefind](https://pagefind.app/): статический индекс строится командой `npm run build` (после `astro build`, папка `dist/pagefind/`), форма в сайдбаре ведёт на `/search/`; код страницы — `public/search.js`.
  Серверной части нет. В `npm run dev` поиск не работает (нет индекса) — проверяйте через `npm run build && npm run preview`. CSP в `nginx.conf` разрешает `'wasm-unsafe-eval'` (нужно Pagefind).
- **Картинки из текста записей.** После сборки интеграция `src/lib/upload-images.mjs` дописывает `<img src="/uploads/…">` размеры, `decoding`, `loading="lazy"` (первой — `fetchpriority="high"`).
- Комментарии, чат и форма «Ваш отзыв» старого сайта **не переносятся**. Автор записи не выводится (в данных нет поля).
- Картинка Open Graph по умолчанию — `public/og-default.jpg` (1200×630, пейзаж + название); при желании замените на макет от владельца.

## Редиректы

Редиректы старых URL делает nginx по `redirects.csv` (см. PLAN.md), не Astro. Ключи — `$request_uri` целиком (поддерживаются `/?p=ID`, `/?page_id=ID`, кириллица в процентном кодировании); для адресов со слэшем в конце генератор
`scripts/gen-nginx-redirects.mjs` добавляет и вариант без слэша.
`npm run check:redirects` проверяет формат файла и что цели существуют в `dist/`.

## Что дальше / проверки

- `npm run verify` — astro check, сборка, битые внутренние ссылки, `redirects.csv` (все цели есть в `dist/`).
- `scripts/check-links.allow` — файлы, которых пока нет (ждём от владельца); список пустеет по мере добавления.
- Адреса ленты: `/news/` (стр. 1), `/news/page/N/`, запись — `/news/<slug>/`.
- Что надо уточнить у владельца и проверить вручную — [`docs/CONTENT-TODO.md`](docs/CONTENT-TODO.md). Админка — [`docs/ADMIN.md`](docs/ADMIN.md), деплой — [`DEPLOY.md`](DEPLOY.md).
- Админка (`/admin/`, Sveltia CMS): вход кнопкой **«Войти через GitHub»** через собственный мини-прокси [`oauth/`](oauth/README.md) (Node.js без зависимостей, ≤ 48 МБ; `cd oauth && npm test`), правки редакторов идут через pull request и публикуются после одобрения владельца (редакционный процесс + защита ветки `main`). Запасной вход — по токену.
- Скриншоты нового сайта для сравнения со старым — `docs/screenshots/`; старого — `design-import/screenshots/`.
