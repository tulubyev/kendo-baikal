#!/usr/bin/env bash
# Деплой на VPS: pull свежего образа из GHCR и перезапуск контейнера. Сборки здесь нет.
# Запускается из GitHub Actions по SSH (ограниченный ключ, command="cd /var/www/kendo-baikal && bash deploy.sh")
# или вручную. Идемпотентен: повторный запуск ничего не ломает.
#
# Откат на предыдущий образ:  IMAGE_TAG=<полный sha коммита> bash deploy.sh
# OAuth-прокси админки (необязательный) включается сам, если рядом лежит файл .env.oauth.
# Его образ по умолчанию latest; откат — OAUTH_IMAGE_TAG=<sha> bash deploy.sh
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

COMPOSE=(docker compose -f docker-compose.prod.yml)
SERVICE=kendo-baikal-web
OAUTH_SERVICE=kendo-baikal-oauth
export IMAGE_TAG="${IMAGE_TAG:-latest}"
export OAUTH_IMAGE_TAG="${OAUTH_IMAGE_TAG:-latest}"
SERVICES=("$SERVICE")

log() { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[deploy] ОШИБКА: %s\n' "$*" >&2; exit 1; }

# Не допускаем двух деплоев одновременно.
exec 9>.deploy.lock
flock -n 9 || die "уже идёт другой деплой (.deploy.lock)"

[ -f docker-compose.prod.yml ] || die "нет docker-compose.prod.yml в $(pwd)"
docker network inspect traefik-public >/dev/null 2>&1 || die "нет Docker-сети traefik-public"

# Нет .env.oauth — прокси не трогаем, сайт деплоится как раньше. Пустой/кривой файл прокси сам не пропустит
# (контейнер не станет healthy), но на деплой сайта это не влияет.
OAUTH=0
if [ -f .env.oauth ]; then
  OAUTH=1
  COMPOSE+=(--profile oauth)
  SERVICES+=("$OAUTH_SERVICE")
  chmod 600 .env.oauth 2>/dev/null || true
  log "найден .env.oauth — OAuth-прокси включён (ghcr.io/tulubyev/kendo-baikal-oauth:${OAUTH_IMAGE_TAG})"
else
  log ".env.oauth нет — OAuth-прокси пропущен (вход в админку только по токену)"
fi

log "образ: ghcr.io/tulubyev/kendo-baikal-web:${IMAGE_TAG}"
log "pull…"
"${COMPOSE[@]}" pull "${SERVICES[@]}" || die "не удалось скачать образ (права на пакет GHCR? см. DEPLOY.md)"

log "up -d…"
"${COMPOSE[@]}" up -d --remove-orphans

log "жду healthy (до 60 с)…"
status=starting
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$SERVICE" 2>/dev/null || echo missing)"
  [ "$status" = healthy ] && break
  sleep 2
done
if [ "$status" != healthy ]; then
  "${COMPOSE[@]}" logs --tail=40 "$SERVICE" >&2 || true
  die "контейнер не стал healthy (статус: $status). Откат: IMAGE_TAG=<sha предыдущей сборки> bash deploy.sh"
fi

if [ "$OAUTH" = 1 ]; then
  log "жду healthy у $OAUTH_SERVICE (до 30 с)…"
  ostatus=starting
  for _ in $(seq 1 15); do
    ostatus="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$OAUTH_SERVICE" 2>/dev/null || echo missing)"
    [ "$ostatus" = healthy ] && break
    sleep 2
  done
  if [ "$ostatus" != healthy ]; then
    # Сайт уже выложен и работает; прокси — дополнение, поэтому деплой не падает, но шумим.
    "${COMPOSE[@]}" logs --tail=20 "$OAUTH_SERVICE" >&2 || true
    log "ВНИМАНИЕ: $OAUTH_SERVICE не healthy ($ostatus): вход кнопкой GitHub не работает, вход по токену — работает. См. DEPLOY.md"
  fi
fi

log "чищу неиспользуемые образы…"
docker image prune -f >/dev/null

log "готово: $(docker inspect -f '{{.Config.Image}} ({{.Image}})' "$SERVICE")"
