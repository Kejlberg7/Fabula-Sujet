import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface Store {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens the database and brings it up to date.
 *
 * Pass ':memory:' for tests. Foreign keys are on: the change log's undo path
 * defers them inside its own transaction rather than switching them off, so a
 * genuinely broken write still fails loudly.
 */
export function openStore(url = process.env.FS_DATABASE_URL ?? './fabula.db'): Store {
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite, close: () => sqlite.close() };
}
