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
# envsubst подставляет переменные в workerd.config.template; без экспорта они
# раскроются в пустые строки и воркер получит битые биндинги.
export SURVEY_SIGNING_KEY VK_ENCRYPTION_KEY
export TRUSTED_PROXIES="${TRUSTED_PROXIES:-}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"   # пусто => админка отключена (fail-closed)

# workerd в standalone-режиме не завершается сам и не вызывает scheduled() без
# планировщика, поэтому: запускаем init-воркер в фоне на служебном ephemeral-порту,
# делаем к нему один запрос (в этом запросе применяется схема), затем останавливаем.
INIT_PORT=$(( 20000 + ( $$ % 20000 ) ))
envsubst < /srv/docker/workerd.config.template     > /tmp/workerd.config.capnp
INIT_PORT="$INIT_PORT" envsubst < /srv/docker/workerd.init.config.template > /tmp/workerd.init.config.capnp

echo "[entrypoint] initializing database schema on :${INIT_PORT}..."
workerd --root /srv /tmp/workerd.init.config.capnp >/tmp/init.log 2>&1 &
INIT_PID=$!

READY=0
i=0
while [ $i -lt 50 ]; do
  if curl -fsS "http://127.0.0.1:${INIT_PORT}/" -o /dev/null 2>/dev/null; then READY=1; break; fi
  kill -0 "$INIT_PID" 2>/dev/null || break   # init-воркер упал — дальше ждать бессмысленно
  sleep 0.2
  i=$(( i + 1 ))
done
kill "$INIT_PID" 2>/dev/null
wait "$INIT_PID" 2>/dev/null || true

if [ "$READY" = "1" ] && grep -q "\[init\]" /tmp/init.log; then
  echo "[entrypoint] $(grep '\[init\]' /tmp/init.log | tail -1)"
else
  echo "[entrypoint] WARNING: schema init did not report success; last init lines:" >&2
  tail -5 /tmp/init.log >&2 || true
fi

echo "[entrypoint] starting workerd on :${PORT}"
exec workerd --root /srv /tmp/workerd.config.capnp
