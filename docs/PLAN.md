# Kendo Байкал — новый сайт на Astro

Домен: **kendo-baikal.ru** (DNS и почта — Beget). Старый сайт — WordPress, копия лежит
локально у владельца (в этот репозиторий **не** попадает, репозиторий публичный).

## Цели

- Статический сайт на Astro, только русский язык, ~25 страниц на старте + лента новостей.
- Дизайн переносится с текущего WordPress-сайта (источник — `design-import/`, см. ниже).
- Админка для редакторов: добавлять посты, править записи и страницы без разработчика.
- Хостинг на VPS с жёсткими ограничениями по памяти.

## Ограничения сервера (важно)

- VPS: **3.8 ГБ RAM**, из них ~2.7 ГБ уже занято, своп в работе, ~25 контейнеров.
  Поэтому: **никакого PHP/MySQL/WordPress, никакой Node-сборки и Node-рантайма на VPS**.
- На сервере работает **Traefik v2.11** (Let's Encrypt, HTTP-challenge, certresolver `letsencrypt`),
  внешняя Docker-сеть **`traefik-public`**. Маршруты задаются **Docker labels** (файл `dynamic.yml` не трогаем).
- Прецедент: `irk.name` — Astro static → контейнер nginx. Повторяем этот паттерн
  (репозиторий `tulubyev/irk-name`, публичный — можно подсмотреть `Dockerfile`/`docker-compose.yml`).
- Итог: на VPS крутится **один контейнер `nginx:alpine`** (лимит ~64 МБ) со статикой.

## Архитектура

```
Редактор → /admin (Sveltia/Decap CMS, в браузере) → коммит в main (GitHub API)
                                                        │
GitHub Actions: astro build → docker build → push ghcr.io/tulubyev/kendo-baikal-web
                                                        │  ssh (ограниченный ключ, command=deploy.sh)
VPS: docker compose pull && up -d  →  Traefik  →  https://kendo-baikal.ru
```

- **Админка — git-based CMS** (Sveltia CMS, формат конфига совместим с Decap CMS) — статический
  SPA по адресу `/admin/`, без серверной части и без БД, 0 МБ RAM на сервере.
  Контент = Markdown-файлы в репозитории, картинки = `public/uploads/`.
  Вход: GitHub (редакторы приглашаются коллабораторами репозитория; вход по персональному токену
  или OAuth — решает агент `admin-deploy`, обосновав выбор в `docs/ADMIN.md`).
  Если Sveltia не подходит — допустим Decap CMS (+ мини OAuth-прокси в отдельном контейнере ≤30 МБ).
- Сборка **только в GitHub Actions**, образ в GHCR, на VPS — только `pull` и `up -d`.
- `www.kendo-baikal.ru` → 301 на `kendo-baikal.ru`.
- Старые URL WordPress → 301 по таблице `redirects.csv` (nginx `map`, генерируется при сборке образа).

## Структура репозитория и владельцы

| Путь | Владелец (агент) |
|---|---|
| `tools/wp-export/`, `docs/WP-EXPORT.md` | **wp-export** |
| `design-import/` (создаётся при запуске экспорта у владельца) | wp-export (формат), владелец (данные) |
| `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/**`, `scripts/check-*.mjs`, `public/` (кроме `admin/`, `uploads/`) | **astro-site** |
| `public/admin/**`, `docs/ADMIN.md` | **admin-deploy** |
| `Dockerfile`, `nginx.conf`, `docker-compose.prod.yml`, `deploy.sh`, `scripts/gen-nginx-redirects.mjs`, `.github/workflows/**`, `DEPLOY.md` | **admin-deploy** |
| `redirects.csv` (формат ниже) | генерирует wp-export, читает admin-deploy |

Не редактируйте чужие пути. Если нужно изменение в чужой зоне — опишите в PR-описании.

## Контракт контента (frontmatter)

Файлы: `src/content/pages/**/*.md` и `src/content/posts/*.md`. Имя файла = slug.

**pages** (`/<slug>/`, вложенные пути допустимы: `club/history.md` → `/club/history/`; `index.md` — главная):

| поле | тип | |
|---|---|---|
| `title` | string | обязательно |
| `description` | string | необязательно (SEO) |
| `menu` | boolean | в главное меню, по умолчанию `false` |
| `order` | number | порядок в меню |
| `image` | string | путь вида `/uploads/...`, необязательно |
| `draft` | boolean | по умолчанию `false`, черновики не собираются |

**posts** (`/news/<slug>/`, лента `/news/`, пагинация, RSS `/rss.xml`):

| поле | тип | |
|---|---|---|
| `title` | string | обязательно |
| `description` | string | необязательно |
| `date` | datetime | обязательно |
| `updated` | datetime | необязательно |
| `category` | string | необязательно |
| `tags` | string[] | по умолчанию `[]` |
| `cover` | string | `/uploads/...`, необязательно |
| `draft` | boolean | по умолчанию `false` |

Схемы реализует `astro-site` в `src/content.config.ts`; конфиг админки `admin-deploy` обязан им соответствовать.

## Формат `redirects.csv`

```
from,to,status
/2021/05/01/old-post/,/news/old-post/,301
/?p=123,/news/old-post/,301
```
Пути от корня, первая строка — заголовок, статус по умолчанию 301.

## Безопасность

- Репозиторий публичный: **никаких** SQL-дампов, `wp-config.php`, выгрузки пользователей, e-mail, хэшей паролей,
  ключей и токенов. В `.gitignore`: `*.sql`, `*.sql.gz`, `wp-config.php`, `.env*`, `export-private/`.
- Секреты — только в GitHub Secrets / на сервере: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`.
- Деплой-ключ на VPS — ограниченный (`command="cd /var/www/kendo-baikal && bash deploy.sh"`, без pty и форвардинга).

## Порядок работы

1. **wp-export** — инструмент локального экспорта (запускает владелец): контент → Markdown, медиа,
   отчёт-аудит, `redirects.csv`, `design-import/` (CSS темы, шрифты, логотип, токены, скриншоты).
2. **astro-site** и **admin-deploy** — параллельно, на заглушках контента.
3. Владелец запускает экспорт, коммитит `src/content/**`, `public/uploads/**`, `design-import/`, `redirects.csv`.
4. Второй проход **astro-site**: перенос дизайна из `design-import/` (CSS-переменные, шрифты, макеты).
5. Ревью + проверка: сборка, ссылки, редиректы, Lighthouse, мобильная версия. Деплой на VPS вручную владельцем по `DEPLOY.md`.

## Ветки

Интеграционная ветка: `claude/kendo-baikal-astro-site-7swphj`. Каждый агент работает в своей ветке
(`claude/kendo-<роль>`) и открывает **draft PR в интеграционную ветку** (не в `main`).
