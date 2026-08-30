import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { branchId, createdAt, instant, originId, pk } from './_shared';
import { realm, world } from './world';

/** People, places, objects, organisations -- everything the world is made of. */
export const entity = sqliteTable('entity', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  branchId: branchId(),
  originId: originId(),
  kind: text('kind', {
    enum: ['person', 'place', 'object', 'organisation', 'concept'],
  }).notNull(),
  /** The name you use for it while working; not necessarily one the story uses. */
  name: text('name').notNull(),
  summary: text('summary'),
  description: text('description'),
  bornEventId: text('born_event_id'),
  diedEventId: text('died_event_id'),
  createdAt: createdAt(),
}, (t) => ({
  byWorld: index('entity_world_idx').on(t.worldId, t.branchId, t.kind),
}));

/**
 * A name or shape an entity appears under. One person, three identities is the
 * Predestination case; "the stranger" who turns out to be the brother is the
 * everyday one. That two identities are the same entity is itself a fact, so
 * the reveal of it is an ordinary reveal (see `reveal`).
 */
export const identity = sqliteTable('identity', {
  id: pk(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  branchId: branchId(),
  originId: originId(),
  name: text('name').notNull(),
  /** The fact whose reveal ties this identity to the entity, if there is one. */
  sameAsFactId: text('same_as_fact_id'),
  /** The stretch of world time in which this name or appearance is in use. */
  validFrom: instant('valid_from'),
  validTo: instant('valid_to'),
  note: text('note'),
});

/**
 * A leg of an entity's own timeline.
 *
 * Everyone has at least one. A time traveller has several: personal time always
 * increases across them, while world time may jump backwards between them.
 * Knowledge hangs off the leg, not the entity -- that is what makes the young
 * self genuinely ignorant of what the older self knows.
 */
export const entityLeg = sqliteTable('entity_leg', {
  id: pk(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  branchId: branchId(),
  originId: originId(),
  /** Order along the entity's own timeline. Always ascending, never repeated. */
  ordinal: integer('ordinal').notNull(),
  label: text('label'),
  personalStart: instant('personal_start'),
  personalEnd: instant('personal_end'),
  worldStart: instant('world_start'),
  worldEnd: instant('world_end'),
  realmId: text('realm_id').references(() => realm.id),
  /** The identity the entity mostly goes by during this leg. */
  identityId: text('identity_id').references(() => identity.id),
}, (t) => ({
  byEntity: index('leg_entity_idx').on(t.entityId, t.branchId, t.ordinal),
}));

/**
 * Where a leg was, when, in which realm.
 *
 * Two presences of the same leg, in the same realm, overlapping in world time
 * and in different places, is bilocation. Different legs is time travel;
 * different realms is a body asleep upstairs. Neither is an error.
 */
export const presence = sqliteTable('presence', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  legId: text('leg_id').references(() => entityLeg.id),
  placeId: text('place_id').notNull().references(() => entity.id),
  realmId: text('realm_id').notNull().references(() => realm.id),
  fromTime: instant('from_time'),
  toTime: instant('to_time'),
  /** Derived from an event, or stated by hand. Derived rows may be overridden. */
  derivedFromEventId: text('derived_from_event_id'),
  note: text('note'),
}, (t) => ({
  byEntity: index('presence_entity_idx').on(t.entityId, t.branchId),
  byPlace: index('presence_place_idx').on(t.placeId, t.branchId),
}));

/** Who is carrying what, and when. Feeds the "the note was at home" rule. */
export const possession = sqliteTable('possession', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  holderEntityId: text('holder_entity_id').notNull().references(() => entity.id),
  holderLegId: text('holder_leg_id').references(() => entityLeg.id),
  objectEntityId: text('object_entity_id').notNull().references(() => entity.id),
  fromTime: instant('from_time'),
  toTime: instant('to_time'),
  note: text('note'),
}, (t) => ({
  byHolder: index('possession_holder_idx').on(t.holderEntityId, t.branchId),
  byObject: index('possession_object_idx').on(t.objectEntityId, t.branchId),
}));

/**
 * A state carried by an entity over time: a gun is loaded, a door is locked,
 * a document is forged. Categories are user-defined, while values within one
 * category are mutually exclusive. That small convention lets the engine find
 * contradictions without pretending to understand every fictional object.
 */
export const entityState = sqliteTable('entity_state', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  category: text('category').notNull(),
  value: text('value').notNull(),
  fromTime: instant('from_time'),
  toTime: instant('to_time'),
  note: text('note'),
}, (t) => ({
  byEntity: index('entity_state_entity_idx').on(t.entityId, t.branchId, t.category),
}));

/** A relationship that is true for a stretch of time and then is not. */
export const relationship = sqliteTable('relationship', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  fromEntityId: text('from_entity_id').notNull().references(() => entity.id),
  toEntityId: text('to_entity_id').notNull().references(() => entity.id),
  /** "mother of", "betrays", "in love with" -- defined by the world, not by us. */
  kind: text('kind').notNull(),
  /** Different values in the same category are mutually exclusive. Optional by design. */
  category: text('category'),
  symmetric: integer('symmetric', { mode: 'boolean' }).notNull().default(false),
  fromTime: instant('from_time'),
  toTime: instant('to_time'),
  note: text('note'),
}, (t) => ({
  byFrom: index('relationship_from_idx').on(t.fromEntityId, t.branchId),
}));

/**
 * An explicit disappearance and, optionally, the event that ends it.
 * Keeping these as events means fuzzy time and time travel continue to work;
 * the rule only complains about an appearance that is certainly inside the gap.
 */
export const disappearance = sqliteTable('disappearance', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  disappearsEventId: text('disappears_event_id').notNull(),
  returnsEventId: text('returns_event_id'),
  note: text('note'),
}, (t) => ({
  byEntity: index('disappearance_entity_idx').on(t.entityId, t.branchId),
}));
