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
  status: text('status', {
    enum: ['open', 'accepted', 'rejected'],
  }).notNull().default('open'),
  createdAt: createdAt(),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  byScene: index('suggestion_scene_idx').on(t.sceneId, t.branchId, t.status),
}));
