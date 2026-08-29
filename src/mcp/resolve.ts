import { eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Store } from '../db/client';
import { chapter, entity, event, fact, realm, scene, work, world } from '../db/schema';
import type { Context } from '../core/workbench';

/**
 * Turning what was said into what was meant.
 *
 * When a story is talked in rather than typed in, nobody says "entity
 * 7k3m9x". They say "Anna". So every reference accepts an id, a name, or
 * enough of a name to be unambiguous -- and when it is ambiguous, the answer
 * lists the candidates instead of picking one. Guessing wrong here is the kind
 * of mistake that is very hard to spot later.
 */
function pick<T extends { id: string }>(
  rows: readonly T[],
  needle: string,
  label: (row: T) => string,
  kind: string,
  elsewhere?: () => string[],
): T {
  const byId = rows.find((r) => r.id === needle);
  if (byId) return byId;

  const lowered = needle.trim().toLowerCase();
  const exact = rows.filter((r) => label(r).toLowerCase() === lowered);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new Error(
      `Der er ${exact.length}, der hedder "${needle}". Brug et id: ${exact.map((r) => `${label(r)} (${r.id})`).join(', ')}`,
    );
  }

  const partial = rows.filter((r) => label(r).toLowerCase().includes(lowered));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) {
    // With several worlds in one database, looking in the wrong one is the
    // confusing failure: the name is right there, just not here. Say so.
    const others = elsewhere?.() ?? [];
    const hint = others.length
      ? ` Der findes en i ${others.map((w) => `"${w}"`).join(' og ')} — skift verden med saet_aktivt_vaerk.`
      : '';
    throw new Error(`Jeg kan ikke finde nogen ${kind} der hedder "${needle}" i denne verden.${hint}`);
  }
  throw new Error(
    `"${needle}" kan være flere ting: ${partial.slice(0, 8).map((r) => `${label(r)} (${r.id})`).join(', ')}. Vær lidt mere præcis.`,
  );
}

function rowsIn<T extends SQLiteTable>(store: Store, table: T, branchColumn: never, branchId: string) {
  return store.db.select().from(table).where(eq(branchColumn, branchId)).all();
}

export function resolveEntity(store: Store, ctx: Context, needle: string, kind?: string) {
  const rows = rowsIn(store, entity, entity.branchId as never, ctx.branchId)
    .filter((e) => !kind || e.kind === kind);
  const elsewhere = () => {
    const lowered = needle.trim().toLowerCase();
    const rest = store.db.select().from(entity).all()
      .filter((e) => e.worldId !== ctx.worldId && e.name.toLowerCase().includes(lowered));
    return [...new Set(rest.map((e) =>
      store.db.select().from(world).where(eq(world.id, e.worldId)).get()?.name ?? '(ukendt)'))];
  };
  return pick(rows, needle, (r) => r.name, kind ? `${kind}` : 'person eller ting', elsewhere);
}

export function resolveEvent(store: Store, ctx: Context, needle: string) {
  return pick(rowsIn(store, event, event.branchId as never, ctx.branchId), needle, (r) => r.title, 'event');
}

export function resolveFact(store: Store, ctx: Context, needle: string) {
  return pick(rowsIn(store, fact, fact.branchId as never, ctx.branchId), needle, (r) => r.summary, 'faktum');
}

export function resolveRealm(store: Store, ctx: Context, needle: string) {
  return pick(rowsIn(store, realm, realm.branchId as never, ctx.branchId), needle, (r) => r.name, 'lag');
}

export function resolveWork(store: Store, ctx: Context, needle: string) {
  return pick(rowsIn(store, work, work.branchId as never, ctx.branchId), needle, (r) => r.title, 'værk');
}

export function resolveChapter(store: Store, ctx: Context, needle: string) {
  return pick(rowsIn(store, chapter, chapter.branchId as never, ctx.branchId), needle, (r) => r.title, 'kapitel');
}

export function resolveScene(store: Store, ctx: Context, needle: string) {
  const rows = rowsIn(store, scene, scene.branchId as never, ctx.branchId);
  return pick(rows, needle, (r) => r.title ?? r.id, 'scene');
}
