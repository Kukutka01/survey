import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const responses=sqliteTable('responses',{id:text('id').primaryKey(),answers:text('answers').notNull(),createdAt:text('created_at').notNull()});
export const surveySubmissions=sqliteTable('survey_submissions',{id:text('id').primaryKey(),answers:text('answers').notNull(),payloadHash:text('payload_hash').notNull(),createdAt:text('created_at').notNull(),version:integer('version').notNull()});
export const privateProfiles=sqliteTable('private_profiles',{id:text('id').primaryKey(),encryptedProfile:text('encrypted_profile').notNull(),consentVersion:integer('consent_version').notNull(),consentAt:text('consent_at').notNull()});
export const rateLimits=sqliteTable('rate_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()},t=>[index('rate_limits_expiry_idx').on(t.expiresAt)]);
export const adminSessions=sqliteTable('admin_sessions',{token:text('token').primaryKey(),expiresAt:integer('expires_at').notNull()},t=>[index('admin_sessions_expiry_idx').on(t.expiresAt)]);
