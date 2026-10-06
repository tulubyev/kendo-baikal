#!/usr/bin/env bash
# Деплой на VPS: pull свежего образа из GHCR и перезапуск контейнера. Сборки здесь нет.
# Запускается из GitHub Actions по SSH (ограниченный ключ, command="cd /var/www/kendo-baikal && bash deploy.sh")
# или вручную. Идемпотентен: повторный запуск ничего не ломает.
#
# Откат на предыдущий образ:  IMAGE_TAG=<полный sha коммита> bash deploy.sh
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

COMPOSE=(docker compose -f docker-compose.prod.yml)
SERVICE=kendo-baikal-web
export IMAGE_TAG="${IMAGE_TAG:-latest}"

log() { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[deploy] ОШИБКА: %s\n' "$*" >&2; exit 1; }

# Не допускаем двух деплоев одновременно.
exec 9>.deploy.lock
flock -n 9 || die "уже идёт другой деплой (.deploy.lock)"

[ -f docker-compose.prod.yml ] || die "нет docker-compose.prod.yml в $(pwd)"
docker network inspect traefik-public >/dev/null 2>&1 || die "нет Docker-сети traefik-public"

log "образ: ghcr.io/tulubyev/kendo-baikal-web:${IMAGE_TAG}"
log "pull…"
"${COMPOSE[@]}" pull "$SERVICE" || die "не удалось скачать образ (права на пакет GHCR? см. DEPLOY.md)"

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

log "чищу неиспользуемые образы…"
docker image prune -f >/dev/null

log "готово: $(docker inspect -f '{{.Config.Image}} ({{.Image}})' "$SERVICE")"
