// Init-воркер для standalone workerd: применяет схему БД при старте контейнера.
import { env } from 'cloudflare:workers';

export default {
  async scheduled() {
    const sql = env.MIGRATIONS_SQL.replace(/--[^\n]*\n/g, '\n');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await env.DB.prepare(statement).run();
    console.log(`[init] applied ${statements.length} schema statements`);
  },
};
