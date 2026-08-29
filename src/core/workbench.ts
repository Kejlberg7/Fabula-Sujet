import { eq } from 'drizzle-orm';
import type { Store } from '../db/client';
import { appState, branch, world } from '../db/schema';
import { Session, type Actor, type TurnOptions } from './changelog';

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
    const branchId = next.branchId ?? current?.branchId ?? this.defaultBranchOf(next.worldId);
    const row = {
      id: 'singleton',
      activeWorldId: next.worldId,
      activeWorkId: next.workId ?? (next.worldId === current?.worldId ? current?.workId ?? null : null),
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
    const chosen = rows.find((b) => b.isDefault) ?? rows[0];
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
      return work(session, ctx);
    } finally {
      session.end();
    }
  }
}
