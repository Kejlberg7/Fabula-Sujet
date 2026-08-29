import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  belief, carrier, entity, entityLeg, event, eventFact, fact, memoryPolicy, participation, possession,
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

/**
 * A world moment, read on someone's own clock.
 *
 * The scene happens in 1985; whether the traveller standing in it has lived
 * forty years or four depends on which leg she is on, and that is the number
 * her knowledge is indexed by. For everyone who never travels the two are the
 * same, which is why nothing else in the codebase has to think about it.
 */
export function personalTimeOf(
  store: Store,
  ctx: Context,
  query: { entityId: string; worldTime: number; legId?: string | null },
): { at: number; legId: string | null } {
  const legs = store.db.select().from(entityLeg)
    .where(and(eq(entityLeg.entityId, query.entityId), eq(entityLeg.branchId, ctx.branchId)))
    .all().sort((a, b) => a.ordinal - b.ordinal);
  const leg = (query.legId ? legs.find((l) => l.id === query.legId) : undefined)
    // With no leg named, the one whose stretch of world time contains the moment.
    ?? legs.find((l) =>
      (l.worldStart ?? Number.NEGATIVE_INFINITY) <= query.worldTime &&
      (l.worldEnd ?? Number.POSITIVE_INFINITY) >= query.worldTime)
    ?? legs[0];
  return { at: toPersonal(leg, query.worldTime), legId: leg?.id ?? null };
}

export interface KnowledgeQuery {
  entityId: string;
  /** A point in the person's own time. Leave out for "everything, ever". */
  at?: number;
  legId?: string;
}

/** Retention in force when an experience was learned; absent means permanent. */
export function retentionAt(
  store: Store,
  ctx: Context,
  query: { entityId: string; legId?: string | null; learnedAt: number },
): number | null {
  const policies = store.db.select().from(memoryPolicy)
    .where(and(eq(memoryPolicy.entityId, query.entityId), eq(memoryPolicy.branchId, ctx.branchId)))
    .all()
    .filter((p) => !p.legId || p.legId === query.legId)
    .filter((p) => (p.fromPersonal ?? Number.NEGATIVE_INFINITY) <= query.learnedAt
      && (p.untilPersonal ?? Number.POSITIVE_INFINITY) > query.learnedAt)
    .sort((a, b) => {
      const scope = Number(Boolean(b.legId)) - Number(Boolean(a.legId));
      return scope || (b.fromPersonal ?? Number.NEGATIVE_INFINITY)
        - (a.fromPersonal ?? Number.NEGATIVE_INFINITY);
    });
  return policies[0]?.retentionSeconds ?? null;
}

