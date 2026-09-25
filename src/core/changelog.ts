import { and, desc, eq, exists, getTableName, gt, isNull, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db, Store } from '../db/client';
import { change, checkpoint, turn } from '../db/schema';
import { newId } from './ids';
import { indexMissingReferences } from './services/references';
import { tableByName } from './tables';

/**
 * The only thing that writes.
 *
 * Every mutation becomes a change with an opposite: not "save the new state" but
 * "added participant X to event E, and the opposite is to remove it again".
 * Undo, redo, the history screen, roll-back-to-here and branch-from-here all
 * come out of this one table, and so does multi-user later.
 *
 * Nothing outside this module may insert, update or delete a content row. If a
 * write does not pass through here it is invisible to history, which is worse
 * than it not happening.
 */

export interface Actor {
  kind: 'user' | 'assistant' | 'system';
  userId?: string;
}

export interface TurnOptions {
  branchId: string;
  actor: Actor;
  /** One line for the history screen. */
  summary?: string;
  /** The writer's own words, when the turn arrived through MCP. */
  prompt?: string;
}

type Row = Record<string, unknown>;
/** A row as the driver holds it: numbers, strings, nulls -- never a Date. */
export type RawRow = Record<string, unknown>;

function idColumn(table: SQLiteTable) {
  const col = (table as unknown as Record<string, unknown>)['id'];
  if (!col) throw new Error('Table has no id column');
  return col as never;
}

/**
 * The log records what the database holds, not what the mapper produced.
 *
 * Reading through Drizzle gives Date objects and parsed JSON; those do not
 * survive a round trip through the log's own JSON columns, and putting them back
 * fails. Capture and restore therefore go past the mapper and touch raw column
 * values, which is also the honest description of what an undo is.
 */
function rawRow(sqlite: Store['sqlite'], tableName: string, id: string): RawRow | undefined {
  return sqlite.prepare(`select * from "${tableName}" where id = ?`).get(id) as RawRow | undefined;
}

function rawInsert(sqlite: Store['sqlite'], tableName: string, row: RawRow): void {
  const cols = Object.keys(row);
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const holes = cols.map(() => '?').join(', ');
  sqlite.prepare(`insert into "${tableName}" (${quoted}) values (${holes})`)
    .run(...cols.map((c) => row[c] as never));
}

function rawReplace(sqlite: Store['sqlite'], tableName: string, id: string, row: RawRow): void {
  const cols = Object.keys(row).filter((c) => c !== 'id');
  const assignments = cols.map((c) => `"${c}" = ?`).join(', ');
  sqlite.prepare(`update "${tableName}" set ${assignments} where id = ?`)
    .run(...cols.map((c) => row[c] as never), id);
}

function rawDelete(sqlite: Store['sqlite'], tableName: string, id: string): void {
  sqlite.prepare(`delete from "${tableName}" where id = ?`).run(id);
}

function nextSeq(db: Db): number {
  const row = db.select({ max: sql<number | null>`max(${change.seq})` }).from(change).get();
  return (row?.max ?? 0) + 1;
}

/**
 * One turn of work: a conversational exchange, or one interaction in the UI.
 *
 * Changes are grouped by turn so that "undo that last thing you did" undoes one
 * coherent thing rather than forty rows. That grouping is what lets the MCP
 * surface run without an approval prompt in front of it: we traded a gate for a
 * mirror, and the mirror only works if it shows whole actions.
 */
export class Session {
  readonly id: string;
  readonly branchId: string;
  private readonly db: Db;
  private touched = 0;
  private closed = false;

  private constructor(private readonly store: Store, id: string, branchId: string) {
    this.db = store.db;
    this.id = id;
    this.branchId = branchId;
  }

  static begin(store: Store, options: TurnOptions): Session {
    const { db } = store;
    const id = newId();
    db.insert(turn).values({
      id,
      branchId: options.branchId,
      actorKind: options.actor.kind,
      actorUserId: options.actor.userId ?? null,
      kind: 'edit',
      summary: options.summary ?? null,
      prompt: options.prompt ?? null,
      startedAt: new Date(),
    }).run();
    return new Session(store, id, options.branchId);
  }

  /** How many rows this turn has touched, for the "I changed 43 things" receipt. */
  get changeCount(): number {
    return this.touched;
  }

  insert<T extends SQLiteTable>(table: T, values: Row): Row {
    this.assertOpen();
    const name = getTableName(table);
    const id = (values['id'] as string | undefined) ?? newId();
    return this.db.transaction((tx) => {
      tx.insert(table).values({ ...values, id } as never).run();
      const written = rawRow(this.store.sqlite, name, id)!;
      this.record(tx as unknown as Db, 'insert', name, id, null, written);
      return { ...written, id };
    });
  }

