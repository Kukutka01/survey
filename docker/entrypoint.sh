#!/bin/sh
# Стартовый скрипт продакшн-контейнера «Траектория».
# 1) Fail-fast: без секретов контейнер не стартует.
# 2) Инит-прогон workerd (serve + unix-сокет + curl): создаёт SQLite в /data
#    и идемпотентно применяет docker/migrations.sql (все statements — IF NOT EXISTS).
# 3) Основной запуск workerd serve с прод-сборкой; данные на volume /data
#    переживают рестарты.
#
# ВАЖНО: начиная с workerd ~1.2026x конфигурация передаётся одной позиционной
# аргумент-файловой схемой capnp, отдельного флага --root больше нет
# (`workerd serve <config.capnp>`). Пути embed в конфиге разрешаются
# относительно каталога самого .capnp-файла, поэтому готовые конфиги
# пишутся в /tmp, а абсолютные симлинки /tmp/worker и /tmp/docker
# указывают на /srv/worker и /srv/docker.
set -e

# Если compose не передал секреты (например, в .env нет строк SURVEY_SIGNING_KEY /
# VK_ENCRYPTION_KEY или файл .env отсутствует) — выводим понятную инструкцию и
# завершаемся с ошибкой. Контейнер перезапустится через 30 секунд, к этому времени
# можно успеть исправить .env.
if [ -z "$SURVEY_SIGNING_KEY" ] || [ -z "$VK_ENCRYPTION_KEY" ]; then
  echo "[entrypoint] ОШИБКА: не заданы секреты SURVEY_SIGNING_KEY и/или VK_ENCRYPTION_KEY." >&2
  echo "[entrypoint] Выполните в каталоге проекта:" >&2
  echo "[entrypoint]   cp -n .env.example .env" >&2
  echo "[entrypoint]   echo \"SURVEY_SIGNING_KEY=\$(openssl rand -base64 32)\" >> .env" >&2
  echo "[entrypoint]   echo \"VK_ENCRYPTION_KEY=\$(openssl rand -base64 32)\"  >> .env" >&2
  echo "[entrypoint] затем: docker compose up -d" >&2
  sleep 30
  exit 1
fi

export PORT="${PORT:-8080}"
# envsubst подставляет переменные в шаблоны workerd.*.template; без экспорта
# SURVEY_SIGNING_KEY / VK_ENCRYPTION_KEY раскроются в пустые строки и воркер
# получит битые (пустые) секреты-биндинги.
export SURVEY_SIGNING_KEY VK_ENCRYPTION_KEY
export TRUSTED_PROXIES="${TRUSTED_PROXIES:-}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"   # пусто => админка отключена (fail-closed)
export SURVEY_DB_PATH="/data/survey-db.sqlite"

mkdir -p /data/cache

envsubst < /srv/docker/workerd.config.template       > /tmp/workerd.config.capnp
envsubst < /srv/docker/workerd.init.config.template  > /tmp/workerd.init.config.capnp

# Абсолютные симлинки для embed-путей из /tmp/*.capnp
ln -sfn /srv/worker /tmp/worker
ln -sfn /srv/docker /tmp/docker

echo "[entrypoint] initializing database schema..."
workerd serve --socket-addr=init=unix:/tmp/init.sock /tmp/workerd.init.config.capnp &
INIT_PID=$!
# ждем готовности unix-сокета и запускаем миграции
i=0
until [ -S /tmp/init.sock ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
if curl -s --fail --max-time 30 --unix-socket /tmp/init.sock http://localhost/init; then
  echo ""
  echo "[entrypoint] schema initialized."
else
  echo "[entrypoint] WARNING: init failed, continuing (schema may already exist)" >&2
fi
kill "$INIT_PID" 2>/dev/null || true
wait "$INIT_PID" 2>/dev/null || true
rm -f /tmp/init.sock

echo "[entrypoint] starting workerd on :${PORT}"
exec workerd serve /tmp/workerd.config.capnp
