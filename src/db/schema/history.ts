import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { branchId, createdAt, pk } from './_shared';

/**
 * Who made a change. There is one user today; the column exists so that adding
 * more is not a rebuild of the log. It also answers the question you actually
 * ask when rolling back: was that me, or was that Claude?
 */
export const appUser = sqliteTable('app_user', {
  id: pk(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

/**
 * One turn of work: a conversational exchange, or one interaction in the UI.
 *
 * Changes are grouped by turn so that "undo that last thing you did" undoes one
 * coherent thing rather than forty rows. This grouping is the reason there is no
 * approval prompt in front of the MCP surface: we traded a gate for a mirror,
 * and the mirror only works if it shows whole actions.
 */
export const turn = sqliteTable('turn', {
  id: pk(),
  branchId: branchId(),
  actorKind: text('actor_kind', { enum: ['user', 'assistant', 'system'] }).notNull(),
  actorUserId: text('actor_user_id').references(() => appUser.id),
  /** What the turn was about, in one line, for the history screen. */
  summary: text('summary'),
  /** The user's own words, when the turn came in through MCP. */
  prompt: text('prompt'),
  startedAt: createdAt(),
  endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
  /** Set when the whole turn has been undone. */
  undoneAt: integer('undone_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  byBranch: index('turn_branch_idx').on(t.branchId, t.startedAt),
}));

/**
 * Every write, as a change with an opposite.
 *
 * Not "save the new state" but "added participant X to event E, and the
 * opposite is to remove it again". Undo, redo, the history screen, roll-back-to-
 * here and branch-from-here all come from this one table, and so does multi-user
 * later. It is the single thing in phase 0 that cannot be retrofitted.
 *
 * `seq` is monotonic per database and is what a fork point points at.
 */
export const change = sqliteTable('change', {
  id: pk(),
  seq: integer('seq').notNull(),
  branchId: branchId(),
  turnId: text('turn_id').notNull().references(() => turn.id),
  op: text('op', { enum: ['insert', 'update', 'delete', 'merge'] }).notNull(),
  tableName: text('table_name').notNull(),
  rowId: text('row_id').notNull(),
  /** Null on insert. */
  before: text('before', { mode: 'json' }),
  /** Null on delete. */
  after: text('after', { mode: 'json' }),
  createdAt: createdAt(),
  /** Set when undone. Undoing is itself a change, so this can be reversed too. */
  undoneAt: integer('undone_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  bySeq: index('change_seq_idx').on(t.branchId, t.seq),
  byRow: index('change_row_idx').on(t.tableName, t.rowId),
  byTurn: index('change_turn_idx').on(t.turnId),
}));

/**
 * A named point you can come back to: "this is how it was before I rewrote
 * chapter five". Roll back to it, or take a branch from it -- the same act,
 * one of them keeping the old road.
 */
export const checkpoint = sqliteTable('checkpoint', {
  id: pk(),
  branchId: branchId(),
  changeSeq: integer('change_seq').notNull(),
  label: text('label').notNull(),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => ({
  byBranch: index('checkpoint_branch_idx').on(t.branchId, t.changeSeq),
}));
