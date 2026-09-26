import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { branchId, createdAt, originId, pk } from './_shared';
import { entity, entityLeg } from './entities';
import { event } from './events';
import { fact } from './knowledge';
import { realm, series, world } from './world';

/**
 * A line of development of the whole project.
 *
 * A branch is not a copy of everything: it is a parent plus a fork point, and
 * creating one copies the story's branch-scoped rows, stamping each
 * copy's `origin_id` with where it came from. Reading a branch is therefore a
 * plain `where branch_id = ?`.
 *
 * The phase-6 interface changes narrative order and reveals, but the snapshot
 * also carries the bible and chronology. That keeps every branch independently
 * readable and already permits the later "what if he had survived" case.
 */
export const branch = sqliteTable('branch', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  parentBranchId: text('parent_branch_id'),
  /** Position in the change log the branch was taken from. */
  forkChangeSeq: integer('fork_change_seq'),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  /** Set when you pick one branch and shelve the rest. Branches are never merged. */
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
}, (t) => ({
  byWorld: index('branch_world_idx').on(t.worldId),
}));

/** A book. It picks its world, and optionally its series. Both are optional. */
export const work = sqliteTable('work', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  seriesId: text('series_id').references(() => series.id),
  branchId: branchId(),
  originId: originId(),
  title: text('title').notNull(),
  summary: text('summary'),
  position: integer('position'),
  createdAt: createdAt(),
}, (t) => ({
  byWorld: index('work_world_idx').on(t.worldId, t.branchId),
}));

export const part = sqliteTable('part', {
  id: pk(),
  workId: text('work_id').notNull().references(() => work.id),
  branchId: branchId(),
  originId: originId(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
});

export const chapter = sqliteTable('chapter', {
  id: pk(),
  workId: text('work_id').notNull().references(() => work.id),
  partId: text('part_id').references(() => part.id),
  branchId: branchId(),
  originId: originId(),
  title: text('title').notNull(),
  /** Reading order. This, not chronology, is the second axis. */
  position: integer('position').notNull(),
  summary: text('summary'),
}, (t) => ({
  byWork: index('chapter_work_idx').on(t.workId, t.branchId, t.position),
}));

/**
 * The atomic unit of telling.
 *
 * Point of view is recorded because it is cheap to write down and expensive to
 * retrofit, and because it is what makes the POV-leak rule possible at all:
 * a scene told from Anna cannot contain what only Peter could know.
 */
export const scene = sqliteTable('scene', {
  id: pk(),
  chapterId: text('chapter_id').notNull().references(() => chapter.id),
  branchId: branchId(),
  originId: originId(),
  title: text('title'),
  position: integer('position').notNull(),
  povEntityId: text('pov_entity_id').references(() => entity.id),
  povLegId: text('pov_leg_id').references(() => entityLeg.id),
  narrationPerson: text('narration_person', {
    enum: ['first', 'second', 'third_limited', 'third_omniscient'],
  }),
  narrationTense: text('narration_tense', { enum: ['past', 'present', 'future'] }),
  /** Which realm the scene is set in: waking life, the dream, the simulation. */
  realmId: text('realm_id').references(() => realm.id),
  summary: text('summary'),
}, (t) => ({
  byChapter: index('scene_chapter_idx').on(t.chapterId, t.branchId, t.position),
}));

/**
 * The prose.
 *
 * Stored as ProseMirror JSON, with a Markdown rendering kept alongside for
 * export and for search. Snapshots are separate rows so an earlier draft of a
 * scene stays readable after a rewrite.
 */
export const sceneText = sqliteTable('scene_text', {
  id: pk(),
  sceneId: text('scene_id').notNull().references(() => scene.id),
  branchId: branchId(),
  originId: originId(),
  doc: text('doc', { mode: 'json' }).notNull(),
  markdown: text('markdown'),
  wordCount: integer('word_count'),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
  label: text('label'),
  createdAt: createdAt(),
}, (t) => ({
  bySceneCurrent: index('scene_text_scene_idx').on(t.sceneId, t.branchId, t.isCurrent),
}));

/**
 * Which events a scene tells, and how.
 *
 * Many-to-many on purpose: one happening told twice from two points of view is
 * two rows, and a scene that covers a week of events is several. This table and
 * `reveal` are where the two axes actually meet.
 */
export const sceneEvent = sqliteTable('scene_event', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  sceneId: text('scene_id').notNull().references(() => scene.id),
  eventId: text('event_id').notNull().references(() => event.id),
  mode: text('mode', { enum: ['dramatised', 'mentioned', 'implied'] }).notNull(),
  note: text('note'),
}, (t) => ({
  byScene: index('scene_event_scene_idx').on(t.sceneId, t.branchId),
  byEvent: index('scene_event_event_idx').on(t.eventId, t.branchId),
  uniquePair: unique('scene_event_unique').on(t.sceneId, t.eventId, t.branchId),
}));

