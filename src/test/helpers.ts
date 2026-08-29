import { openStore, type Store } from '../db/client';
import { newId } from '../core/ids';
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
  db.insert(realm).values({
    id: realmId, worldId, branchId, name: 'Virkeligheden', kind: 'reality',
    timeSystemId, timeRatioNum: 1, timeRatioDen: 1, createdAt: new Date(),
  }).run();

  return { store, worldId, branchId, userId, realmId, timeSystemId };
}
