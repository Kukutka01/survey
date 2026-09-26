// Единый доступ к БД для двух окружений:
//  - Cloudflare Workers / wrangler dev (miniflare): binding DB (D1, SQLite в .wrangler/state).
//  - Standalone Node-контейнер (docker-compose): node:sqlite, файл SURVEY_DB_PATH (volume /data).
// Адаптер ниже повторяет интерфейс D1: prepare().bind().first()/all()/run() и batch().

// Публичный типизированный интерфейс доступа к БД (совместим с Cloudflare D1Result).
export interface D1Result<T = unknown> { results: T[] }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface RawDb {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

// node:sqlite доступен только в standalone-режиме (в среде Workers его нет),
// поэтому типы — локальные интерфейсы, а сам модуль грузится require() внутри getLocalDb().
interface StatementSync {
  bind(...values: unknown[]): StatementSync;
  get(column?: string): unknown;
  all(): Record<string, unknown>[];
  run(): void;
}
interface DatabaseSync {
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
}

let cached: { db: DatabaseSync; statements: WeakMap<object, { sql: string; values: unknown[] }> } | null = null;

function coerce(value: unknown) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return value ?? null;
}
function normalizeRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = coerce(value);
  return out;
}

function getLocalDb() {
  if (!cached) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as unknown as { DatabaseSync: new (path: string) => DatabaseSync };
    const path: string = process.env.SURVEY_DB_PATH || '/data/survey-db.sqlite';
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL;');
    cached = { db, statements: new WeakMap() };
  }
  const state = cached;
  function runSql(sql: string, values: unknown[]) {
    const statement = state.db.prepare(sql);
    const bound = values.length ? statement.bind(...values) : statement;
    return bound;
  }
  function makeStatement(sql: string): D1PreparedStatement {
    const handle = {
      bind: (...values: unknown[]) => {
        const bound = { __sql: sql, __values: values };
        state.statements.set(bound, { sql, values });
        return {
          first: async <T>(column?: string): Promise<T | null> => {
            const row = column
              ? runSql(sql, values).get(column)
              : runSql(sql, values).get();
            if (row === undefined || row === null) return null;
            if (column) return coerce(row) as T;
            return normalizeRow(row as Record<string, unknown>) as T;
          },
          all: async <T>(): Promise<D1Result<T>> => ({
            results: (runSql(sql, values).all() as Record<string, unknown>[]).map(r => normalizeRow(r) as T),
          }),
          run: async <T>(): Promise<D1Result<T>> => { runSql(sql, values).run(); return { results: [] }; },
        };
      },
    };
    // batch() получает уже связанные statements — запоминаем их параметры
    return new Proxy(handle, {
      get(target, prop) {
        if (prop === '__d1Statement') return true;
        return Reflect.get(target, prop);
      },
    }) as unknown as D1PreparedStatement;
  }
  const local: RawDb = {
    prepare: (sql: string) => makeStatement(sql),
    batch: async <T>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
      const results: D1Result<T>[] = [];
      for (const item of items) {
        const meta = state.statements.get(item);
        if (!meta) throw new Error('batch() expects bound statements');
        const bound = runSql(meta.sql, meta.values);
        // INSERT ... RETURNING: забираем строки, иначе — просто выполняем
        let rows: unknown[] = [];
        try { rows = meta.sql.includes('RETURNING') ? bound.all() : (bound.run(), []); } catch { rows = []; }
        results.push({ results: (rows as Record<string, unknown>[]).map(normalizeRow) as T[] });
      }
      return results;
    },
  };
  return local;
}

export function getRawDb(): RawDb {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const workersEnv = require('cloudflare:workers')?.env as { DB?: RawDb } | undefined;
    if (workersEnv?.DB) return workersEnv.DB;
  } catch { /* не в среде Workers */ }
  return getLocalDb();
}
