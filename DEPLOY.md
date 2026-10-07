# Деплой kendo-baikal.ru на VPS

Схема: push в `main` → GitHub Actions собирает Docker-образ (Astro → nginx) → пушит в GHCR → по SSH запускает `deploy.sh` на VPS → `docker compose pull && up -d` → Traefik отдаёт https://kendo-baikal.ru.
**На VPS ничего не собирается**: контейнер `nginx` с лимитом 64 МБ, без Node-сборки. Необязательно — второй контейнер `kendo-baikal-oauth` (≤ 48 МБ) для входа в админку кнопкой GitHub; см. раздел «OAuth-прокси админки» ниже. Без него сайт и вход по токену работают как раньше.

## Один раз настроить

### 1. DNS (Beget)
В панели Beget → DNS для `kendo-baikal.ru` создайте A-записи на IP VPS:

| имя | тип | значение |
|---|---|---|
| `@` (kendo-baikal.ru) | A | IP VPS |
| `www` | A | IP VPS |

Старые записи для WordPress-хостинга (A на Beget) нужно **заменить**, а не добавлять. Почтовые MX/TXT не трогайте. Проверка (должен вернуться IP VPS; обновление DNS — до нескольких часов):
```bash
dig +short kendo-baikal.ru A
dig +short www.kendo-baikal.ru A
```
Let's Encrypt (HTTP-challenge) выпустит сертификат только после того, как DNS указывает на VPS.

### 2. Папка на VPS
```bash
sudo mkdir -p /var/www/kendo-baikal && sudo chown "$USER": /var/www/kendo-baikal
cd /var/www/kendo-baikal
# скопируйте два файла из репозитория (ветка main):
curl -fsSLO https://raw.githubusercontent.com/tulubyev/kendo-baikal/main/docker-compose.prod.yml
curl -fsSLO https://raw.githubusercontent.com/tulubyev/kendo-baikal/main/deploy.sh
chmod +x deploy.sh
```
Файлы **не обновляются автоматически** (так безопаснее). Если они изменились в репозитории — перекачайте вручную. Убедитесь, что Docker-сеть `traefik-public` существует: `docker network ls | grep traefik-public`.

### 3. Права на образ в GHCR
После первой сборки Actions пакет `ghcr.io/tulubyev/kendo-baikal-web` появится в профиле GitHub (Packages). Два варианта:
- **Публичный пакет (проще):** GitHub → Packages → `kendo-baikal-web` → Package settings → Change visibility → Public. Образ содержит только публичный сайт — секретов в нём нет.
- **Приватный:** создайте классический токен с правом `read:packages` и выполните на VPS один раз `docker login ghcr.io -u <логин> --password-stdin`.

### 4. Ограниченный SSH-ключ для деплоя
На своём компьютере:
```bash
ssh-keygen -t ed25519 -f kendo-deploy -C "github-actions kendo-baikal" -N ""
```
На VPS добавьте **публичный** ключ (`kendo-deploy.pub`) в `~/.ssh/authorized_keys` пользователя, который состоит в группе `docker`, **одной строкой** с ограничениями:
```
command="cd /var/www/kendo-baikal && bash deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc ssh-ed25519 AAAA...ключ... github-actions kendo-baikal
```
Такой ключ умеет только запускать `deploy.sh`. После этого приватный файл `kendo-deploy` с компьютера удалите (он нужен только в GitHub Secrets).

### 5. GitHub Secrets
Репозиторий → Settings → Secrets and variables → Actions → New repository secret:

| Секрет | Значение |
|---|---|
| `DEPLOY_SSH_KEY` | содержимое приватного ключа `kendo-deploy` (целиком, с `BEGIN/END`) |
| `DEPLOY_HOST` | IP или имя VPS |
| `DEPLOY_USER` | пользователь SSH на VPS |
| `DEPLOY_KNOWN_HOSTS` | *(рекомендуется)* вывод `ssh-keyscan -t ed25519 <host>` с вашего компьютера. Без него отпечаток хоста берётся «на лету» |

Также Settings → Actions → General → Workflow permissions: достаточно «Read repository contents» — workflow сам запрашивает `packages: write`.

## OAuth-прокси админки (вход кнопкой GitHub; необязательно)

