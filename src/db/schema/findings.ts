import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { branchId, createdAt, pk } from './_shared';

/**
 * Something the consistency engine believes is wrong.
 *
 * `rule_code` matches the codes in docs/ORDBOG.md and the ones a `law` may lift.
 * A finding is produced only after the law layer has been asked whether an
 * exception applies -- the engine never reports something an ability allows.
 */
export const finding = sqliteTable('finding', {
  id: pk(),
  branchId: branchId(),
  ruleCode: text('rule_code').notNull(),
  severity: text('severity', { enum: ['error', 'warning', 'note'] }).notNull(),
  /**
   * Stable across re-runs: the same problem keeps the same key, so a dismissal
   * sticks and a fixed problem genuinely disappears instead of coming back with
   * a new id.
   */
  fingerprint: text('fingerprint').notNull(),
  message: text('message').notNull(),
  /** The rows the finding is about, for the "jump to it" link. */
  subjects: text('subjects', { mode: 'json' }).notNull(),
  /**
   * Deliberately not `createdAt()`: that helper always names its column
   * `created_at`, and a finding's first sighting is not its creation -- the row
   * is rewritten every run. Spelling the column out keeps the field name and
   * the column name the same, which matters because this table is written with
   * raw SQL rather than through the query builder.
   */
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  byBranch: index('finding_branch_idx').on(t.branchId, t.ruleCode),
  uniqueFingerprint: unique('finding_fingerprint_unique').on(t.branchId, t.fingerprint),
}));

/**
 * "Yes, he was there -- but he lies about it later, that is the point."
 *
 * Dismissals are permanent and carry a reason, and they key on the fingerprint
 * rather than the finding row, so they survive a re-run. An engine without this
 * valve gets switched off within a week, and then the whole investment is wasted.
 */
export const dismissal = sqliteTable('dismissal', {
  id: pk(),
  branchId: branchId(),
  fingerprint: text('fingerprint').notNull(),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
  /** Dismissals can be taken back; the finding then reappears on the next run. */
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  uniqueFingerprint: unique('dismissal_fingerprint_unique').on(t.branchId, t.fingerprint),
}));

/**
 * One pass of the manuscript review, bound to the prose it actually read.
 *
 * A read-through is only worth keeping if you can tell later what it looked at.
 * A note about a paragraph that has since been rewritten is not wrong -- it is
 * stale, which is a different thing and has to look different. So the run
 * records the exact `scene_text` version of every scene in its scope, and every
 * note carries the version it was written against.
 *
 * The scope is scene, chapter, work or series. A series is included because a
 * saga's second volume is reviewed against what the reader brought with them
 * from the first, and that cannot be seen one book at a time.
 */
export const reviewRun = sqliteTable('review_run', {
  id: pk(),
  branchId: branchId(),
  scopeKind: text('scope_kind', {
    enum: ['scene', 'chapter', 'work', 'series'],
  }).notNull(),
  scopeId: text('scope_id').notNull(),
  /** What the scope was called when it was read. Titles change; this does not. */
  scopeLabel: text('scope_label').notNull(),
  createdAt: createdAt(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  /** What the reviewer said when they closed it. */
  summary: text('summary'),
}, (t) => ({
  byBranch: index('review_run_branch_idx').on(t.branchId, t.createdAt),
}));

/**
 * One scene as one run found it.
 *
 * `text_id` is the whole point: it pins the run to a version rather than to a
 * scene. Null means the scene had no prose yet, which is worth recording --
 * a read-through that skipped a scene and one that found it empty are not the
 * same report.
 */
export const reviewScene = sqliteTable('review_scene', {
  id: pk(),
  branchId: branchId(),
  runId: text('run_id').notNull().references(() => reviewRun.id),
  sceneId: text('scene_id').notNull(),
  textId: text('text_id'),
  /** Reading order within the run, so a report can be read as one pass. */
  position: integer('position').notNull(),
}, (t) => ({
  byRun: index('review_scene_run_idx').on(t.runId, t.position),
  uniqueScene: unique('review_scene_unique').on(t.runId, t.sceneId),
}));

/**
 * A suggestion from the manuscript review -- a continuity remark, or an idea for
 * what would serve the reader better given what the reader already knows.
 *
 * Never applied on its own. The review comments in the margin and may propose a
 * wording; it writes nothing into the prose until it is accepted. The bible is
 * data and Claude works freely in it; the prose is the writer's.
 */
export const suggestion = sqliteTable('suggestion', {
  id: pk(),
  branchId: branchId(),
  sceneId: text('scene_id').notNull(),
  markId: text('mark_id'),
  kind: text('kind', { enum: ['continuity', 'craft', 'pacing', 'research'] }).notNull(),
  message: text('message').notNull(),
  /** The concrete wording offered, if any. Inert until accepted. */
  proposedText: text('proposed_text'),
  sourceId: text('source_id'),
  /** The read-through that wrote the note, when it came from one. */
  runId: text('run_id'),
  /**
   * The prose version the note was written about.
   *
   * When the scene is saved again the note is stale: still readable, still the
   * writer's to keep or drop, but no longer about what stands there now. It is
   * never cleared and never re-pointed -- a note that quietly became current
   * again would be a note about words nobody read.
   */
  textId: text('text_id'),
  status: text('status', {
    enum: ['open', 'accepted', 'rejected'],
  }).notNull().default('open'),
  createdAt: createdAt(),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  /**
   * When the proposed wording was written into the manuscript -- and it is only
   * ever set by the writer clicking it in, in the editor, where they can see
   * what changed and undo it. Nothing on the MCP side can set it.
   */
  appliedAt: integer('applied_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  byScene: index('suggestion_scene_idx').on(t.sceneId, t.branchId, t.status),
}));