  /**
   * Copies a driver-shaped row while still recording an ordinary insertion.
   *
   * Branching reconstructs an older snapshot from the change log. Those rows
   * use SQLite column names (`branch_id`, not `branchId`) and deliberately stay
   * raw: converting dates and JSON through the mapper would make the copy less
   * faithful than undo. This is the one sanctioned path from a historical raw
   * row back into the database, and it remains fully visible and reversible.
   */
  insertRaw<T extends SQLiteTable>(table: T, row: RawRow): RawRow {
    this.assertOpen();
    const name = getTableName(table);
    tableByName(name);
    const id = row['id'];
    if (typeof id !== 'string' || !id) throw new Error('Raw row has no id');
    return this.db.transaction((tx) => {
      rawInsert(this.store.sqlite, name, row);
      const written = rawRow(this.store.sqlite, name, id)!;
      this.record(tx as unknown as Db, 'insert', name, id, null, written);
      return written;
    });
  }

  update<T extends SQLiteTable>(table: T, id: string, patch: Row): Row {
    this.assertOpen();
    const name = getTableName(table);
    return this.db.transaction((tx) => {
      const before = rawRow(this.store.sqlite, name, id);
      if (!before) throw new Error(`Cannot update missing row ${id}`);
      tx.update(table).set(patch as never).where(eq(idColumn(table), id)).run();
      const after = rawRow(this.store.sqlite, name, id)!;
      this.record(tx as unknown as Db, 'update', name, id, before, after);
      return after;
    });
  }

  /**
   * Replaces a row from its driver-shaped representation while still recording
   * an ordinary update. Branch transfer uses this for tables selected at run
   * time: the comparison already speaks SQLite column names, and translating
   * those names back through dozens of table-specific mappers would make the
   * copy less exact than undo itself.
   */
  replaceRaw<T extends SQLiteTable>(table: T, id: string, row: RawRow): RawRow {
    this.assertOpen();
    const name = getTableName(table);
    tableByName(name);
    return this.db.transaction((tx) => {
      const before = rawRow(this.store.sqlite, name, id);
      if (!before) throw new Error(`Cannot update missing row ${id}`);
      rawReplace(this.store.sqlite, name, id, { ...row, id });
      const after = rawRow(this.store.sqlite, name, id)!;
      this.record(tx as unknown as Db, 'update', name, id, before, after);
      return after;
    });
  }

  remove<T extends SQLiteTable>(table: T, id: string): void {
    this.assertOpen();
    const name = getTableName(table);
    this.db.transaction((tx) => {
      const before = rawRow(this.store.sqlite, name, id);
      if (!before) return;
      tx.delete(table).where(eq(idColumn(table), id)).run();
      this.record(tx as unknown as Db, 'delete', name, id, before, null);
    });
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.update(turn).set({ endedAt: new Date() }).where(eq(turn.id, this.id)).run();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Session already ended');
  }

  private record(
    db: Db,
    op: 'insert' | 'update' | 'delete',
    tableName: string,
    rowId: string,
    before: RawRow | null,
    after: RawRow | null,
  ): void {
    db.insert(change).values({
      id: newId(),
      seq: nextSeq(db),
      branchId: this.branchId,
      turnId: this.id,
      op,
      tableName,
      rowId,
      before: before ?? null,
      after: after ?? null,
      createdAt: new Date(),
    }).run();
    this.touched += 1;
  }
}

/** Runs `work` inside a turn and closes it, even when the work throws. */
export function inTurn<T>(store: Store, options: TurnOptions, work: (session: Session) => T): T {
  const session = Session.begin(store, options);
  try {
    const value = work(session);
    indexMissingReferences(session, store, options.branchId);
    return value;
  } finally {
    session.end();
  }
}

/**
 * Reverses one turn.
 *
 * The undo is itself a turn, marked as such, so redo is nothing more than
 * undoing the undo -- and rolling back is reversible for the same reason.
 * Foreign keys are deferred inside the transaction so that re-inserting a
 * parent and its children in log order does not trip over itself; they are
 * still checked at commit.
 */
