# Продакшн-образ анкеты «Траектория»: Next/vinext-сборка на standalone workerd.
# Требует Docker BuildKit (по умолчанию в Docker 23+ / compose v2).
# syntax=docker/dockerfile:1

# ---------- Этап сборки ----------
FROM node:22.19.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 npm_config_fund=false npm_config_audit=false

# Кэшируем зависимости отдельно от исходников
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Прод-сборка (vinext -> dist/server + dist/client)
COPY . .
RUN npm run build

# ---------- Этап рантайма ----------
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gettext-base ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# workerd — standalone-рантайм Cloudflare Workers: исполняет прод-сборку вместе
# с локальной SQLite-базой (D1 durableSqlStorage binding, volume /data).
ARG WORKERD_VERSION=1.20250927.0
RUN ARCH="$(dpkg --print-architecture)" \
 && case "$ARCH" in \
      amd64) WARCH=x64 ;; \
      arm64) WARCH=arm64 ;; \
      *) echo "unsupported arch: $ARCH" && exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/workerd \
      "https://github.com/cloudflare/workerd/releases/download/v${WORKERD_VERSION}/workerd-linux-${WARCH}" \
 && chmod 755 /usr/local/bin/workerd \
 && "/usr/local/bin/workerd" --version

# Непривилегированный пользователь; все данные — только в /data (volume)
RUN useradd -r -u 1001 -m appuser && mkdir -p /data && chown appuser:appuser /data

WORKDIR /srv
# dist/server — бандл worker; dist/client — статические ассеты (отдаются binding ASSETS)
COPY --from=build /app/dist/server ./worker
COPY --from=build /app/dist/client ./assets
COPY docker/workerd.config.template docker/workerd.init.config.template \
     docker/init-worker.mjs docker/migrations.sql docker/entrypoint.sh ./docker/
RUN chmod +x docker/entrypoint.sh && chown -R appuser:appuser /srv

USER appuser
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
 CMD curl -fsS http://127.0.0.1:8080/ -o /dev/null || exit 1

ENTRYPOINT ["./docker/entrypoint.sh"]
