import { eq } from 'drizzle-orm';
import type { Store } from '../db/client';
import { appState, branch, work, world } from '../db/schema';
import { Session, type Actor, type TurnOptions } from './changelog';
import { workInBranch } from './branches';
import { indexMissingReferences } from './services/references';

/**
 * What we are working on.
 *
 * Set the active work once and the rest of the conversation can leave it out.
 * That is not a convenience: having to name the book in every sentence is the
 * difference between dictating a story comfortably and giving up on it.
 */
export interface Context {
  worldId: string;
  workId: string | null;
  branchId: string;
  userId: string | null;
}

export class Workbench {
  constructor(readonly store: Store) {}

  get db() {
    return this.store.db;
  }

  /** Throws when nothing is selected -- a tool should say so, not guess. */
  context(): Context {
    const state = this.db.select().from(appState).where(eq(appState.id, 'singleton')).get();
    if (!state?.activeWorldId || !state.activeBranchId) {
      throw new Error(
        'Der er ikke valgt en verden endnu. Brug saet_aktivt_vaerk, eller opret en verden først.',
      );
    }
    return {
      worldId: state.activeWorldId,
      workId: state.activeWorkId,
      branchId: state.activeBranchId,
      userId: state.activeUserId,
    };
  }

  peek(): Context | null {
    try {
      return this.context();
    } catch {
      return null;
    }
  }

  /**
   * Selecting is not an edit, so it does not go through the change log --
   * rolling back to Tuesday should not also move you to a different book.
   */
  setActive(next: Partial<Context> & { worldId: string }): Context {
    const current = this.peek();
    const sameWorld = current?.worldId === next.worldId;
    // Carrying the old branch into a new world silently mixes the two: rows
    // filter by branch, so a Memento branch inside the Predestination world
    // finds Memento's places and none of Predestination's realms. Every world
    // has its own branches, and switching world must land on one of them.
    const branchId = next.branchId
      ?? (sameWorld ? current?.branchId : undefined)
      ?? this.defaultBranchOf(next.worldId);
    // Switching world drops the book, which is right when there is a choice to
    // make -- but a world holding exactly one book has no ambiguity to protect,
    // and making someone pick it anyway defeats setting the context at all.
    const sameBranch = sameWorld && current?.branchId === branchId;
    let workId = next.workId
      ?? (sameBranch
        ? current?.workId ?? null
        : current?.workId ? workInBranch(this.store, current.workId, branchId) : null);
    if (workId) {
      const selected = this.db.select().from(work).where(eq(work.id, workId)).get();
      if (!selected || selected.branchId !== branchId || selected.worldId !== next.worldId) workId = null;
    }
    if (!workId) {
      const inWorld = this.db.select().from(work)
        .where(eq(work.worldId, next.worldId)).all()
        .filter((w) => w.branchId === branchId);
      if (inWorld.length === 1) workId = inWorld[0]!.id;
    }

    const row = {
      id: 'singleton',
      activeWorldId: next.worldId,
      activeWorkId: workId,
      activeBranchId: branchId,
      activeUserId: next.userId ?? current?.userId ?? null,
      updatedAt: new Date(),
    };
    this.db.insert(appState).values(row)
      .onConflictDoUpdate({ target: appState.id, set: row }).run();
    return this.context();
  }

  defaultBranchOf(worldId: string): string {
    const rows = this.db.select().from(branch).where(eq(branch.worldId, worldId)).all();
    const open = rows.filter((b) => !b.archivedAt);
    const chosen = open.find((b) => b.isDefault) ?? open[0] ?? rows[0];
    if (!chosen) throw new Error('Verdenen har ingen gren. Det burde ikke kunne ske.');
    return chosen.id;
  }

  worldName(worldId: string): string {
    return this.db.select().from(world).where(eq(world.id, worldId)).get()?.name ?? '(ukendt)';
  }

  /**
   * One turn of work.
   *
   * Everything a tool call writes lands in a single turn, so undoing it is one
   * act. Each call gets its own turn rather than sharing one, because "undo
   * that" should mean the last thing that was said, not the whole session.
   */
  run<T>(
    options: { actor: Actor; summary?: string; prompt?: string },
    work: (session: Session, ctx: Context) => T,
  ): T {
    const ctx = this.context();
    const turnOptions: TurnOptions = {
      branchId: ctx.branchId,
      actor: options.actor,
      summary: options.summary,
      prompt: options.prompt,
    };
    const session = Session.begin(this.store, turnOptions);
    try {
      const value = work(session, ctx);
      indexMissingReferences(session, this.store, ctx.branchId);
      return value;
    } finally {
      session.end();
    }
  }
}
