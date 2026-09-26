#!/bin/sh
# Стартовый скрипт продакшн-контейнера «Траектория».
# 1) Fail-fast: без секретов контейнер не стартует.
# 2) Инит-прогон workerd: создаёт durable SQLite в /data и применяет docker/migrations.sql.
#    (D1-запросы внутри init-воркера идут в тот же файл /data/survey-db.sqlite.)
# 3) Основной запуск workerd с прод-сборкой; данные на volume /data переживают рестарты.
set -e

: "${SURVEY_SIGNING_KEY:?SURVEY_SIGNING_KEY не задан. Сгенерируйте: openssl rand -base64 32}"
: "${VK_ENCRYPTION_KEY:?VK_ENCRYPTION_KEY не задан. Сгенерируйте: openssl rand -base64 32}"
export PORT="${PORT:-8080}"
export TRUSTED_PROXIES="${TRUSTED_PROXIES:-}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"   # пусто => админка отключена (fail-closed)

mkdir -p /data/cache

envsubst < /srv/docker/workerd.config.template   > /tmp/workerd.config.capnp
envsubst < /srv/docker/workerd.init.config.template > /tmp/workerd.init.config.capnp

echo "[entrypoint] initializing database schema..."
if ! workerd --root /srv /tmp/workerd.init.config.capnp; then
  echo "[entrypoint] WARNING: init failed, continuing (schema may already exist)" >&2
fi

echo "[entrypoint] starting workerd on :${PORT}"
exec workerd --root /srv /tmp/workerd.config.capnp
