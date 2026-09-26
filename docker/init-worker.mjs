// Init-воркер для standalone workerd: применяет схему БД при первом запросе.
// workerd не позволяет запустить воркер без socket и не вызывает scheduled()
// в standalone-режиме, поэтому entrypoint.sh делает один служебный fetch на
// http://127.0.0.1:<INIT_PORT>/ — этого достаточно, чтобы применить миграции.
import { env } from 'cloudflare:workers';

async function applySchema() {
  const sql = env.MIGRATIONS_SQL.replace(/--[^\n]*\n/g, '\n');
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  for (const statement of statements) await env.DB.prepare(statement).run();
  console.log(`[init] applied ${statements.length} schema statements`);
}

let applied = null; // идемпотентность: повторяющиеся запросы не применяют схему дважды

export default {
  async fetch() {
    if (!applied) applied = applySchema();
    await applied;
    return new Response('ok', { status: 200 });
  },
  async scheduled() {
    await applySchema();
  },
};
