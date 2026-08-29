import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { PRECISION, branchId, createdAt, instant, originId, pk, span } from './_shared';
import { entity, entityLeg } from './entities';
import { realm, world } from './world';

/**
 * Something that happened.
 *
 * An event does not get a timestamp -- it gets an interval and a precision, and
 * the solver narrows it from the links to other events. `solved_*` is the
 * solver's output and is derived: never write to it by hand. An empty solved
 * interval means the chronology is impossible, which is a finding, not a crash.
 */
export const event = sqliteTable('event', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  realmId: text('realm_id').notNull().references(() => realm.id),
  branchId: branchId(),
  originId: originId(),
  title: text('title').notNull(),
  summary: text('summary'),
  placeId: text('place_id').references(() => entity.id),
  earliest: instant('earliest'),
  latest: instant('latest'),
  durationMin: span('duration_min'),
  durationMax: span('duration_max'),
  precision: text('precision', { enum: PRECISION }).notNull().default('unknown'),
  solvedEarliest: instant('solved_earliest'),
  solvedLatest: instant('solved_latest'),
  solvedAt: integer('solved_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
}, (t) => ({
  byWorld: index('event_world_idx').on(t.worldId, t.branchId),
  byRealm: index('event_realm_idx').on(t.realmId, t.branchId),
}));

/**
 * Who took part, in which leg of their life, and how.
 *
 * The role matters for knowledge: an `actor` and a `witness` learn what the
 * event revealed, a `present_unaware` does not, and `mentioned` was not there
 * at all. `absorbs_knowledge` overrides that default per row -- she was there,
 * but she did not take it in.
 */
export const participation = sqliteTable('participation', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  eventId: text('event_id').notNull().references(() => event.id),
  entityId: text('entity_id').notNull().references(() => entity.id),
  legId: text('leg_id').references(() => entityLeg.id),
  role: text('role', {
    enum: ['actor', 'witness', 'victim', 'present_unaware', 'mentioned'],
  }).notNull(),
  /** Null means "follow the default for the role". */
  absorbsKnowledge: integer('absorbs_knowledge', { mode: 'boolean' }),
  note: text('note'),
}, (t) => ({
  byEvent: index('participation_event_idx').on(t.eventId, t.branchId),
  byEntity: index('participation_entity_idx').on(t.entityId, t.branchId),
}));

/**
 * A band between two events: "B happens three days after A", "A before B".
 *
 * `axis` decides which clock the link is read on. A cycle in `world` time is
 * allowed -- that is a causal loop, and it is often the point. A cycle in
 * `personal` time is always impossible, and that is what the solver looks for.
 */
export const temporalLink = sqliteTable('temporal_link', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  fromEventId: text('from_event_id').notNull().references(() => event.id),
  toEventId: text('to_event_id').notNull().references(() => event.id),
  kind: text('kind', {
    enum: ['before', 'after', 'same_time', 'offset', 'during'],
  }).notNull(),
  offsetMin: span('offset_min'),
  offsetMax: span('offset_max'),
  axis: text('axis', { enum: ['world', 'personal'] }).notNull().default('world'),
  /** Set when the link is read on personal time: whose. */
  legId: text('leg_id').references(() => entityLeg.id),
  note: text('note'),
}, (t) => ({
  byFrom: index('temporal_link_from_idx').on(t.fromEventId, t.branchId),
  byTo: index('temporal_link_to_idx').on(t.toEventId, t.branchId),
}));
