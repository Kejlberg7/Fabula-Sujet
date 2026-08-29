import { integer, text } from 'drizzle-orm/sqlite-core';

/**
 * Shared column builders.
 *
 * Naming rule for this codebase: identifiers are English, the user-facing
 * surface (UI labels, MCP tool names and arguments) is Danish. The mapping
 * between the two lives in docs/ORDBOG.md and is the single source of truth
 * for it -- never invent a translation at the call site.
 */

export const pk = () => text('id').primaryKey();

/** Wall-clock time of the writer, not story time. */
export const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' }).notNull();

/**
 * Story time: a whole number of base units in the time system the owning realm
 * uses (seconds for the Gregorian system). Never a JS Date -- story time may sit
 * outside the range of a Date, run at a different rate, or use another calendar
 * entirely. Nullable everywhere: an unplaced event is a normal state, not an error.
 */
export const instant = (name: string) => integer(name);

/** A whole number of base units of elapsed time. */
export const span = (name: string) => integer(name);

export const PRECISION = [
  'minute',
  'hour',
  'day',
  'month',
  'year',
  'unknown',
] as const;

/**
 * Every content row carries the branch it belongs to.
 *
 * Only narrative rows are allowed to diverge for now; the column sits on world
 * rows too, so widening that later is a change to one filter rather than a
 * migration. Branching copies the divergeable rows into the new branch and
 * records where each copy came from in `origin_id`, so reading a branch stays a
 * plain `where branch_id = ?` instead of a replay of the log.
 *
 * Deliberately not a declared foreign key: `branch` lives in narrative.ts, which
 * imports this module, and a real reference here would make the cycle load-order
 * dependent. Branch integrity is enforced in the domain layer, which is the only
 * thing that writes.
 */
export const branchId = () => text('branch_id').notNull();

/** The row this one was copied from when a branch was created. */
export const originId = () => text('origin_id');