/**
 * When the *reader* learns something -- kept strictly apart from when a
 * character learns it. The gap between the two is dramatic irony, and the order
 * of these rows against chapter order is what makes a twist land or misfire.
 *
 * A reveal may release a single slot: the victim in chapter 2, the culprit in
 * chapter 30, one fact and two reveals.
 */
export const reveal = sqliteTable('reveal', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  factId: text('fact_id').notNull().references(() => fact.id),
  sceneId: text('scene_id').notNull().references(() => scene.id),
  /** Null means the whole fact is released here. */
  slotId: text('slot_id'),
  /** A first hint is not the same as the disclosure. */
  strength: text('strength', {
    enum: ['hinted', 'implied', 'stated', 'confirmed'],
  }).notNull().default('stated'),
  note: text('note'),
}, (t) => ({
  byScene: index('reveal_scene_idx').on(t.sceneId, t.branchId),
  byFact: index('reveal_fact_idx').on(t.factId, t.branchId),
}));

/**
 * A stretch of prose tied to what it expresses.
 *
 * Anchored by a ProseMirror mark id, never a character offset -- offsets do not
 * survive editing, and an anchor that drifts is worse than no anchor. This is
 * what keeps the bible a by-product of writing instead of a second ledger.
 */
export const textAnchor = sqliteTable('text_anchor', {
  id: pk(),
  branchId: branchId(),
  originId: originId(),
  sceneId: text('scene_id').notNull().references(() => scene.id),
  markId: text('mark_id').notNull(),
  targetKind: text('target_kind', {
    enum: ['event', 'fact', 'reveal', 'belief', 'beat', 'entity', 'identity', 'scene', 'thread'],
  }).notNull(),
  targetId: text('target_id').notNull(),
  /** A reference can name someone without placing them in the scene. */
  use: text('use', { enum: ['depicted', 'mentioned', 'held', 'state'] }).notNull().default('mentioned'),
  relatedEntityId: text('related_entity_id').references(() => entity.id),
  stateCategory: text('state_category'),
  stateValue: text('state_value'),
  /** Cached copy of the anchored text, for lists. Not the source of truth. */
  excerpt: text('excerpt'),
}, (t) => ({
  byScene: index('text_anchor_scene_idx').on(t.sceneId, t.branchId),
  byTarget: index('text_anchor_target_idx').on(t.targetKind, t.targetId, t.branchId),
}));

/**
 * A plot line, and the beats that carry it. Dangling setups are a finding.
 *
 * Two different questions, and they used to be one column. `workId` is the
 * volume the thread *begins* in, and it is always set, because a thread is
 * always begun somewhere. `scope` is how far it *reaches*: this book alone,
 * the whole series the book belongs to, or the world.
 *
 * The distinction is the point of phase eleven. A promise made in volume one
 * and kept in volume two is one thread, not two halves that nothing joins --
 * and until it could be written that way, the dangling-setup rule had no way
 * to tell a promise kept from one still owed.
 *
 * Everything that asks what a thread covers asks `scope`. `workId` answers the
 * other question: where it started.
 */
export const thread = sqliteTable('thread', {
  id: pk(),
  workId: text('work_id').notNull().references(() => work.id),
  branchId: branchId(),
  originId: originId(),
  name: text('name').notNull(),
  summary: text('summary'),
  scope: text('scope', { enum: ['work', 'series', 'world'] }).notNull().default('work'),
});

export const beat = sqliteTable('beat', {
  id: pk(),
  threadId: text('thread_id').notNull().references(() => thread.id),
  branchId: branchId(),
  originId: originId(),
  sceneId: text('scene_id').references(() => scene.id),
  kind: text('kind', { enum: ['setup', 'complication', 'payoff'] }).notNull(),
  summary: text('summary'),
  position: integer('position'),
}, (t) => ({
  byThread: index('beat_thread_idx').on(t.threadId, t.branchId),
}));
