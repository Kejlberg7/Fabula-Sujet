import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  belief, carrier, entity, entityLeg, event, eventFact, fact, factSlot, participation,
  placeLink, possession, presence, realm, statement,
} from '../../db/schema';
import { lawsLifting } from '../laws/consult';
import type { Context } from '../workbench';

/**
 * What the rules work on, and the discipline they all obey.
 *
 * One principle runs through every rule here: **only report what cannot be
 * arranged otherwise.** An event whose time is vague can be placed anywhere in
 * its interval, and if any placement is consistent then there is nothing wrong
 * -- the writer simply has not decided yet. A tool that confused "not yet
 * decided" with "impossible" would fire on half of a working draft, and a tool
 * that cries wolf gets switched off inside a week. That is the whole design
 * budget of this layer: silence unless certain.
 */

export interface Finding {
  ruleCode: string;
  severity: 'error' | 'warning' | 'note';
  message: string;
  subjects: {
    events?: string[];
    entities?: string[];
    places?: string[];
    facts?: string[];
    realms?: string[];
    rows?: string[];
  };
  /** Stable across runs, so a dismissal sticks and a fix genuinely disappears. */
  fingerprint: string;
  /** Set when a law allowed it. Such a finding is kept apart, never reported. */
  lifted?: string;
}

/**
 * Somebody, somewhere, for a stretch of time.
 *
 * Presences and events both put a person in a place, and the rules do not care
 * which one said so -- so they are flattened into one shape before anything
 * looks at them. `earliest`/`latest` bound the *start*; the occupation runs for
 * `duration` from wherever the start lands.
 */
export interface Occupation {
  entityId: string;
  legId: string | null;
  placeId: string;
  realmId: string;
  earliest: number;
  latest: number;
  duration: number;
  label: string;
  /**
   * Does this pin the person to one place, or only say where they were based?
   *
   * An event pins them: they were doing that thing, there. A stated presence
   * usually does not -- "Leonard, the motel, 1 to 6 March" means that is where
   * he is staying, not that he never left the room, and treating it as
   * exclusive reports every errand he runs as being in two places at once.
   * A presence derived from an event inherits the event's exclusivity.
   */
  exclusive: boolean;
  sourceKind: 'event' | 'presence';
  sourceId: string;
  /** Only set for event-derived occupations, for the "jump to it" link. */
  eventId?: string;
}

export interface Snapshot {
  store: Store;
  ctx: Context;
  entities: Map<string, typeof entity.$inferSelect>;
  legs: Map<string, typeof entityLeg.$inferSelect>;
  legsOf: Map<string, typeof entityLeg.$inferSelect[]>;
  events: Map<string, typeof event.$inferSelect>;
  participations: typeof participation.$inferSelect[];
  presences: typeof presence.$inferSelect[];
  possessions: typeof possession.$inferSelect[];
  beliefs: typeof belief.$inferSelect[];
  statements: typeof statement.$inferSelect[];
  carriers: typeof carrier.$inferSelect[];
  facts: Map<string, typeof fact.$inferSelect>;
  slots: Map<string, typeof factSlot.$inferSelect[]>;
  eventFacts: typeof eventFact.$inferSelect[];
  links: typeof placeLink.$inferSelect[];
  realms: Map<string, typeof realm.$inferSelect>;
  occupations: Occupation[];
  /** Names, for messages. Every message says who and what, never an id. */
  name: (id: string | null | undefined) => string;
  /** Ask the law layer. A rule calls this before it reports, never after. */
  lifted: (query: {
    ruleCode: string;
    entityId?: string | null;
    realmId?: string | null;
    at?: number | null;
  }) => string | undefined;
}

/** Roles that actually put a body in the room. */
const PRESENT_ROLES = new Set(['actor', 'witness', 'victim', 'present_unaware']);

