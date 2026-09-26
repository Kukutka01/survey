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
# раскроются в пустые строки и воркер получит битые (пустые) секреты-биндинги.
export SURVEY_SIGNING_KEY VK_ENCRYPTION_KEY
export TRUSTED_PROXIES="${TRUSTED_PROXIES:-}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"   # пусто => админка отключена (fail-closed)

envsubst < /srv/docker/workerd.config.template   > /tmp/workerd.config.capnp
envsubst < /srv/docker/workerd.init.config.template > /tmp/workerd.init.config.capnp

# workerd в обычном режиме слушает сокеты из конфига и не завершается сам,
# поэтому инит-прогон ограничиваем по времени (timeout) — за это время
# scheduled-хук успевает применить миграции.
INIT_TIMEOUT="${DB_INIT_TIMEOUT:-10}"
echo "[entrypoint] initializing database schema (up to ${INIT_TIMEOUT}s)..."
timeout "$INIT_TIMEOUT" workerd --root /srv /tmp/workerd.init.config.capnp >/tmp/init.log 2>&1 || true
if grep -q "\[init\]" /tmp/init.log; then
  sed -n 's/.*(\[init\].*)/\1/p' /tmp/init.log | tail -1
else
  echo "[entrypoint] WARNING: schema init did not report success; last init lines:" >&2
  tail -5 /tmp/init.log >&2 || true
fi

echo "[entrypoint] starting workerd on :${PORT}"
exec workerd --root /srv /tmp/workerd.config.capnp
