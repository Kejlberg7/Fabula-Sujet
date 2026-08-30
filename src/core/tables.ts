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

/**
 * Content copied into a branch snapshot. Global containers, users, sources,
 * the change log and derived findings stay outside it.
 *
 * Phase 6 edits narrative rows in the interface, but copying the whole story
 * state is intentional: a branch must still be able to see its people, facts,
 * events and realms, and it leaves the door open for a later "what if she
 * survived?" branch without another storage model.
 */
export const DIVERGEABLE_TABLES: ReadonlySet<string> = new Set([
  'realm', 'place_link',
  'entity', 'identity', 'entity_leg', 'presence', 'possession', 'entity_state',
  'relationship', 'disappearance',
  'event', 'participation', 'temporal_link', 'event_fact',
  'fact', 'fact_slot', 'binding', 'belief', 'memory_policy', 'statement', 'carrier',
  'law', 'source_link',
  'work', 'part', 'chapter', 'scene', 'scene_text',
  'scene_event', 'reveal', 'text_anchor', 'thread', 'beat',
  'suggestion',
]);
