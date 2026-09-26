// Идемпотентная инициализация схемы БД внутри workerd (nodejs_compat + node:sqlite).
// Запускается ОДНОРАЗОВЫМ прогоном `workerd serve` до основного сервера:
//   workerd serve --socket-addr=init=unix:/tmp/init.sock /tmp/workerd.init.config.capnp
// Миграции читаются через fetch() со встроенного статического сервиса (docker/migrations.sql),
// применяются к файлу /data/survey-db.sqlite (том docker-compose) и процесс завершается
// выходом из event loop (сокет init закрыт). Все statements — CREATE ... IF NOT EXISTS,
// поэтому повторные запуски безопасны.
import { env } from 'cloudflare:workers';
import { DatabaseSync } from 'node:sqlite';

// SURVEY_DB_PATH — text-binding из workerd.init.config.capnp (envsubst).
const DB_PATH = (typeof env !== 'undefined' && env.SURVEY_DB_PATH)
  ? env.SURVEY_DB_PATH
  : (process.env.SURVEY_DB_PATH || '/data/survey-db.sqlite');

async function applySchema() {
  const res = await fetch('http://static/migrations.sql');
  if (!res.ok) throw new Error(`migrations.sql недоступен: HTTP ${res.status}`);
  const sql = await res.text();
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    for (const statement of statements) db.exec(statement);
  } finally {
    db.close();
  }
  console.log(`[init] applied ${statements.length} schema statements to ${DB_PATH}`);
}

export default {
  async fetch() {
    try {
      await applySchema();
      return new Response('ok\n', { status: 200 });
    } catch (e) {
      console.error('[init] FAILED:', e?.stack || String(e));
      return new Response('init failed\n', { status: 500 });
    }
  },
};
