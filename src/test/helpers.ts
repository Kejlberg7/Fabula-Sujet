import { openStore, type Store } from '../db/client';
import { newId } from '../core/ids';
import { inTurn } from '../core/changelog';
import { appUser, branch, timeSystem, world, realm } from '../db/schema';

export interface TestWorld {
  store: Store;
  worldId: string;
  branchId: string;
  userId: string;
  realmId: string;
  timeSystemId: string;
}

/** A world with a default branch, a Gregorian clock and a `reality` realm. */
export function makeWorld(name = 'Prøveverden'): TestWorld {
  const store = openStore(':memory:');
  const { db } = store;
  const worldId = newId();
  const branchId = newId();
  const userId = newId();
  const timeSystemId = newId();
  const realmId = newId();

  db.insert(appUser).values({ id: userId, name: 'Prøvebruger', createdAt: new Date() }).run();
  db.insert(world).values({ id: worldId, name, createdAt: new Date() }).run();
  db.insert(branch).values({
    id: branchId, worldId, name: 'hoved', isDefault: true, createdAt: new Date(),
  }).run();
  db.insert(timeSystem).values({
    id: timeSystemId, worldId, name: 'Gregoriansk', kind: 'gregorian',
  }).run();
  /**
   * Laget skrives gennem ændringsloggen, præcis som `createWorld` gør det.
   *
   * En prøveverden, der bygges anderledes end koden bygger den, skjuler
   * netop den slags fejl, prøverne er til for: et lag uden for loggen kan ikke
   * genskabes ved et forgreningspunkt, og så peger en ny gren på forælderens.
   */
  inTurn(store, {
    branchId, actor: { kind: 'system' }, summary: 'Opret prøveverden',
  }, (session) => {
    session.insert(realm, {
      id: realmId, worldId, branchId, name: 'Virkeligheden', kind: 'reality',
      timeSystemId, timeRatioNum: 1, timeRatioDen: 1, createdAt: new Date(),
    });
  });

  return { store, worldId, branchId, userId, realmId, timeSystemId };
}