export function whoKnewWhat(
  store: Store,
  ctx: Context,
  query: KnowledgeQuery,
): { entityName: string; legId: string | null; at: number | null; items: KnowledgeItem[] } {
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

  /**
   * With no time given, answer for the last moment we know anything about
   * rather than the end of time. Infinity is past every expiry and past the
   * end of every possession, so "what does Leonard know" would come back
   * without the polaroid he is still holding -- true, and useless.
   */
  const lastKnown = (): number => {
    const times: number[] = [];
    if (leg?.personalEnd != null) times.push(leg.personalEnd);
    for (const p of db.select().from(participation)
      .where(and(eq(participation.entityId, query.entityId), eq(participation.branchId, ctx.branchId)))
      .all()) {
      const e = db.select().from(event).where(eq(event.id, p.eventId)).get();
      const when = e?.solvedLatest ?? e?.latest ?? e?.solvedEarliest ?? e?.earliest;
      if (when != null) times.push(toPersonal(leg, when));
    }
    for (const held of db.select().from(possession)
      .where(and(eq(possession.holderEntityId, query.entityId), eq(possession.branchId, ctx.branchId)))
      .all()) {
      if (held.fromTime != null) times.push(toPersonal(leg, held.fromTime));
    }
    return times.length ? Math.max(...times) : Number.POSITIVE_INFINITY;
  };

  const at = query.at ?? lastKnown();
  const worldAt = Number.isFinite(at) ? toWorld(leg, at) : Number.POSITIVE_INFINITY;

  /**
   * Each source is gathered separately and the winner picked afterwards.
   *
   * Overwriting as we go looked simpler and was wrong: once a stated belief had
   * expired, being present at the event quietly put the knowledge back, and
   * Leonard remembered everything after all. Keeping the candidates apart is
   * what lets an expired belief mean "he no longer remembers this" while the
   * polaroid in his pocket still says it.
   */
  const candidates = new Map<string, {
    carried?: KnowledgeItem;
    derived?: KnowledgeItem;
    stated?: KnowledgeItem;
    statedExpired?: boolean;
    statedUnaware?: boolean;
  }>();
  const slot = (factId: string) => {
    let entry = candidates.get(factId);
    if (!entry) { entry = {}; candidates.set(factId, entry); }
    return entry;
  };

  const summaryOf = (factId: string): string =>
    db.select().from(fact).where(eq(fact.id, factId)).get()?.summary ?? '(ukendt faktum)';

  // What she is carrying.
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
      slot(note.factId).carried = {
        factId: note.factId,
        summary: summaryOf(note.factId),
        source: 'carried',
        strength: note.accurate ? 'knows' : 'mistaken',
        binds: readBindings(store, 'carrier', note.id),
        viaObject: objectName ?? held.objectEntityId,
      };
    }
  }

  // What she took in by being there.
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
    const learnedAt = timeUnknown ? null : toPersonal(leg, when);
    if (learnedAt != null && learnedAt > at) continue;
    if (learnedAt != null) {
      const retention = retentionAt(store, ctx, {
        entityId: query.entityId, legId: leg?.id, learnedAt,
      });
      if (retention != null && learnedAt + retention <= at) continue;
    }

    const exposed = db.select().from(eventFact)
      .where(and(eq(eventFact.eventId, part.eventId), eq(eventFact.branchId, ctx.branchId))).all();
    for (const item of exposed) {
      // An event may expose only part of a fact: the scream tells you someone
      // died, not who did it. Anything outside the named slots stays unknown.
      const truth = readBindings(store, 'truth', item.factId);
      const only = item.slotIds as string[] | null;
      const binds = only
        ? Object.fromEntries(Object.entries(truth).filter(([name]) =>
            slotsOf(store, item.factId).some((sl) => only.includes(sl.id) && sl.name === name)))
        : truth;

      slot(item.factId).derived = {
        factId: item.factId,
        summary: summaryOf(item.factId),
        source: 'derived',
        strength: item.exposes === 'evidences' ? 'suspects' : 'knows',
        binds,
        viaEventId: part.eventId,
        ...(timeUnknown ? { timeUnknown: true } : {}),
      };
    }
  }

  // What you stated yourself.
  const stated = db.select().from(belief)
    .where(and(eq(belief.entityId, query.entityId), eq(belief.branchId, ctx.branchId)))
    .all()
    .filter((b) => !leg || !b.legId || b.legId === leg.id)
    .filter((b) => (b.sincePersonal ?? Number.NEGATIVE_INFINITY) <= at);

  for (const held of stated) {
    const entry = slot(held.factId);
    // A belief with no end never expires. Comparing it as +Infinity would drop
    // it when asked about "ever", which is exactly when it matters most.
    const expired = held.untilPersonal != null && held.untilPersonal <= at;
    if (expired) {
      entry.statedExpired = true;
      continue;
    }
    if (held.strength === 'unaware') {
      entry.statedUnaware = true;
      continue;
    }
    entry.stated = {
      factId: held.factId,
      summary: summaryOf(held.factId),
      source: 'stated',
      strength: held.strength,
      binds: readBindings(store, 'belief', held.id),
      ...(held.sourceEventId ? { viaEventId: held.sourceEventId } : {}),
    };
  }

  const items: KnowledgeItem[] = [];
  for (const entry of candidates.values()) {
    // Saying outright that she is unaware settles it, including against a note
    // in her pocket -- you were more specific than the machinery.
    if (entry.statedUnaware) continue;
    if (entry.stated) { items.push(entry.stated); continue; }
    // A belief that has run out says she no longer remembers this, so being
    // present is not allowed to hand it back. What is written down survives.
    if (entry.statedExpired) {
      if (entry.carried) items.push(entry.carried);
      continue;
    }
    const chosen = entry.derived ?? entry.carried;
    if (chosen) items.push(chosen);
  }

  return {
    entityName: who.name,
    legId: leg?.id ?? null,
    at: Number.isFinite(at) ? at : null,
    items: items.sort((a, b) => a.summary.localeCompare(b.summary, 'da')),
  };
}