export function undoTurn(store: Store, turnId: string, actor: Actor): string {
  const { db, sqlite } = store;
  const original = db.select().from(turn).where(eq(turn.id, turnId)).get();
  if (!original) throw new Error(`No such turn: ${turnId}`);
  if (original.undoneAt) throw new Error('Turn is already undone');

  const changes = db.select().from(change)
    .where(and(eq(change.turnId, turnId), isNull(change.undoneAt)))
    .orderBy(desc(change.seq)).all();

  const undoId = newId();
  db.transaction((tx) => {
    tx.run(sql`pragma defer_foreign_keys = on`);
    tx.insert(turn).values({
      id: undoId,
      branchId: original.branchId,
      actorKind: actor.kind,
      actorUserId: actor.userId ?? null,
      kind: 'undo',
      undoesTurnId: turnId,
      summary: `Fortryd: ${original.summary ?? turnId}`,
      startedAt: new Date(),
      endedAt: new Date(),
    }).run();

    let seq = nextSeq(tx as unknown as Db);
    for (const c of changes) {
      tableByName(c.tableName); // fails loudly on a table the schema no longer has
      const before = c.before as Row | null;
      const after = c.after as Row | null;

      if (c.op === 'insert') {
        rawDelete(sqlite, c.tableName, c.rowId);
      } else if (c.op === 'delete') {
        rawInsert(sqlite, c.tableName, before as RawRow);
      } else {
        rawReplace(sqlite, c.tableName, c.rowId, before as RawRow);
      }

      tx.update(change).set({ undoneAt: new Date() }).where(eq(change.id, c.id)).run();
      tx.insert(change).values({
        id: newId(),
        seq: seq++,
        branchId: original.branchId,
        turnId: undoId,
        op: c.op === 'insert' ? 'delete' : c.op === 'delete' ? 'insert' : 'update',
        tableName: c.tableName,
        rowId: c.rowId,
        before: after ?? null,
        after: before ?? null,
        createdAt: new Date(),
      }).run();
    }

    tx.update(turn).set({ undoneAt: new Date() }).where(eq(turn.id, turnId)).run();
  });

  return undoId;
}

/** Undoes the newest turn that has not been undone. Returns null when there is none. */
export function undoLast(store: Store, branchId: string, actor: Actor): string | null {
  const { db } = store;
  /**
   * Spring ture over, der ikke ændrede noget.
   *
   * Flere skrivninger er tomme, når der intet var at gøre -- oprydningen af
   * forladte tekstankre er den almindelige. En sådan tur ville sluge et klik på
   * Fortryd: brugeren beder om at få det sidste tilbage og får at vide, at det
   * er fortrudt, uden at noget som helst skiftede.
   */
  const last = db.select().from(turn)
    .where(and(
      eq(turn.branchId, branchId), isNull(turn.undoneAt), eq(turn.kind, 'edit'),
      exists(db.select({ one: sql`1` }).from(change).where(eq(change.turnId, turn.id))),
    ))
    .orderBy(desc(turn.startedAt)).limit(1).get();
  if (!last) return null;
  return undoTurn(store, last.id, actor);
}

/** Redo is undoing the most recent undo. */
export function redoLast(store: Store, branchId: string, actor: Actor): string | null {
  const { db } = store;
  const lastUndo = db.select().from(turn)
    .where(and(eq(turn.branchId, branchId), eq(turn.kind, 'undo'), isNull(turn.undoneAt)))
    .orderBy(desc(turn.startedAt)).limit(1).get();
  if (!lastUndo) return null;
  return undoTurn(store, lastUndo.id, actor);
}

/**
 * "This is how it was before I rewrote chapter five."
 *
 * Undoes every turn that touched anything after `seq`, newest first. Taking a
 * branch from the same point is the same act with the old road left standing.
 */
export function rollbackTo(store: Store, branchId: string, seq: number, actor: Actor): number {
  const { db } = store;
  const affected = db.selectDistinct({ turnId: change.turnId }).from(change)
    .where(and(eq(change.branchId, branchId), gt(change.seq, seq), isNull(change.undoneAt)))
    .all();
  const turns = affected
    .map((a) => db.select().from(turn).where(eq(turn.id, a.turnId)).get()!)
    .filter((t) => !t.undoneAt)
    .sort((a, b) => Number(b.startedAt) - Number(a.startedAt));
  for (const t of turns) undoTurn(store, t.id, actor);
  return turns.length;
}

export function markCheckpoint(db: Db, branchId: string, label: string, note?: string): string {
  const id = newId();
  const row = db.select({ max: sql<number | null>`max(${change.seq})` }).from(change).get();
  db.insert(checkpoint).values({
    id, branchId, changeSeq: row?.max ?? 0, label, note: note ?? null, createdAt: new Date(),
  }).run();
  return id;
}

export interface HistoryEntry {
  turnId: string;
  actorKind: string;
  kind: string;
  summary: string | null;
  startedAt: Date;
  undone: boolean;
  changeCount: number;
  lastSeq: number;
}

/** What happened, when, and by whom -- the history screen's data. */
export function history(db: Db, branchId: string, limit = 50): HistoryEntry[] {
  const turns = db.select().from(turn)
    .where(eq(turn.branchId, branchId))
    .orderBy(desc(turn.startedAt)).limit(limit).all();
  return turns.map((t) => {
    const stats = db.select({
      count: sql<number>`count(*)`,
      lastSeq: sql<number | null>`max(${change.seq})`,
    }).from(change).where(eq(change.turnId, t.id)).get();
    return {
      turnId: t.id,
      actorKind: t.actorKind,
      kind: t.kind,
      summary: t.summary,
      startedAt: t.startedAt,
      undone: t.undoneAt != null,
      changeCount: stats?.count ?? 0,
      lastSeq: stats?.lastSeq ?? 0,
    };
  });
}
