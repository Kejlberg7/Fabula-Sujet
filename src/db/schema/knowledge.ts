import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { branchId, createdAt, instant, originId, pk } from './_shared';
import { entity, entityLeg } from './entities';
import { event } from './events';
import { realm, world } from './world';

/**
 * A claim about the world, held as a predicate with slots rather than a sentence:
 * killed(culprit: ?, victim: Peter, time: T).
 *
 * That one decision buys partial knowledge, growing knowledge, false belief and
 * partial reveals without any of them needing their own machinery. The truth is
 * the full filling of the slots; a belief binds a subset; a reveal releases a
 * subset to the reader.
 *
 * `truth` may be `disputed` or `undecided` -- the latter is a device, not sloppiness,
 * and the consistency engine leaves it alone.
 */
export const fact = sqliteTable('fact', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  /** A fact is true *in a realm*. Flying in the dream says nothing about waking life. */
  realmId: text('realm_id').notNull().references(() => realm.id),
  branchId: branchId(),
  originId: originId(),
  /** Machine-ish name of the predicate: "killed", "is_parent_of", "can_fly". */
  predicate: text('predicate').notNull(),
  /** How you would say it out loud, for lists and search. */
  summary: text('summary').notNull(),
  truth: text('truth', {
    enum: ['true', 'false', 'disputed', 'undecided'],
  }).notNull().default('true'),
  createdAt: createdAt(),
}, (t) => ({
  byWorld: index('fact_world_idx').on(t.worldId, t.branchId),
}));

/** One slot of a fact: culprit, victim, place, time. */
export const factSlot = sqliteTable('fact_slot', {
  id: pk(),
  factId: text('fact_id').notNull().references(() => fact.id),
  branchId: branchId(),
  originId: originId(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  valueKind: text('value_kind', {
    enum: ['entity', 'time', 'place', 'text', 'number'],
  }).notNull(),
}, (t) => ({
  uniqueName: unique('fact_slot_unique').on(t.factId, t.name, t.branchId),
}));

/**
 * A filled-in slot. One shape is used everywhere a slot gets a value -- by the
 * truth, by a belief, by a statement, by what is written on a carrier -- so
 * comparing "what she thinks" with "what is so" is a slot-by-slot diff and
 * nothing more.
 */
export const binding = sqliteTable('binding', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  slotId: text('slot_id').notNull().references(() => factSlot.id),
  /** What this binding belongs to. */
  ownerKind: text('owner_kind', {
    enum: ['truth', 'belief', 'statement', 'carrier', 'reveal'],
  }).notNull(),
  ownerId: text('owner_id').notNull(),
  valueEntityId: text('value_entity_id').references(() => entity.id),
  valueTime: instant('value_time'),
  valueText: text('value_text'),
  valueNumber: integer('value_number'),
}, (t) => ({
  byOwner: index('binding_owner_idx').on(t.ownerKind, t.ownerId, t.branchId),
  bySlot: index('binding_slot_idx').on(t.slotId, t.branchId),
}));

/**
 * What someone holds to be the case.
 *
 * Indexed on *personal* time, not world time. This is the single most important
 * column in the schema: it is what keeps a young self ignorant of what an older
 * self knows, and it costs nothing when nobody time travels.
 *
 * `until_personal` lets a belief expire -- amnesia at the extreme, ordinary
 * forgetting in the mild case.
 */
export const belief = sqliteTable('belief', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  legId: text('leg_id').references(() => entityLeg.id),
  factId: text('fact_id').notNull().references(() => fact.id),
  strength: text('strength', {
    enum: ['knows', 'convinced', 'suspects', 'mistaken', 'denies', 'unaware'],
  }).notNull(),
  sincePersonal: instant('since_personal'),
  untilPersonal: instant('until_personal'),
  /** Where it came from: an event witnessed, something said, something read. */
  sourceEventId: text('source_event_id').references(() => event.id),
  sourceStatementId: text('source_statement_id'),
  sourceCarrierId: text('source_carrier_id'),
  /** True when the engine derived this rather than the writer stating it. */
  derived: integer('derived', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
}, (t) => ({
  byEntity: index('belief_entity_idx').on(t.entityId, t.branchId),
  byFact: index('belief_fact_idx').on(t.factId, t.branchId),
}));

/**
 * How long experiences remain available to a person.
 *
 * The interval is on personal time, so a time jump does not reset the clock.
 * No matching row means ordinary permanent memory. Explicit beliefs and
 * knowledge written on carriers are deliberately outside this policy.
 */
export const memoryPolicy = sqliteTable('memory_policy', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  legId: text('leg_id').references(() => entityLeg.id),
  fromPersonal: instant('from_personal'),
  untilPersonal: instant('until_personal'),
  /** Null means permanent; otherwise the number of seconds after learning. */
  retentionSeconds: integer('retention_seconds'),
  note: text('note'),
}, (t) => ({
  byEntity: index('memory_policy_entity_idx').on(t.entityId, t.branchId),
}));

/**
 * What someone says, to whom, truthfully or not.
 *
 * Speaker and audience may be the same entity: lying to yourself is the whole
 * of Leonard's ending, and the most common form of character development there is.
 */
export const statement = sqliteTable('statement', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  eventId: text('event_id').references(() => event.id),
  speakerEntityId: text('speaker_entity_id').notNull().references(() => entity.id),
  speakerLegId: text('speaker_leg_id').references(() => entityLeg.id),
  factId: text('fact_id').notNull().references(() => fact.id),
  truthful: integer('truthful', { mode: 'boolean' }),
  /** Null audience means "said openly, to whoever was present". */
  audienceEntityId: text('audience_entity_id').references(() => entity.id),
  atTime: instant('at_time'),
  note: text('note'),
}, (t) => ({
  bySpeaker: index('statement_speaker_idx').on(t.speakerEntityId, t.branchId),
}));

/**
 * A fact written down in an object: a polaroid, a tattoo, a letter, a ledger.
 *
 * Effective knowledge is what she remembers plus what she is carrying, which is
 * where the "she acted on a note she left at home" finding comes from.
 */
export const carrier = sqliteTable('carrier', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  objectEntityId: text('object_entity_id').notNull().references(() => entity.id),
  factId: text('fact_id').notNull().references(() => fact.id),
  /** A note can be wrong, or a forgery. */
  accurate: integer('accurate', { mode: 'boolean' }).notNull().default(true),
  writtenEventId: text('written_event_id').references(() => event.id),
  destroyedEventId: text('destroyed_event_id').references(() => event.id),
  note: text('note'),
}, (t) => ({
  byObject: index('carrier_object_idx').on(t.objectEntityId, t.branchId),
}));
