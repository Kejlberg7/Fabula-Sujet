/**
 * Loads the three prøvecases into a database you can then talk to.
 *
 *   npm run fixtures -- ./fabula.db
 *
 * Each film presses on a different axis: Memento on narrative order and
 * knowledge that expires, Predestination on personal time, Inception on which
 * world a thing is true in.
 */
import { openStore } from '../src/db/client';
import { loadInception, loadMemento, loadPredestination } from '../src/fixtures';

const target = process.argv[2] ?? './fabula.db';
const store = openStore(target);

const memento = loadMemento(store);
const predestination = loadPredestination(store);
const inception = loadInception(store);

const count = (table: string, worldId: string) =>
  (store.sqlite.prepare(`select count(*) as n from "${table}" where world_id = ?`)
    .get(worldId) as { n: number }).n;

for (const [name, world] of [
  ['Memento', memento], ['Predestination', predestination], ['Inception', inception],
] as const) {
  console.log(
    `${name.padEnd(16)} ${count('entity', world.worldId)} entiteter, `
    + `${count('event', world.worldId)} events, ${count('fact', world.worldId)} fakta`,
  );
}

const last = store.sqlite.prepare('select count(*) as n from "change"').get() as { n: number };
console.log(`\n${last.n} ændringer i loggen. Alt kan fortrydes.`);
console.log(`Databasen ligger i ${target}. Den aktive verden er Inception.`);
store.close();
