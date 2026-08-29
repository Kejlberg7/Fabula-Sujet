import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { branchId, createdAt, instant, originId, pk } from './_shared';
import { entity } from './entities';
import { world } from './world';

/**
 * What can and cannot happen here.
 *
 * Two kinds, and they do opposite jobs. An `ability` lifts a built-in rule for
 * someone in particular -- Anna can fly, so travel time does not apply to her.
 * A `prohibition` adds a limit the engine did not know about -- magic fails near iron.
 *
 * The built-in rules ask this table *before* they report anything. That is the
 * difference between a tool you use and a tool you switch off: an exception is
 * something you wrote down about your world, not something you click away.
 *
 * Laws are inherited downwards. Gravity holds in the dream until someone says
 * otherwise about that realm, because what is worth writing down is the exception.
 */
export const law = sqliteTable('law', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  branchId: branchId(),
  originId: originId(),
  kind: text('kind', { enum: ['ability', 'prohibition'] }).notNull(),
  /**
   * `hard` laws point at a built-in rule and the engine computes with them.
   * `soft` laws are prose -- Claude reads them alongside the scene. Soft laws
   * catch everything we failed to anticipate, which is most of it.
   */
  hardness: text('hardness', { enum: ['hard', 'soft'] }).notNull(),
  /** Which built-in rule this modifies. Null for soft laws. */
  ruleCode: text('rule_code'),
  /** Where it applies. Null scope_id with kind 'world' means the whole world. */
  scopeKind: text('scope_kind', {
    enum: ['world', 'series', 'work', 'realm'],
  }).notNull(),
  scopeId: text('scope_id'),
  /**
   * Who it applies to. `carrier_holder` is the important one -- it is the ring,
   * the sword and the totem, and it is why the subject is a rule and not a list.
   */
  subjectKind: text('subject_kind', {
    enum: ['everyone', 'entity', 'entity_kind', 'carrier_holder'],
  }).notNull().default('everyone'),
  subjectEntityId: text('subject_entity_id').references(() => entity.id),
  subjectExpression: text('subject_expression'),
  statement: text('statement').notNull(),
  validFrom: instant('valid_from'),
  validTo: instant('valid_to'),
  /** Where this came from, when it is borrowed from reality rather than invented. */
  sourceId: text('source_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
}, (t) => ({
  byWorld: index('law_world_idx').on(t.worldId, t.branchId, t.enabled),
  byRule: index('law_rule_idx').on(t.ruleCode, t.branchId),
}));

/**
 * Research: anything you want the story to stay honest about.
 *
 * A source is stored and shown, not read -- extracting text from a PDF or a
 * photographed page is phase 5 work and deliberately out of scope here. The
 * claims you draw from a source are soft laws with a provenance, which is how
 * "a diesel engine will not start at forty below" ends up being checked by the
 * same machinery as "magic fails near iron".
 */
export const source = sqliteTable('source', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  kind: text('kind', {
    enum: ['note', 'link', 'pdf', 'article', 'image', 'file'],
  }).notNull(),
  title: text('title').notNull(),
  url: text('url'),
  /** Path inside the attachment store, for anything uploaded. */
  filePath: text('file_path'),
  mimeType: text('mime_type'),
  byteSize: integer('byte_size'),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => ({
  byWorld: index('source_world_idx').on(t.worldId),
}));

/** What a source backs up: a fact, a law, an event, a scene. */
export const sourceLink = sqliteTable('source_link', {
  id: pk(),
  sourceId: text('source_id').notNull().references(() => source.id),
  branchId: branchId(),
  targetKind: text('target_kind', {
    enum: ['fact', 'law', 'event', 'entity', 'scene', 'work'],
  }).notNull(),
  targetId: text('target_id').notNull(),
  quote: text('quote'),
  note: text('note'),
}, (t) => ({
  byTarget: index('source_link_target_idx').on(t.targetKind, t.targetId, t.branchId),
}));
