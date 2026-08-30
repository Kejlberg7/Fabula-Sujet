import { index, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { branchId, createdAt, originId, pk } from './_shared';
import { world } from './world';

export const REFERENCE_KINDS = [
  'entity', 'identity', 'event', 'fact', 'reveal', 'scene', 'thread',
] as const;

export type ReferenceKind = typeof REFERENCE_KINDS[number];

/**
 * A short, human address for something in the story: P1, G4, E12.
 *
 * The target is deliberately polymorphic. A foreign key could only point at
 * one table, while the whole value of this row is that the same writing gesture
 * can address a person, an object, an event or a reveal. A deleted target does
 * not cascade: the broken address must remain visible in the prose until the
 * writer repairs or removes it.
 *
 * Codes are copied unchanged into a branch. They are unique inside that branch,
 * while `origin_id` keeps the reference's own lineage visible to undo and branch
 * comparison.
 */
export const storyReference = sqliteTable('story_reference', {
  id: pk(),
  worldId: text('world_id').notNull().references(() => world.id),
  branchId: branchId(),
  originId: originId(),
  targetKind: text('target_kind', { enum: REFERENCE_KINDS }).notNull(),
  targetId: text('target_id').notNull(),
  code: text('code').notNull(),
  createdAt: createdAt(),
}, (t) => ({
  byCode: unique('story_reference_code_unique').on(t.branchId, t.code),
  byTarget: index('story_reference_target_idx').on(t.branchId, t.targetKind, t.targetId),
  byWorld: index('story_reference_world_idx').on(t.worldId, t.branchId),
}));