Отдельный образ `ghcr.io/tulubyev/kendo-baikal-oauth` (код — `oauth/`), контейнер `kendo-baikal-oauth`, маршрут Traefik `Host(kendo-baikal.ru) && PathPrefix(/oauth)` с приоритетом 100. Секреты — только в файле `/var/www/kendo-baikal/.env.oauth` на VPS (в репозитории и образе их нет). Сервис в Compose опциональный (профиль `oauth`): `deploy.sh` включает его **только если рядом лежит `.env.oauth`**. Нет файла — деплой сайта идёт как раньше и ничего не падает.

**Порядок включения** (важно: старые `deploy.sh` и `docker-compose.prod.yml` на VPS сами не обновятся):

1. **Слейте PR** с этой частью в `main` и дождитесь зелёного **Deploy** (вкладка Actions): появятся образы `kendo-baikal-web` и **`kendo-baikal-oauth`** в GHCR. Админка при этом уже перейдёт на редакционный процесс и кнопку GitHub, но прокси ещё нет — до шага 6 входите по токену (с правом **Pull requests: Read and write**, см. `docs/ADMIN.md`).
2. **Перекачайте файлы на VPS вручную** (как и раньше, они не обновляются автоматически):
   ```bash
   cd /var/www/kendo-baikal
   curl -fsSLO https://raw.githubusercontent.com/tulubyev/kendo-baikal/main/docker-compose.prod.yml
   curl -fsSLO https://raw.githubusercontent.com/tulubyev/kendo-baikal/main/deploy.sh
   curl -fsSLO https://raw.githubusercontent.com/tulubyev/kendo-baikal/main/.env.oauth.example
   chmod +x deploy.sh
   ```
   Пока `.env.oauth` нет, новый `deploy.sh` работает как старый (в логе: «.env.oauth нет — OAuth-прокси пропущен»).
3. **Создайте OAuth-приложение на GitHub и файл `.env.oauth`** — пошагово в `docs/ADMIN.md`, раздел «Для владельца», шаги 1–2 (`openssl rand -hex 32` для `COOKIE_SECRET`, `chmod 600`).
4. **Сделайте пакет GHCR публичным:** GitHub → профиль → Packages → `kendo-baikal-oauth` → Package settings → Change visibility → Public (так же, как для `kendo-baikal-web`; в образе секретов нет). Либо приватный пакет + `docker login ghcr.io` на VPS.
5. **Запустите деплой:** `bash deploy.sh` (или Actions → Deploy → Run workflow). Скрипт скачает оба образа, поднимет прокси и дождётся `healthy`.
6. **Проверьте:**
   ```bash
   curl -s https://kendo-baikal.ru/oauth/healthz              # ok
   curl -sI https://kendo-baikal.ru/oauth/auth | head -3        # 302 → github.com/login/oauth/authorize
   docker ps --filter name=kendo-baikal-oauth                   # healthy
   docker stats --no-stream kendo-baikal-oauth                  # ≪ 48 МБ (обычно ~16 МБ)
   ```
   Затем вход в админку кнопкой GitHub и полный чек-лист — `docs/ADMIN.md` («Как проверить, что всё работает»).
7. **Включите защиту ветки `main`** в GitHub (`docs/ADMIN.md`, шаг 3) — до приглашения редакторов.

Если прокси не стал `healthy`, деплой сайта всё равно завершается успешно (в логе — «ВНИМАНИЕ»): смотрите `docker logs kendo-baikal-oauth` — чаще всего не заполнен `.env.oauth` (ошибка конфигурации печатается без значений секретов).

Остановить/отключить прокси: `docker compose -f docker-compose.prod.yml --profile oauth stop kendo-baikal-oauth` и `mv .env.oauth .env.oauth.off` (иначе следующий деплой поднимет его снова). Откат образа прокси: `OAUTH_IMAGE_TAG=<полный sha> bash deploy.sh`.

## Первый запуск
1. Дождитесь зелёного прогона **Deploy** на `main` (вкладка Actions): появится образ в GHCR (если пакет приватный — шаг 3).
2. Если образ уже есть, а SSH-шага ещё нет — на VPS: `cd /var/www/kendo-baikal && bash deploy.sh`.
3. Проверка контейнера: `docker ps --filter name=kendo-baikal-web` (статус `healthy`).
4. Сертификат: подождите 1–2 минуты после первого запроса, откройте https://kendo-baikal.ru — замок без предупреждений. Логи Traefik: `docker logs <имя-контейнера-traefik> 2>&1 | grep -i kendo-baikal`.

