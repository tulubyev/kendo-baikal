# OAuth-прокси для админки (Sveltia CMS)

Минимальный сервер «Войти через GitHub» для `https://kendo-baikal.ru/admin/`. Свой код вместо сторонних npm-пакетов
(цепочка поставок): один файл `server.mjs`, **ноль зависимостей**, только `node:http`, `node:crypto` и `fetch`.
Контейнер ~16 МБ в работе, лимит на VPS — 48 МБ. Настройка владельцем и развёртывание — `docs/ADMIN.md`, `DEPLOY.md`.

## Как это работает

```
Админка (/admin/)                Прокси (/oauth/*)                      GitHub
   │ нажали «Войти через GitHub»
   ├─ window.open(/oauth/auth?provider=github&site_id=…&scope=…) ─►
   │                              ├ state = nonce.время.HMAC; cookie с nonce
   │                              └ 302 ─────────────────────────────► /login/oauth/authorize
   │                                                                     (пользователь входит)
   │                              ◄─ 302 /oauth/callback?code=…&state=… ─┤
   │                              ├ проверка state: подпись, ≤10 мин, cookie, одноразовость
   │                              ├ POST /login/oauth/access_token ────► токен
   │                              ├ GET  /user ────────────────────────► логин
   │                              └ логин ∈ ALLOWED_USERS?
   │                                  нет → страница «Доступ запрещён», токен отзывается
   │                                  да  → страница с postMessage
   │ ◄─ "authorizing:github" ───────┤   (окно ↔ админка, только origin https://kendo-baikal.ru)
   ├─ "authorizing:github" ────────►│
   │ ◄─ "authorization:github:success:{"token":…,"provider":"github"}" ─┤
   └ окно закрывается, админка работает с токеном
```

Формат сообщений и сборка URL сверены по исходникам Sveltia CMS 0.229.0 (`shared/auth.js`): URL входа = `base_url` + `/` + `auth_endpoint`,
т. е. `https://kendo-baikal.ru/oauth/auth`; админка принимает сообщения только от своего окна и только с origin этого URL.
Параметры `site_id` и `scope` из запроса игнорируются: область доступа задаёт сервер.

## Маршруты

| Маршрут | Назначение |
|---|---|
| `GET /oauth/auth` | редирект на GitHub (`client_id`, `redirect_uri`, `scope`, `state`) |
| `GET /oauth/callback` | обмен кода, проверка логина, страница с `postMessage` / страница отказа |
| `GET /oauth/healthz` | `200 ok` (без лимита запросов) |

## Настройка (переменные окружения)

| Переменная | |
|---|---|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth App на GitHub (обязательны) |
| `COOKIE_SECRET` | ≥ 32 байт, ключ HMAC для `state` (обязателен; `openssl rand -hex 32`) |
| `ALLOWED_USERS` | логины через запятую, без учёта регистра; **пусто = вход запрещён всем** |
| `PUBLIC_ORIGIN` | по умолчанию `https://kendo-baikal.ru`; единственный допустимый target-origin для `postMessage` |
| `OAUTH_SCOPE` | по умолчанию `public_repo` (см. ниже) |
| `PORT` | по умолчанию `8080` |
| `GITHUB_OAUTH_URL`, `GITHUB_API_URL` | **только для тестов**: подмена `https://github.com` / `https://api.github.com` (http допустим лишь для localhost) |

Секреты берутся только из env (на VPS — `env_file: .env.oauth`, `chmod 600`). Шаблон — `/.env.oauth.example`.

**Scope.** Для коммитов, pull request'ов и меток в **публичном** репозитории достаточно `public_repo`; Sveltia по умолчанию просит `repo`
(он включает приватные репозитории), но принимает `auth_scope: public_repo` (это есть в его схеме конфига). Если репозиторий станет приватным —
`repo` в `public/admin/config.yml` и `OAUTH_SCOPE=repo` здесь.

## Безопасность

- `state` подписан HMAC-SHA256, живёт ≤ 10 минут, привязан к cookie (`HttpOnly; Secure; SameSite=Lax`, путь `/oauth`) и **одноразовый**; проверяется до обращения к GitHub.
- Логин проверяется по `GET /user` и сверяется с `ALLOWED_USERS`; токен постороннего не отдаётся, а отзывается у GitHub.
- Ответы: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`; у HTML — строгий CSP с nonce (`default-src 'none'`).
- Токен вставляется в страницу через экранированный JSON; `postMessage` адресован только `PUBLIC_ORIGIN`, ответ CMS принимается только от открывшего окна.
- Лимит 30 запросов/мин на IP (в памяти, с верхней границей числа ключей). `X-Forwarded-For` учитывается только если соединение пришло из частной сети (Traefik в Docker) и берётся его последний элемент — подделать его снаружи нельзя.
- Таймаут 8 с на каждый запрос к GitHub, редиректы запрещены; ошибки GitHub клиенту не показываются.
- В логах (JSON в stdout) — только событие, путь **без query**, статус, логин. Токенов, кодов, `state` и секретов нет (проверено тестом).
- Контейнер: не root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, `mem_limit: 48m`.

## Тесты

```bash
cd oauth && npm test        # node --test, мок-сервер GitHub, без сети и зависимостей
```
Покрыто: успешный вход (в т. ч. выполнение скрипта страницы по протоколу CMS), чужой логин и пустой список, подделанный/чужой/просроченный/повторный `state`,
повторное использование кода, ошибки GitHub, отсутствие секретов в логах, лимит запросов и `X-Forwarded-For`, валидация конфигурации, запуск процесса.

## Образ

```bash
docker build -t kendo-baikal-oauth oauth/
docker run --rm -p 8080:8080 --env-file ../.env.oauth kendo-baikal-oauth
```
В CI (`.github/workflows/`): на PR — тесты и сборка без push; на `main` — сборка и push `ghcr.io/tulubyev/kendo-baikal-oauth:{latest,<sha>}`.
