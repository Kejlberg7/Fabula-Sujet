import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  belief, carrier, entity, entityLeg, event, eventFact, fact, participation, possession,
} from '../../db/schema';
import type { Context } from '../workbench';
import { readBindings, slotsOf, type BoundSlots } from './bindings';

/**
 * What someone knew, at a point in *their own* time.
 *
 * Knowledge is worked out on read rather than stored as derived rows. That way
 * it cannot go stale behind a later edit, and the writer never has to remember
 * to re-run anything. When there is enough data to make it slow, the same
 * function becomes the thing that fills a cache; the answer will not change.
 *
 * Three sources, in order of authority:
 *
 *   stated   what you wrote down about her yourself -- always wins
 *   derived  what she took in by being there
 *   carried  what is written on whatever she has on her
 */
export interface KnowledgeItem {
  factId: string;
  summary: string;
  source: 'stated' | 'derived' | 'carried';
  strength: string;
  binds: BoundSlots;
  /** Set when the fact came from being present, or from something carried. */
  viaEventId?: string;
  viaObject?: string;
  /** True when the event has no place in time yet, so "by now" cannot be checked. */
  timeUnknown?: boolean;
}

/** Roles that take in what an event exposed, unless the row says otherwise. */
const ABSORBING_ROLES = new Set(['actor', 'witness', 'victim']);

interface LegClock {
  id: string;
  personalStart: number | null;
  worldStart: number | null;
}

/**
 * Personal time and world time are the same thing shifted, for one leg.
 * With no anchors on the leg they are simply the same, which is the ordinary
 * case for everyone who never travels.
 */
function toPersonal(leg: LegClock | undefined, worldTime: number): number {
  if (!leg || leg.personalStart == null || leg.worldStart == null) return worldTime;
  return leg.personalStart + (worldTime - leg.worldStart);
}

function toWorld(leg: LegClock | undefined, personalTime: number): number {
  if (!leg || leg.personalStart == null || leg.worldStart == null) return personalTime;
  return leg.worldStart + (personalTime - leg.personalStart);
}

export interface KnowledgeQuery {
  entityId: string;
  /** A point in the person's own time. Leave out for "everything, ever". */
  at?: number;
  legId?: string;
}

export function whoKnewWhat(
  store: Store,
  ctx: Context,
  query: KnowledgeQuery,
): { entityName: string; legId: string | null; items: KnowledgeItem[] } {
  const { db } = store;
  const who = db.select().from(entity).where(eq(entity.id, query.entityId)).get();
  if (!who) throw new Error(`Ukendt person: ${query.entityId}`);

  const legs = db.select().from(entityLeg)
    .where(and(eq(entityLeg.entityId, query.entityId), eq(entityLeg.branchId, ctx.branchId)))
    .all().sort((a, b) => a.ordinal - b.ordinal);

  const leg = query.legId
    ? legs.find((l) => l.id === query.legId)
    : query.at == null
      ? legs[0]
      : legs.find((l) =>
          (l.personalStart ?? Number.NEGATIVE_INFINITY) <= query.at! &&
          (l.personalEnd ?? Number.POSITIVE_INFINITY) >= query.at!) ?? legs[0];

  const at = query.at ?? Number.POSITIVE_INFINITY;
  const worldAt = Number.isFinite(at) ? toWorld(leg, at) : Number.POSITIVE_INFINITY;
  const byFact = new Map<string, KnowledgeItem>();

  const summaryOf = (factId: string): string =>
    db.select().from(fact).where(eq(fact.id, factId)).get()?.summary ?? '(ukendt faktum)';

  // 3. What she is carrying. Weakest, so it goes in first and may be overwritten.
  const carried = db.select().from(possession)
    .where(and(eq(possession.holderEntityId, query.entityId), eq(possession.branchId, ctx.branchId)))
    .all()
    .filter((p) => (p.fromTime ?? Number.NEGATIVE_INFINITY) <= worldAt
      && (p.toTime ?? Number.POSITIVE_INFINITY) >= worldAt);

  for (const held of carried) {
    const objectName = db.select().from(entity).where(eq(entity.id, held.objectEntityId)).get()?.name;
    const written = db.select().from(carrier)
      .where(and(eq(carrier.objectEntityId, held.objectEntityId), eq(carrier.branchId, ctx.branchId)))
      .all();
    for (const note of written) {
      byFact.set(note.factId, {
        factId: note.factId,
        summary: summaryOf(note.factId),
        source: 'carried',
        strength: note.accurate ? 'knows' : 'mistaken',
        binds: readBindings(store, 'carrier', note.id),
        viaObject: objectName ?? held.objectEntityId,
      });
    }
  }

  // 2. What she took in by being there.
  const took = db.select().from(participation)
    .where(and(eq(participation.entityId, query.entityId), eq(participation.branchId, ctx.branchId)))
    .all()
    .filter((p) => p.absorbsKnowledge ?? ABSORBING_ROLES.has(p.role))
    .filter((p) => !leg || !p.legId || p.legId === leg.id);

  for (const part of took) {
    const happened = db.select().from(event).where(eq(event.id, part.eventId)).get();
    if (!happened) continue;
    const when = happened.solvedEarliest ?? happened.earliest;
    const timeUnknown = when == null;
    if (!timeUnknown && toPersonal(leg, when) > at) continue;

    const exposed = db.select().from(eventFact)
      .where(and(eq(eventFact.eventId, part.eventId), eq(eventFact.branchId, ctx.branchId))).all();
    for (const item of exposed) {
      // An event may expose only part of a fact: the scream tells you someone
      // died, not who did it. Anything outside the named slots stays unknown.
      const truth = readBindings(store, 'truth', item.factId);
      const only = item.slotIds as string[] | null;
      const binds = only
        ? Object.fromEntries(Object.entries(truth).filter(([name]) =>
            slotsOf(store, item.factId).some((s) => only.includes(s.id) && s.name === name)))
        : truth;

      byFact.set(item.factId, {
        factId: item.factId,
        summary: summaryOf(item.factId),
        source: 'derived',
        strength: item.exposes === 'evidences' ? 'suspects' : 'knows',
        binds,
        viaEventId: part.eventId,
        ...(timeUnknown ? { timeUnknown: true } : {}),
      });
    }
  }

  // 1. What you stated yourself. Always wins -- including "she is wrong about this".
  const stated = db.select().from(belief)
    .where(and(eq(belief.entityId, query.entityId), eq(belief.branchId, ctx.branchId)))
    .all()
    .filter((b) => !leg || !b.legId || b.legId === leg.id)
    .filter((b) => (b.sincePersonal ?? Number.NEGATIVE_INFINITY) <= at)
    // A belief with no end never expires. Comparing it as +Infinity would drop
    // it when asked about "ever", which is exactly when it matters most.
    .filter((b) => b.untilPersonal == null || b.untilPersonal > at);

  for (const held of stated) {
    if (held.strength === 'unaware') {
      byFact.delete(held.factId);
      continue;
    }
    byFact.set(held.factId, {
      factId: held.factId,
      summary: summaryOf(held.factId),
      source: 'stated',
      strength: held.strength,
      binds: readBindings(store, 'belief', held.id),
      ...(held.sourceEventId ? { viaEventId: held.sourceEventId } : {}),
    });
  }

  return {
    entityName: who.name,
    legId: leg?.id ?? null,
    items: [...byFact.values()].sort((a, b) => a.summary.localeCompare(b.summary, 'da')),
  };
}
