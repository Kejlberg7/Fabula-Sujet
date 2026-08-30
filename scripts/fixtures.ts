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

/**
 * Tælles pr. gren, ikke pr. verden.
 *
 * En gren er et helt øjebliksbillede af historien, så en verden med en variant
 * i har hver række to gange. «36 personer» om en historie med atten ville være
 * sandt om databasen og forkert om bogen.
 */
const mainBranchOf = (worldId: string): string =>
  (store.sqlite
    .prepare('select id from "branch" where world_id = ? order by is_default desc, created_at limit 1')
    .get(worldId) as { id: string }).id;

const count = (table: string, worldId: string, branchId: string) =>
  (store.sqlite.prepare(
    `select count(*) as n from "${table}" where world_id = ? and branch_id = ?`,
  ).get(worldId, branchId) as { n: number }).n;

const branchCount = (worldId: string) =>
  (store.sqlite.prepare('select count(*) as n from "branch" where world_id = ?')
    .get(worldId) as { n: number }).n;

for (const [name, world] of [
  ['Memento', memento], ['Predestination', predestination], ['Inception', inception],
] as const) {
  const branchId = mainBranchOf(world.worldId);
  const branches = branchCount(world.worldId);
  console.log(
    `${name.padEnd(16)} ${count('entity', world.worldId, branchId)} entiteter, `
    + `${count('event', world.worldId, branchId)} events, `
    + `${count('fact', world.worldId, branchId)} fakta`
    + (branches > 1 ? `  (+ ${branches - 1} variant)` : ''),
  );
}

const last = store.sqlite.prepare('select count(*) as n from "change"').get() as { n: number };
console.log(`\n${last.n} ændringer i loggen. Alt kan fortrydes.`);
console.log(`Databasen ligger i ${target}. Den aktive verden er Inception.`);
store.close();
