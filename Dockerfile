# syntax=docker/dockerfile:1

# ---- Stage 1: сборка сайта (только в CI; на VPS не собираем) ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Редиректы WordPress → nginx map. Нет redirects.csv — получится пустой map.
# Невалидный/опасный CSV роняет сборку (см. scripts/gen-nginx-redirects.mjs).
RUN mkdir -p /out && node scripts/gen-nginx-redirects.mjs redirects.csv /out/redirects.map.conf

# ---- Stage 2: раздача статики, не от root (uid 101), порт 8080 ----
FROM nginxinc/nginx-unprivileged:1.28-alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /out/redirects.map.conf /etc/nginx/redirects.map.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/

# Проверка синтаксиса конфига на этапе сборки образа.
RUN nginx -t

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
