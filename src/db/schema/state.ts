import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt } from './_shared';

/**
 * What we are working on right now.
 *
 * A single row. It backs the work picker in the UI and, more importantly, the
 * MCP context: once the active work is set you can talk freely without naming
 * the book in every sentence. That is the difference between dictating a story
 * comfortably and not.
 */
export const appState = sqliteTable('app_state', {
  id: text('id').primaryKey().default('singleton'),
  activeWorldId: text('active_world_id'),
  activeWorkId: text('active_work_id'),
  activeBranchId: text('active_branch_id'),
  activeUserId: text('active_user_id'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

/** Whoever is at the keyboard. One row today; the column is here for later. */
export const currentUser = sqliteTable('current_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});
