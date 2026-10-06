# Деплой kendo-baikal.ru на VPS

Схема: push в `main` → GitHub Actions собирает Docker-образ (Astro → nginx) → пушит в GHCR → по SSH запускает `deploy.sh` на VPS → `docker compose pull && up -d` → Traefik отдаёт https://kendo-baikal.ru.
**На VPS ничего не собирается**: контейнер `nginx` с лимитом 64 МБ, без Node.

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

## Первый запуск
1. Дождитесь зелёного прогона **Deploy** на `main` (вкладка Actions): появится образ в GHCR (если пакет приватный — шаг 3).
2. Если образ уже есть, а SSH-шага ещё нет — на VPS: `cd /var/www/kendo-baikal && bash deploy.sh`.
3. Проверка контейнера: `docker ps --filter name=kendo-baikal-web` (статус `healthy`).
4. Сертификат: подождите 1–2 минуты после первого запроса, откройте https://kendo-baikal.ru — замок без предупреждений. Логи Traefik: `docker logs <имя-контейнера-traefik> 2>&1 | grep -i kendo-baikal`.

## Повседневная работа
- Сайт обновляется сам при каждом коммите в `main` (в том числе из админки), 3–6 минут.
- Логи контейнера: `docker logs -f --tail 100 kendo-baikal-web`
- Состояние: `docker compose -f docker-compose.prod.yml ps`
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
| Сборка падает на редиректах | Ошибка формата в `redirects.csv` — сообщение скажет номер строки |
