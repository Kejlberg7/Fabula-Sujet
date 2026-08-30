import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openStore } from '../db/client';
import { inTurn } from '../core/changelog';
import { twistReadings } from '../core/queries/dramaturgy';
import { whatReaderKnows } from '../core/queries/reader';
import { createFact } from '../core/services/knowledge';
import { createChapter, createReveal, createScene } from '../core/services/narrative';
import { createSeries, createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { loadHavnen } from '../fixtures';
import { makeWorld } from './helpers';

const actor = { kind: 'user' as const };

/**
 * En serie er ikke bare flere bøger i den samme verden.
 *
 * Læseren af bog to har læst bog et, og det ændrer alt, hvad panelet og Grebet
 * kan sige. Uden det ser hver efterfølger ud, som om den afslører noget,
 * læseren har vidst i halvandet bind — og den mest almindelige figur i en saga,
 * en læser der ved mere end barnebarnet, ville blive kaldt et twist.
 */
describe('Serier — læseren tager bog et med sig', () => {
  const store = openStore(':memory:');
  const { worldId, firstWorkId, secondWorkId } = loadHavnen(store);
  const bench = new Workbench(store);

  const readerAt = (workId: string, through: number) => {
    const ctx = bench.setActive({ worldId, workId });
    return whatReaderKnows(store, ctx, { workId, throughChapterPosition: through });
  };

  it('starter forfra i bog et', () => {
    assert.equal(readerAt(firstWorkId, 0).length, 0, 'der er ikke noget før første kapitel');
  });

  it('bærer alt fra bog et med ind i bog to', () => {
    const carried = readerAt(secondWorkId, 0);
    assert.ok(carried.length >= 2, `fik ${carried.length}`);
    assert.ok(carried.every((f) => f.fromEarlierWork === 'Saltet'),
      'og det skal fremgå, hvilken bog de kommer fra');
  });

  it('kalder det ikke en afsløring, når læseren allerede havde det', () => {
    const ctx = bench.setActive({ worldId, workId: secondWorkId });
    const scuttling = twistReadings(store, ctx, { workId: secondWorkId })
      .find((r) => r.summary.includes('Marie Krag'))!;
    assert.equal(scuttling.carriedIn, 'Saltet');
    assert.match(scuttling.shape, /har det med fra/);
    // Retfærdighed og efterrationalisering giver ingen mening om noget, læseren
    // vidste, før bogen begyndte, så de skal tie.
    assert.equal(scuttling.readings.find((r) => r.axis === 'retfaerdighed'), undefined);
    assert.equal(scuttling.readings.find((r) => r.axis === 'efterrationalisering'), undefined);
  });

  it('læser den samme afsløring som et rigtigt twist i bog et', () => {
    const ctx = bench.setActive({ worldId, workId: firstWorkId });
    const scuttling = twistReadings(store, ctx, { workId: firstWorkId })
      .find((r) => r.summary.includes('Marie Krag'))!;
    assert.equal(scuttling.carriedIn, null);
    assert.ok(scuttling.readings.some((r) => r.axis === 'retfaerdighed'));
  });
});

describe('Serier — to serier i den samme verden holdes adskilt', () => {
  it('lader den ene series afsløringer være den anden uvedkommende', () => {
    const world = makeWorld();
    const bench = new Workbench(world.store);
    let ctx = bench.setActive({ worldId: world.worldId, userId: world.userId });
    let sagaTwo = '';
    let otherOne = '';

    inTurn(world.store, { branchId: ctx.branchId, actor, summary: 'To serier' }, (s) => {
      const saga = createSeries(s, ctx, { name: 'Sagaen' });
      const other = createSeries(s, ctx, { name: 'Den anden' });

      const shared = createFact(s, ctx, {
        predicate: 'hemmelighed', summary: 'Nogen brændte huset', realmId: world.realmId, slots: [],
      });

      // Bog et i «Sagaen» afslører det.
      const sagaOne = createWork(s, ctx, { title: 'Sagaen I', seriesId: saga, position: 1 });
      const ch1 = createChapter(s, ctx, world.store, { workId: sagaOne, title: 'Et' });
      const sc1 = createScene(s, ctx, world.store, { chapterId: ch1, title: 'Branden' });
      createReveal(s, ctx, { factId: shared.factId, sceneId: sc1, strength: 'confirmed' });

      sagaTwo = createWork(s, ctx, { title: 'Sagaen II', seriesId: saga, position: 2 });
      createChapter(s, ctx, world.store, { workId: sagaTwo, title: 'Senere' });

      // En helt anden serie i den samme verden, et andet sted og en anden tid.
      otherOne = createWork(s, ctx, { title: 'Den anden I', seriesId: other, position: 1 });
      createChapter(s, ctx, world.store, { workId: otherOne, title: 'Et' });
    });

    ctx = bench.setActive({ worldId: world.worldId, workId: sagaTwo, branchId: ctx.branchId });
    assert.equal(
      whatReaderKnows(world.store, ctx, { workId: sagaTwo, throughChapterPosition: 0 }).length, 1,
      'bog to i den samme serie arver bog et',
    );

    ctx = bench.setActive({ worldId: world.worldId, workId: otherOne, branchId: ctx.branchId });
    assert.equal(
      whatReaderKnows(world.store, ctx, { workId: otherOne, throughChapterPosition: 0 }).length, 0,
      'en anden serie i den samme verden arver ingenting — det er derfor serien er en række',
    );
  });
});

describe('Tilstande lukker sig selv', () => {
  it('afslutter den åbne tilstand, når en ny i samme kategori begynder', () => {
    const store = openStore(':memory:');
    const { worldId } = loadHavnen(store);
    const ctx = new Workbench(store).setActive({ worldId });
    const rows = store.sqlite.prepare(
      `select s.value, s.from_time, s.to_time from entity_state s
       join entity e on e.id = s.entity_id
       where e.name = 'Mads Krag' and s.category = 'liv' and s.branch_id = ?
       order by s.from_time`,
    ).all(ctx.branchId) as { value: string; from_time: number; to_time: number | null }[];

    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.value, 'i live');
    assert.equal(rows[1]!.value, 'død');
    assert.equal(rows[0]!.to_time, rows[1]!.from_time,
      'den tidligere tilstand skal slutte, hvor den næste begynder');
  });
});
