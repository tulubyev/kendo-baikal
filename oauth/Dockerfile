# syntax=docker/dockerfile:1
# OAuth-прокси для админки. Без зависимостей: только server.mjs. Лимит на VPS — 48 МБ.
FROM node:22-alpine

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=24 --max-semi-space-size=1" \
    PORT=8080

WORKDIR /app
COPY --chown=node:node server.mjs ./

# Не root (uid 1000, пользователь node из образа). Секретов в образе нет: всё из env_file на VPS.
USER node
EXPOSE 8080

# wget из busybox: второй процесс node в healthcheck съел бы десятки МБ лимита.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/oauth/healthz || exit 1

CMD ["node", "server.mjs"]