export function loadSnapshot(store: Store, ctx: Context): Snapshot {
  const { db } = store;
  const mine = <T extends { branchId: string }>(rows: T[]) =>
    rows.filter((r) => r.branchId === ctx.branchId);

  const entities = new Map(
    db.select().from(entity).where(and(
      eq(entity.worldId, ctx.worldId), eq(entity.branchId, ctx.branchId),
    )).all().map((e) => [e.id, e]),
  );
  const legRows = mine(db.select().from(entityLeg).all());
  const legsOf = new Map<string, typeof entityLeg.$inferSelect[]>();
  for (const leg of legRows) {
    const list = legsOf.get(leg.entityId) ?? [];
    list.push(leg);
    legsOf.set(leg.entityId, list);
  }
  for (const list of legsOf.values()) list.sort((a, b) => a.ordinal - b.ordinal);

  const events = new Map(
    db.select().from(event).where(and(
      eq(event.worldId, ctx.worldId), eq(event.branchId, ctx.branchId),
    )).all().map((e) => [e.id, e]),
  );
  const participations = mine(db.select().from(participation).all());
  const presences = mine(db.select().from(presence).all());
  const facts = new Map(
    db.select().from(fact).where(and(
      eq(fact.worldId, ctx.worldId), eq(fact.branchId, ctx.branchId),
    )).all().map((f) => [f.id, f]),
  );
  const slots = new Map<string, typeof factSlot.$inferSelect[]>();
  for (const s of mine(db.select().from(factSlot).all())) {
    const list = slots.get(s.factId) ?? [];
    list.push(s);
    slots.set(s.factId, list);
  }
  for (const list of slots.values()) list.sort((a, b) => a.position - b.position);

  const name = (id: string | null | undefined): string =>
    (id ? entities.get(id)?.name : null) ?? 'noget unavngivet';

  /**
   * An event places everyone who was in the room; a presence places one person
   * by hand. Both become the same shape, and both carry their vagueness with
   * them rather than being snapped to a point.
   */
  const occupations: Occupation[] = [];
  for (const p of participations) {
    if (!PRESENT_ROLES.has(p.role)) continue;
    const e = events.get(p.eventId);
    if (!e?.placeId) continue;
    const earliest = e.solvedEarliest ?? e.earliest;
    if (earliest == null) continue;
    occupations.push({
      entityId: p.entityId,
      legId: p.legId,
      placeId: e.placeId,
      realmId: e.realmId,
      earliest,
      latest: e.solvedLatest ?? e.latest ?? earliest,
      duration: e.durationMin ?? 0,
      label: `«${e.title}»`,
      exclusive: true,
      sourceKind: 'event',
      sourceId: p.id,
      eventId: e.id,
    });
  }
  for (const p of presences) {
    if (p.fromTime == null) continue;
    occupations.push({
      entityId: p.entityId,
      legId: p.legId,
      placeId: p.placeId,
      realmId: p.realmId,
      // A presence is stated by hand: its start is exact, and it runs to its end.
      earliest: p.fromTime,
      latest: p.fromTime,
      duration: p.toTime == null ? 0 : Math.max(0, p.toTime - p.fromTime),
      label: `ophold i ${name(p.placeId)}`,
      exclusive: p.derivedFromEventId != null,
      sourceKind: 'presence',
      sourceId: p.id,
      ...(p.derivedFromEventId ? { eventId: p.derivedFromEventId } : {}),
    });
  }

  return {
    store, ctx, entities, legs: new Map(legRows.map((l) => [l.id, l])), legsOf,
    events, participations, presences,
    possessions: mine(db.select().from(possession).all()),
    beliefs: mine(db.select().from(belief).all()),
    statements: mine(db.select().from(statement).all()),
    carriers: mine(db.select().from(carrier).all()),
    facts, slots,
    eventFacts: mine(db.select().from(eventFact).all()),
    links: mine(db.select().from(placeLink).all()),
    realms: new Map(db.select().from(realm).where(and(
      eq(realm.worldId, ctx.worldId), eq(realm.branchId, ctx.branchId),
    )).all().map((r) => [r.id, r])),
    occupations,
    name,
    lifted: (query) => lawsLifting(store, ctx, {
      ...query,
      entityKind: query.entityId ? entities.get(query.entityId)?.kind ?? null : null,
      workId: ctx.workId,
    })[0]?.statement,
  };
}

/**
 * Can these two be compared as the same person at the same time at all?
 *
 * Different legs is time travel and not an error; an unassigned leg on someone
 * who has several is not something we are willing to guess about. Saying
 * nothing there is the right answer: the cost is a finding we did not raise,
 * which is always cheaper than one we raised wrongly.
 */
export function sameLife(snap: Snapshot, a: Occupation, b: Occupation): boolean {
  if (a.entityId !== b.entityId) return false;
  if (a.realmId !== b.realmId) return false;
  if (a.legId && b.legId) return a.legId === b.legId;
  if (!a.legId && !b.legId) return (snap.legsOf.get(a.entityId)?.length ?? 1) <= 1;
  return false;
}

/** The earliest and latest moments an occupation can end. */
export const endsEarliest = (o: Occupation) => o.earliest + o.duration;
export const endsLatest = (o: Occupation) => o.latest + o.duration;

/**
 * Is there *no* arrangement in which a finishes before b starts?
 *
 * The best case for keeping them apart is a as early as it can be and b as late
 * as it can be. If even that overlaps, no placement avoids it.
 */
export const cannotPrecede = (a: Occupation, b: Occupation): boolean =>
  endsEarliest(a) > b.latest;

/** True only when every possible placement has the two overlapping. */
export const mustOverlap = (a: Occupation, b: Occupation): boolean =>
  cannotPrecede(a, b) && cannotPrecede(b, a);

/** A fingerprint that does not change when the same problem is found again. */
export function fingerprint(ruleCode: string, ...parts: (string | number)[]): string {
  return `${ruleCode}:${parts.map(String).sort().join('|')}`;
}

export interface Rule {
  code: string;
  /** Danish, for the report. */
  title: string;
  run: (snap: Snapshot) => Finding[];
}
