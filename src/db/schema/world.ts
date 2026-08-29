import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { branchId, createdAt, instant, originId, pk } from './_shared';

/**
 * A world is a universe. It owns realms, entities, laws and chronology.
 * Several series and several standalone works may share one -- a trilogy and a
 * novel a thousand years apart in the same world is the case this exists for.
 */
export const world = sqliteTable('world', {
  id: pk(),
  name: text('name').notNull(),
  summary: text('summary'),
  createdAt: createdAt(),
});

/**
 * How time is counted. Gregorian is the only implementation for now; the table
 * exists so that an invented calendar, or a relativistic clock on a ship, is a
 * new row and a new realm rather than a rebuild. Base unit is seconds.
 */
export const timeSystem = sqliteTable('time_system', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['gregorian', 'custom'] }).notNull().default('gregorian'),
  /** Calendar definition for custom systems: epochs, month lengths, day length. */
  config: text('config', { mode: 'json' }),
});

/**
 * A realm is a world inside a world: reality, a dream, a simulation, a story
 * someone tells, a side timeline. It has its own clock and its own scope of
 * truth. `reality` is the root and has no parent.
 *
 * `time_ratio_num / time_ratio_den` is how fast this realm runs relative to its
 * parent -- 20/1 for each dream level in the Inception fixture.
 */
export const realm = sqliteTable('realm', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  parentRealmId: text('parent_realm_id'),
  branchId: branchId(),
  originId: originId(),
  name: text('name').notNull(),
  kind: text('kind', {
    enum: ['reality', 'dream', 'simulation', 'story', 'timeline', 'other'],
  }).notNull(),
  timeSystemId: text('time_system_id').notNull().references(() => timeSystem.id),
  timeRatioNum: integer('time_ratio_num').notNull().default(1),
  timeRatioDen: integer('time_ratio_den').notNull().default(1),
  /** The events that open and close the realm, seen from the parent. */
  entryEventId: text('entry_event_id'),
  exitEventId: text('exit_event_id'),
  summary: text('summary'),
  createdAt: createdAt(),
}, (t) => ({
  byWorld: index('realm_world_idx').on(t.worldId, t.branchId),
}));

/** Optional grouping of works. A work may belong to a world without a series. */
export const series = sqliteTable('series', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  name: text('name').notNull(),
  summary: text('summary'),
  position: integer('position'),
  createdAt: createdAt(),
});

/**
 * Travel between places, as a graph rather than a map -- it can carry
 * "two days on horseback, four hours by train" without anyone drawing a map
 * that does not exist yet. Travel time is a hard limit; only an explicit
 * ability (see `law`) lifts it.
 */
export const placeLink = sqliteTable('place_link', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  realmId: text('realm_id').notNull().references(() => realm.id),
  fromPlaceId: text('from_place_id').notNull(),
  toPlaceId: text('to_place_id').notNull(),
  /** "on foot", "by car", "by raven" -- free text, defined by the world. */
  mode: text('mode').notNull(),
  travelMin: instant('travel_min'),
  travelMax: instant('travel_max'),
  /** False when the link only goes one way (downstream, a one-way portal). */
  bidirectional: integer('bidirectional', { mode: 'boolean' }).notNull().default(true),
  note: text('note'),
}, (t) => ({
  byFrom: index('place_link_from_idx').on(t.fromPlaceId, t.branchId),
  uniqueRoute: unique('place_link_unique').on(t.fromPlaceId, t.toPlaceId, t.mode, t.branchId),
}));
