import { eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Store } from '../db/client';
import {
  branch, chapter, entity, event, fact, identity, realm, reveal, scene, series, source, thread,
  work, world,
} from '../db/schema';
import type { Context } from '../core/workbench';
import { readingOrder } from '../core/queries/order';
import { referenceByCode } from '../core/queries/references';

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
  const addressed = referenceByCode(store, ctx, needle, ['entity']);
  if (addressed) {
    const row = rows.find((item) => item.id === addressed.targetId);
    if (row) return row;
    throw new Error(`Referencen ${addressed.code} peger på noget, der er slettet.`);
  }
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
  const addressed = referenceByCode(store, ctx, needle, ['event']);
  if (addressed) {
    const row = rowsIn(store, event, event.branchId as never, ctx.branchId)
      .find((item) => item.id === addressed.targetId);
    if (row) return row;
    throw new Error(`Referencen ${addressed.code} peger på et event, der er slettet.`);
  }
  return pick(rowsIn(store, event, event.branchId as never, ctx.branchId), needle, (r) => r.title, 'event');
}

export function resolveFact(store: Store, ctx: Context, needle: string) {
  const addressed = referenceByCode(store, ctx, needle, ['fact']);
  if (addressed) {
    const row = rowsIn(store, fact, fact.branchId as never, ctx.branchId)
      .find((item) => item.id === addressed.targetId);
    if (row) return row;
    throw new Error(`Referencen ${addressed.code} peger på et faktum, der er slettet.`);
  }
  return pick(rowsIn(store, fact, fact.branchId as never, ctx.branchId), needle, (r) => r.summary, 'faktum');
}

export function resolveRealm(store: Store, ctx: Context, needle: string) {
  return pick(rowsIn(store, realm, realm.branchId as never, ctx.branchId), needle, (r) => r.name, 'lag');
}

export function resolveWork(store: Store, ctx: Context, needle: string) {
  return pick(rowsIn(store, work, work.branchId as never, ctx.branchId), needle, (r) => r.title, 'værk');
}

/** A series belongs to the world, not to a branch: the volumes branch, the shelf does not. */
export function resolveSeries(store: Store, ctx: Context, needle: string) {
  const rows = store.db.select().from(series).where(eq(series.worldId, ctx.worldId)).all();
  return pick(rows, needle, (r) => r.name, 'serie');
}

export function resolveChapter(store: Store, ctx: Context, needle: string) {
  return pick(rowsIn(store, chapter, chapter.branchId as never, ctx.branchId), needle, (r) => r.title, 'kapitel');
}

export function resolveScene(store: Store, ctx: Context, needle: string) {
  const rows = rowsIn(store, scene, scene.branchId as never, ctx.branchId);
  const addressed = referenceByCode(store, ctx, needle, ['scene']);
  if (addressed) {
    const row = rows.find((item) => item.id === addressed.targetId);
    if (row) return row;
    throw new Error(`Referencen ${addressed.code} peger på en scene, der er slettet.`);
  }
  return pick(rows, needle, (r) => r.title ?? r.id, 'scene');
}

export function resolveIdentity(store: Store, ctx: Context, needle: string, entityId?: string) {
  const rows = rowsIn(store, identity, identity.branchId as never, ctx.branchId)
    .filter((row) => !entityId || row.entityId === entityId);
  const addressed = referenceByCode(store, ctx, needle, ['identity']);
  if (addressed) {
    const row = rows.find((item) => item.id === addressed.targetId);
    if (row) return row;
    throw new Error(`Referencen ${addressed.code} peger på en identitet, der er slettet.`);
  }
  return pick(rows, needle, (row) => row.name, 'identitet');
}

export function resolveSource(store: Store, ctx: Context, needle: string) {
  const rows = store.db.select().from(source).where(eq(source.worldId, ctx.worldId)).all();
  return pick(rows, needle, (row) => row.title, 'kilde');
}

export function resolveThread(store: Store, ctx: Context, needle: string) {
  const order = readingOrder(store, ctx);
  // A thread that reaches into the chosen book is addressable from it, even
  // when it began in an earlier volume.
  const rows = rowsIn(store, thread, thread.branchId as never, ctx.branchId)
    .filter((row) => !ctx.workId || order.covers(row, ctx.workId));
  const addressed = referenceByCode(store, ctx, needle, ['thread']);
  if (addressed) {
    const row = rows.find((item) => item.id === addressed.targetId);
    if (row) return row;
    throw new Error(`Referencen ${addressed.code} peger på en plottråd, der er slettet.`);
  }
  return pick(rows, needle, (row) => row.name, 'plottråd');
}

export function resolveBranch(store: Store, ctx: Context, needle: string) {
  const rows = store.db.select().from(branch).where(eq(branch.worldId, ctx.worldId)).all();
  return pick(rows, needle, (row) => row.name, 'gren');
}

export function resolveReveal(store: Store, ctx: Context, needle: string) {
  const facts = new Map(store.db.select().from(fact).where(eq(fact.worldId, ctx.worldId)).all()
    .map((row) => [row.id, row.summary]));
  const rows = rowsIn(store, reveal, reveal.branchId as never, ctx.branchId);
  const addressed = referenceByCode(store, ctx, needle, ['reveal']);
  if (addressed) {
    const row = rows.find((item) => item.id === addressed.targetId);
    if (row) return row;
    throw new Error(`Referencen ${addressed.code} peger på en afsløring, der er slettet.`);
  }
  return pick(rows, needle, (row) => facts.get(row.factId) ?? row.id, 'afsløring');
}