## Повседневная работа
- Сайт обновляется сам при каждом коммите в `main` (в том числе из админки), 3–6 минут.
- Логи контейнера: `docker logs -f --tail 100 kendo-baikal-web`
- Состояние: `docker compose -f docker-compose.prod.yml ps`
- Логи прокси входа (если включён): `docker logs -f --tail 100 kendo-baikal-oauth` — без токенов и кодов.
- Принудительный передеплой: Actions → Deploy → Run workflow, либо `bash deploy.sh` на VPS.

## Откат на предыдущий образ
Каждая сборка пушится с тегом `latest` и тегом-полным-sha коммита (GitHub → Packages → `kendo-baikal-web` → Versions). На VPS:
```bash
cd /var/www/kendo-baikal
IMAGE_TAG=<полный sha нужного коммита> bash deploy.sh
```
Следующий автоматический деплой снова поставит `latest`. Чтобы откат остался — откатите коммит в `main` (`git revert`).

## Чек-лист «после запуска»
- [ ] `https://kendo-baikal.ru/` открывается, сертификат валиден, `http://` → `https://`
- [ ] `https://www.kendo-baikal.ru/foo/` → 301 на `https://kendo-baikal.ru/foo/` (`curl -sI https://www.kendo-baikal.ru/foo/`)
- [ ] Старые адреса WordPress из `redirects.csv` отдают 301 на новые (выборочно 5–10 штук, `curl -sI`)
- [ ] `/x` без слэша → 301 на `/x/`; несуществующий адрес → красивая 404
- [ ] *(если включён OAuth-прокси)* `curl https://kendo-baikal.ru/oauth/healthz` → `ok`; вход кнопкой «Войти через GitHub» работает; правка уходит в pull request «на рассмотрение» и не публикуется без одобрения (`docs/ADMIN.md`)
- [ ] `https://kendo-baikal.ru/admin/` открывается, вход по токену работает, тестовый черновик сохраняется; в консоли браузера нет ошибок CSP; заголовок `X-Robots-Tag: noindex`
- [ ] `/sitemap-index.xml` и `/robots.txt` доступны (генерирует Astro), `/rss.xml` открывается
- [ ] Заголовки: `curl -sI https://kendo-baikal.ru/` содержит `Content-Security-Policy`, `X-Content-Type-Options`; сайт не ломается из-за CSP (картинки, шрифты, скрипты загружаются)
- [ ] Память: `docker stats --no-stream kendo-baikal-web` (≪ 64 МБ)
- [ ] Google Search Console / Яндекс.Вебмастер: добавить сайт и отправить sitemap

## Что делать, если…
| Симптом | Причина / действие |
|---|---|
| Actions: `deploy` красный на SSH | Проверьте секреты; ключ и строка в `authorized_keys` (без переносов); пользователь в группе `docker` |
| `deploy.sh`: «не удалось скачать образ» | Пакет GHCR приватный и на VPS нет `docker login` (шаг 3) |
| Сертификат не выпускается | DNS ещё не указывает на VPS; порт 80 закрыт; смотрите логи Traefik |
| 502/404 от Traefik | Контейнер не healthy (`docker logs kendo-baikal-web`) или нет сети `traefik-public` |
| `/oauth/healthz` → 404 от nginx | Прокси не запущен или роутер Traefik не подхвачен: `docker ps --filter name=kendo-baikal-oauth`, есть ли `.env.oauth`, не старый ли `docker-compose.prod.yml` (шаг 2) |
| Прокси перезапускается / не healthy | Ошибка в `.env.oauth` (`docker logs kendo-baikal-oauth`: «не задана переменная …», «COOKIE_SECRET короче 32 байт») |
| Окно входа: «Ссылка для входа устарела» | Cookie не дошла или state старше 10 минут; закройте окно и повторите; проверьте, что вход идёт с https://kendo-baikal.ru, а не с www |
| Окно входа: GitHub «redirect_uri mismatch» | В OAuth-приложении callback должен быть ровно `https://kendo-baikal.ru/oauth/callback` |
| `deploy.sh`: «не удалось скачать образ» при включённом прокси | Пакет `kendo-baikal-oauth` приватный (шаг 4) или ещё не собран |
| Сборка падает на редиректах | Ошибка формата в `redirects.csv` — сообщение скажет номер строки |
