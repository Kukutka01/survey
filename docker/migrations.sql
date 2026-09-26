-- Схема БД анкеты «Траектория» (SQLite / D1). Применяется entrypoint.sh при старте.
CREATE TABLE IF NOT EXISTS responses (
  id text PRIMARY KEY NOT NULL,
  answers text NOT NULL,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS private_profiles (
  id text PRIMARY KEY NOT NULL,
  encrypted_profile text NOT NULL,
  consent_version integer NOT NULL,
  consent_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS survey_submissions (
  id text PRIMARY KEY NOT NULL,
  answers text NOT NULL,
  payload_hash text NOT NULL,
  created_at text NOT NULL,
  version integer NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY NOT NULL,
  count integer NOT NULL,
  expires_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry_idx ON rate_limits (expires_at);
-- Сессии админки: хранится только HMAC от случайного токена (в cookie), срок жизни.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token text PRIMARY KEY NOT NULL,
  expires_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions (expires_at);
