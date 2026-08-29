import { eq, type AnyColumn } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Store } from '../../db/client';
import type { Session } from '../changelog';
import { tableByName } from '../tables';

/**
 * Change or remove anything, by table name.
 *
 * One `opdater` and one `slet` across every table, while creation stays typed
 * per kind. The asymmetry is on purpose: the fields differ enormously when
 * something is made -- a realm and a belief have nothing in common -- while a
 * change is always "this row, these fields". It keeps the surface small enough
 * to be comfortable to talk to.
 */

/** Editing these through the generic path would corrupt the very record of it. */
const PROTECTED = new Set(['change', 'turn', 'checkpoint', 'app_state', 'app_user', 'current_user']);

function resolve(tableName: string) {
  if (PROTECTED.has(tableName)) {
    throw new Error(
      `"${tableName}" er en del af historikken og kan ikke rettes direkte. Brug fortryd i stedet.`,
    );
  }
  return tableByName(tableName);
}

function idColumn(table: SQLiteTable): AnyColumn {
  const column = (table as unknown as Record<string, AnyColumn | undefined>)['id'];
  if (!column) throw new Error('Tabellen har ingen id-kolonne.');
  return column;
}

export function updateRow(
  session: Session,
  store: Store,
  input: { table: string; id: string; patch: Record<string, unknown> },
): Record<string, unknown> {
  const table = resolve(input.table);
  const existing = store.db.select().from(table).where(eq(idColumn(table), input.id)).get();
  if (!existing) throw new Error(`Der findes ingen ${input.table} med id ${input.id}.`);

  // Silently changing which branch or world a row belongs to is never what was
  // meant, and it is very hard to notice afterwards.
  for (const guarded of ['id', 'branchId', 'branch_id', 'worldId', 'world_id']) {
    if (guarded in input.patch) {
      throw new Error(`Feltet "${guarded}" kan ikke rettes. Opret en ny række i stedet.`);
    }
  }
  return session.update(table, input.id, input.patch);
}

export function deleteRow(
  session: Session,
  store: Store,
  input: { table: string; id: string },
): void {
  const table = resolve(input.table);
  const existing = store.db.select().from(table).where(eq(idColumn(table), input.id)).get();
  if (!existing) throw new Error(`Der findes ingen ${input.table} med id ${input.id}.`);
  session.remove(table, input.id);
}
