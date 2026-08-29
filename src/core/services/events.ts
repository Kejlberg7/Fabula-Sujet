import { event, eventFact, participation, temporalLink } from '../../db/schema';
import type { Session } from '../changelog';
import type { Context } from '../workbench';

export function createEvent(
  session: Session,
  ctx: Context,
  input: {
    title: string;
    realmId: string;
    summary?: string;
    placeId?: string;
    earliest?: number;
    latest?: number;
    durationMin?: number;
    durationMax?: number;
    precision?: 'minute' | 'hour' | 'day' | 'month' | 'year' | 'unknown';
  },
): string {
  return session.insert(event, {
    worldId: ctx.worldId, branchId: ctx.branchId, realmId: input.realmId,
    title: input.title, summary: input.summary ?? null, placeId: input.placeId ?? null,
    earliest: input.earliest ?? null, latest: input.latest ?? null,
    durationMin: input.durationMin ?? null, durationMax: input.durationMax ?? null,
    precision: input.precision ?? 'unknown',
    createdAt: new Date(),
  })['id'] as string;
}

/**
 * Who took part, and in which leg of their life.
 *
 * The role is what drives knowledge: actors and witnesses take in what the
 * event exposed, someone `present_unaware` does not. `absorbsKnowledge` is the
 * override for the case the role cannot express -- she was in the room, but she
 * misheard. Without that valve one dinner party invents a hundred beliefs.
 */
export function addParticipation(
  session: Session,
  ctx: Context,
  input: {
    eventId: string;
    entityId: string;
    role: 'actor' | 'witness' | 'victim' | 'present_unaware' | 'mentioned';
    legId?: string;
    absorbsKnowledge?: boolean;
    note?: string;
  },
): string {
  return session.insert(participation, {
    branchId: ctx.branchId, eventId: input.eventId, entityId: input.entityId,
    legId: input.legId ?? null, role: input.role,
    absorbsKnowledge: input.absorbsKnowledge ?? null, note: input.note ?? null,
  })['id'] as string;
}

/**
 * A band between two events. `axis` decides which clock it is read on.
 *
 * Ordering on personal time is what a time traveller's own life obeys; ordering
 * on world time is what everyone else's does. Most links are world links and
 * nobody has to think about it.
 */
export function addTemporalLink(
  session: Session,
  ctx: Context,
  input: {
    fromEventId: string;
    toEventId: string;
    kind: 'before' | 'after' | 'same_time' | 'offset' | 'during';
    offsetMin?: number;
    offsetMax?: number;
    axis?: 'world' | 'personal';
    legId?: string;
    note?: string;
  },
): string {
  return session.insert(temporalLink, {
    branchId: ctx.branchId, fromEventId: input.fromEventId, toEventId: input.toEventId,
    kind: input.kind,
    offsetMin: input.offsetMin ?? null,
    offsetMax: input.offsetMax ?? input.offsetMin ?? null,
    axis: input.axis ?? 'world', legId: input.legId ?? null, note: input.note ?? null,
  })['id'] as string;
}

/**
 * What the event puts on the table.
 *
 * Without this the engine knows Anna was in the room but not what the room
 * contained, and no knowledge can be derived from taking part. `slotIds`
 * narrows it: the scream tells you someone died, not who did it.
 */
export function linkEventFact(
  session: Session,
  ctx: Context,
  input: {
    eventId: string;
    factId: string;
    exposes?: 'establishes' | 'reveals' | 'evidences';
    slotIds?: string[];
    note?: string;
  },
): string {
  return session.insert(eventFact, {
    branchId: ctx.branchId, eventId: input.eventId, factId: input.factId,
    exposes: input.exposes ?? 'reveals', slotIds: input.slotIds ?? null,
    note: input.note ?? null,
  })['id'] as string;
}
