import { and, eq } from 'drizzle-orm';
import { belief, carrier, entity, entityLeg, event, participation, possession } from '../../db/schema';
import type { Store } from '../../db/client';
import type { Context } from '../workbench';
import { personalTimeOf, retentionAt, whoKnewWhat } from './knowledge';

/**
 * Where someone's knowledge changes, on their own clock.
 *
 * Not a uniform sample: the interesting moments are exactly the ones the model
 * already names -- when she was somewhere, when a belief starts or runs out,
 * when she picks something up or puts it down. Sampling every hour would be
 * both slower and less true, and it would smear the one moment that matters
 * over the two hours around it.
 *
 * This is what makes Leonard legible. His curve goes up when he sees something
 * and falls back down a quarter of an hour later, and the flat line underneath
 * it is what the polaroid in his pocket holds.
 */

export interface Stop {
  /** The moment on this person's own clock. */
  at: number;
  /** The same moment in world time, which is what a date is read off. */
  worldAt: number;
  why: string;
  /** How many facts stand at this point, by where each one comes from. */
  total: number;
  bySource: { stated: number; derived: number; carried: number };
  gained: { factId: string; summary: string; source: string }[];
  lost: { factId: string; summary: string }[];
  /**
   * Facts she still holds, but holds differently now.
   *
   * Without this the curve runs flat through the most important moment in
   * Memento: Leonard's memory of Teddy runs out and the polaroid takes over, so
   * the count never moves. He knows the same thing, and he knows it the way a
   * note in your pocket is knowing something -- which is the whole film.
   */
  changed: { factId: string; summary: string; from: string; to: string }[];
}

export function knowledgeTrack(
  store: Store,
  ctx: Context,
  query: { entityId: string; legId?: string },
): {
  entityName: string;
  legs: {
    id: string; ordinal: number; label: string | null;
    personalStart: number | null; personalEnd: number | null;
    worldStart: number | null; worldEnd: number | null;
  }[];
  legId: string | null;
  stops: Stop[];
} {
  const { db } = store;
  const who = db.select().from(entity).where(eq(entity.id, query.entityId)).get();
  if (!who) throw new Error('Personen findes ikke.');

  const legs = db.select().from(entityLeg)
    .where(and(eq(entityLeg.entityId, query.entityId), eq(entityLeg.branchId, ctx.branchId)))
    .all().sort((a, b) => a.ordinal - b.ordinal);
  const leg = (query.legId ? legs.find((l) => l.id === query.legId) : undefined) ?? legs[0];

  // World time to this leg's own clock, through the same conversion the
  // knowledge query uses -- two answers about the same moment must agree.
  const personal = (worldTime: number) =>
    personalTimeOf(store, ctx, {
      entityId: query.entityId, worldTime, legId: leg?.id ?? null,
    }).at;
  const toWorld = (at: number) =>
    leg && leg.personalStart != null && leg.worldStart != null
      ? leg.worldStart + (at - leg.personalStart)
      : at;

  const marks = new Map<number, string[]>();
  const mark = (at: number | null | undefined, why: string) => {
    if (at == null || !Number.isFinite(at)) return;
    const list = marks.get(at) ?? [];
    if (!list.includes(why)) list.push(why);
    marks.set(at, list);
  };

  if (leg?.personalStart != null) mark(leg.personalStart, 'benet begynder');
  if (leg?.personalEnd != null) mark(leg.personalEnd, 'benet slutter');

  for (const p of db.select().from(participation)
    .where(and(eq(participation.entityId, query.entityId), eq(participation.branchId, ctx.branchId)))
    .all()) {
    if (leg && p.legId && p.legId !== leg.id) continue;
    const e = db.select().from(event).where(eq(event.id, p.eventId)).get();
    const when = e?.solvedEarliest ?? e?.earliest;
    if (when != null) {
      const learnedAt = personal(when);
      mark(learnedAt, `«${e!.title}»`);
      const retention = retentionAt(store, ctx, {
        entityId: query.entityId, legId: leg?.id, learnedAt,
      });
      if (retention != null) mark(learnedAt + retention, 'oplevelsen glider ud af hukommelsen');
    }
  }

  for (const b of db.select().from(belief)
    .where(and(eq(belief.entityId, query.entityId), eq(belief.branchId, ctx.branchId))).all()) {
    if (leg && b.legId && b.legId !== leg.id) continue;
    mark(b.sincePersonal, 'en overbevisning begynder');
    mark(b.untilPersonal, 'en overbevisning løber ud');
  }

  for (const held of db.select().from(possession)
    .where(and(eq(possession.holderEntityId, query.entityId), eq(possession.branchId, ctx.branchId)))
    .all()) {
    const objectName = db.select().from(entity)
      .where(eq(entity.id, held.objectEntityId)).get()?.name ?? 'noget';
    // Only things with something written on them move the curve.
    const written = db.select().from(carrier)
      .where(and(eq(carrier.objectEntityId, held.objectEntityId), eq(carrier.branchId, ctx.branchId)))
      .all().length > 0;
    if (!written) continue;
    if (held.fromTime != null) mark(personal(held.fromTime), `får ${objectName}`);
    // A possession runs to and including its end, so the moment worth marking
    // is the first one after it -- otherwise the curve says "loses the
    // polaroid" at the last moment he is still holding it, and the count
    // underneath disagrees with the label above it.
    if (held.toTime != null) mark(personal(held.toTime) + 1, `mister ${objectName}`);
  }

  const times = [...marks.keys()].sort((a, b) => a - b);
  const stops: Stop[] = [];
  let previous = new Map<string, { summary: string; source: string }>();

  for (const at of times) {
    const answer = whoKnewWhat(store, ctx, {
      entityId: query.entityId, at, ...(leg ? { legId: leg.id } : {}),
    });
    const now = new Map(answer.items.map((i) =>
      [i.factId, { summary: i.summary, source: i.source }]));
    stops.push({
      at,
      worldAt: toWorld(at),
      why: marks.get(at)!.join(' · '),
      total: answer.items.length,
      bySource: {
        stated: answer.items.filter((i) => i.source === 'stated').length,
        derived: answer.items.filter((i) => i.source === 'derived').length,
        carried: answer.items.filter((i) => i.source === 'carried').length,
      },
      gained: answer.items
        .filter((i) => !previous.has(i.factId))
        .map((i) => ({ factId: i.factId, summary: i.summary, source: i.source })),
      lost: [...previous.entries()]
        .filter(([factId]) => !now.has(factId))
        .map(([factId, held]) => ({ factId, summary: held.summary })),
      changed: answer.items
        .filter((i) => {
          const before = previous.get(i.factId);
          return before != null && before.source !== i.source;
        })
        .map((i) => ({
          factId: i.factId, summary: i.summary,
          from: previous.get(i.factId)!.source, to: i.source,
        })),
    });
    previous = now;
  }

  return {
    entityName: who.name,
    legs: legs.map((l) => ({
      id: l.id, ordinal: l.ordinal, label: l.label,
      personalStart: l.personalStart, personalEnd: l.personalEnd,
      worldStart: l.worldStart, worldEnd: l.worldEnd,
    })),
    legId: leg?.id ?? null,
    stops,
  };
}
