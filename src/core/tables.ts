import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema';

/**
 * Every table by its SQL name.
 *
 * The change log stores a table name and a row id rather than a typed
 * reference, because undo has to be able to reverse a write to any table
 * without knowing which one it was. This map is how it finds its way back.
 */
export const tablesByName: ReadonlyMap<string, SQLiteTable> = new Map(
  (Object.values(schema) as unknown[])
    .filter((v): v is SQLiteTable => is(v, SQLiteTable))
    .map((t) => [getTableName(t), t] as const),
);

export function tableByName(name: string): SQLiteTable {
  const table = tablesByName.get(name);
  if (!table) throw new Error(`Unknown table in change log: ${name}`);
  return table;
}

/** Tables whose rows may differ between branches. Everything else is shared. */
export const DIVERGEABLE_TABLES: ReadonlySet<string> = new Set([
  'work', 'part', 'chapter', 'scene', 'scene_text',
  'scene_event', 'reveal', 'text_anchor', 'thread', 'beat',
]);
