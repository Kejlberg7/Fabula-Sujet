import { eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  appUser, branch, realm, series, timeSystem, work, world,
} from '../../db/schema';
import { Session, inTurn } from '../changelog';
import { newId } from '../ids';
import type { Context } from '../workbench';

/**
 * The world's scaffolding is the one write that cannot go through a session,
 * because a session needs a branch and the branch is part of what is being
 * made. That exception covers the world, its branch, its clock and the user --
 * and nothing else. The realm below is branch content and goes through the log
 * like everything else, because it can diverge and must be copyable.
 */
export function createWorld(
  store: Store,
  input: { name: string; summary?: string; userName?: string },
): { worldId: string; branchId: string; realmId: string; timeSystemId: string; userId: string } {
  const worldId = newId();
  const branchId = newId();
  const timeSystemId = newId();
  const realmId = newId();
  const now = new Date();

  const userId = store.db.transaction((tx) => {
    let existing = tx.select().from(appUser).get()?.id;
    if (!existing) {
      existing = newId();
      tx.insert(appUser).values({ id: existing, name: input.userName ?? 'Forfatteren', createdAt: now }).run();
    }
    tx.insert(world).values({ id: worldId, name: input.name, summary: input.summary ?? null, createdAt: now }).run();
    tx.insert(branch).values({ id: branchId, worldId, name: 'hoved', isDefault: true, createdAt: now }).run();
    tx.insert(timeSystem).values({ id: timeSystemId, worldId, name: 'Gregoriansk', kind: 'gregorian' }).run();
    return existing;
  });

  /**
   * The realm goes through the change log, unlike the scaffolding above it.
   *
   * World, branch, clock and user are not branch content -- they frame it. The
   * realm *is* branch content: it carries `branch_id` and it is copied when a
   * variant is made. A row that can diverge but was never logged cannot be
   * reconstructed at a fork point, and the copy then leaves every event on the
   * new branch pointing at the parent's realm.
   */
  inTurn(store, {
    branchId,
    actor: { kind: 'system' },
    summary: `Opret verden: ${input.name}`,
  }, (session) => {
    session.insert(realm, {
      id: realmId, worldId, branchId, name: 'Virkeligheden', kind: 'reality',
      timeSystemId, timeRatioNum: 1, timeRatioDen: 1, createdAt: now,
    });
  });

  return { worldId, branchId, realmId, timeSystemId, userId };
}

export function createRealm(
  session: Session,
  ctx: Context,
  input: {
    name: string;
    kind: 'reality' | 'dream' | 'simulation' | 'story' | 'timeline' | 'other';
    parentRealmId?: string;
    /** A realm without a clock is meaningless, so this is not optional. */
    timeSystemId: string;
    /** How much faster this realm runs than its parent. 20 means twenty times. */
    timeRatio?: number;
    parentEpoch?: number;
    localEpoch?: number;
    entryEventId?: string;
    exitEventId?: string;
    summary?: string;
  },
): string {
  const row = session.insert(realm, {
    worldId: ctx.worldId,
    branchId: ctx.branchId,
    parentRealmId: input.parentRealmId ?? null,
    name: input.name,
    kind: input.kind,
    timeSystemId: input.timeSystemId,
    timeRatioNum: input.timeRatio ?? 1,
    timeRatioDen: 1,
    parentEpoch: input.parentEpoch ?? null,
    localEpoch: input.localEpoch ?? null,
    entryEventId: input.entryEventId ?? null,
    exitEventId: input.exitEventId ?? null,
    summary: input.summary ?? null,
    createdAt: new Date(),
  });
  return row['id'] as string;
}

export function rootRealmOf(store: Store, ctx: Context): string {
  const realms = store.db.select().from(realm).where(eq(realm.worldId, ctx.worldId)).all();
  const root = realms.find((r) => !r.parentRealmId) ?? realms[0];
  if (!root) throw new Error('Verdenen har intet lag. Det burde ikke kunne ske.');
  return root.id;
}

export function defaultTimeSystemOf(store: Store, ctx: Context): string {
  const row = store.db.select().from(timeSystem).where(eq(timeSystem.worldId, ctx.worldId)).get();
  if (!row) throw new Error('Verdenen har intet tidssystem.');
  return row.id;
}

export function createSeries(
  session: Session, ctx: Context, input: { name: string; summary?: string; position?: number },
): string {
  return session.insert(series, {
    worldId: ctx.worldId, name: input.name,
    summary: input.summary ?? null, position: input.position ?? null, createdAt: new Date(),
  })['id'] as string;
}

export function createWork(
  session: Session,
  ctx: Context,
  input: { title: string; seriesId?: string; summary?: string; position?: number },
): string {
  return session.insert(work, {
    worldId: ctx.worldId,
    branchId: ctx.branchId,
    seriesId: input.seriesId ?? null,
    title: input.title,
    summary: input.summary ?? null,
    position: input.position ?? null,
    createdAt: new Date(),
  })['id'] as string;
}
