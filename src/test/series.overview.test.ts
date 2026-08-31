import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { openStore } from '../db/client';
import { chapter, scene } from '../db/schema';
import { inTurn } from '../core/changelog';
import { seriesOverview } from '../core/queries/series';
import { createBeat, createThread } from '../core/services/narrative';
import { createSeries, createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { loadHavnen } from '../fixtures';

const actor = { kind: 'user' as const };

/**
 * Fase elleve, tredje snit: serien læst som én fortælling.
 *
 * Halvdelen af prøverne handler om grænsen. En verden kan rumme flere serier,
 * og læseren af den ene har ikke læst den anden — så en oversigt, der samler
 * fra hele verden, siger noget, der ikke passer for nogen læser.
 */

describe('Serieoversigten', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  after(() => store.close());

  const view = seriesOverview(store, ctx, { seriesId: loaded.seriesId })!;

  it('lægger bindene i læserækkefølge med deres omfang', () => {
    assert.deepEqual(view.volumes.map((v) => v.title), ['Saltet', 'Tidevandet']);
    assert.ok(view.volumes.every((v) => v.scenes > 0 && v.chapters > 0));
  });

  it('nævner kun personer, der faktisk er i mere end ét bind', () => {
    assert.ok(view.people.length > 0);
    assert.ok(view.people.every((p) => p.volumes.length > 1));
    assert.ok(view.people.some((p) => p.name === 'Karen Krag'));
  });

  it('viser hvor langt hver tråd når, og hvilke bind den ligger i', () => {
    const debt = view.threads.find((t) => t.name === 'Gælden')!;
    assert.equal(debt.scope, 'series');
    assert.equal(debt.home, 'Saltet');
    assert.deepEqual(debt.volumes, ['Saltet', 'Tidevandet']);
    const ship = view.threads.find((t) => t.name === 'Skibet')!;
    assert.deepEqual(ship.volumes, ['Saltet']);
  });

  it('lægger afsløringerne i læserækkefølge og siger, hvad læseren har med', () => {
    const volumes = view.reveals.map((r) => r.volume);
    assert.deepEqual(volumes, [...volumes].sort((a, b) =>
      (a === b ? 0 : a === 'Saltet' ? -1 : 1)));
    const later = view.reveals.filter((r) => r.volume === 'Tidevandet');
    assert.ok(later.length > 0);
    assert.ok(later.some((r) => r.carriedFrom === 'Saltet'));
    // Og intet i første bind kan være båret med: der er ikke noget før det.
    assert.ok(view.reveals.filter((r) => r.volume === 'Saltet')
      .every((r) => r.carriedFrom === null));
  });

  it('tier om uløste setups, når hvert setup har noget efter sig', () => {
    assert.deepEqual(view.open, []);
  });

  it('melder et setup, der ikke bliver indfriet nogen steder i serien', () => {
    const late = store.db.select().from(scene)
      .innerJoin(chapter, eq(scene.chapterId, chapter.id))
      .where(and(
        eq(chapter.workId, loaded.secondWorkId), eq(scene.branchId, ctx.branchId),
      )).all()[0]!.scene;
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Løs ende' }, (s) => {
      const line = createThread(s, ctx, {
        workId: loaded.secondWorkId, scope: 'series', name: 'Fyrtårnet',
      });
      createBeat(s, ctx, {
        threadId: line, kind: 'setup', sceneId: late.id, summary: 'Lyset står tændt',
      });
    });
    const again = seriesOverview(store, ctx, { seriesId: loaded.seriesId })!;
    assert.equal(again.open.length, 1);
    assert.equal(again.open[0]!.threadName, 'Fyrtårnet');
    assert.match(again.open[0]!.message, /Lyset står tændt/);
  });
});

describe('Serieoversigten og den anden serie i den samme verden', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  after(() => store.close());

  /** En anden serie i den samme verden: én bog, én tråd, ét uløst setup. */
  const other = inTurn(store, {
    branchId: ctx.branchId, actor, summary: 'En anden serie i den samme verden',
  }, (s) => {
    const seriesId = createSeries(s, ctx, { name: 'Fyret', position: 2 });
    const workId = createWork(s, ctx, { title: 'Tågen', seriesId, position: 1 });
    const line = createThread(s, ctx, { workId, scope: 'series', name: 'Lyskeglen' });
    createBeat(s, ctx, { threadId: line, kind: 'setup', summary: 'Nogen slukker det', position: 1 });
    return { seriesId, workId };
  });

  it('arver ingenting fra en anden serie', () => {
    const krag = seriesOverview(store, ctx, { seriesId: loaded.seriesId })!;
    assert.ok(krag.volumes.every((v) => v.title !== 'Tågen'));
    assert.ok(krag.threads.every((t) => t.name !== 'Lyskeglen'));
    assert.ok(krag.open.every((o) => o.threadName !== 'Lyskeglen'));

    // Og den anden vej: den nye serie ser heller ikke Krag-bøgerne.
    const fyret = seriesOverview(store, ctx, { seriesId: other.seriesId })!;
    assert.deepEqual(fyret.volumes.map((v) => v.title), ['Tågen']);
    assert.ok(fyret.threads.every((t) => t.name !== 'Gælden'));
    assert.equal(fyret.open.length, 1);
    assert.equal(fyret.open[0]!.threadName, 'Lyskeglen');
    assert.deepEqual(fyret.people, []);
  });

  it('svarer ingenting for en serie i en anden verden', () => {
    const alone = openStore(':memory:');
    const there = loadHavnen(alone);
    assert.equal(seriesOverview(store, ctx, { seriesId: there.seriesId }), null);
    alone.close();
  });

  it('lader en tråd, der når hele verden, stå i begge serier', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Verdenstråd' }, (s) =>
      createThread(s, ctx, {
        workId: loaded.firstWorkId, scope: 'world', name: 'Havet selv',
      }));
    const krag = seriesOverview(store, ctx, { seriesId: loaded.seriesId })!;
    const fyret = seriesOverview(store, ctx, { seriesId: other.seriesId })!;
    assert.ok(krag.threads.some((t) => t.name === 'Havet selv'));
    const seen = fyret.threads.find((t) => t.name === 'Havet selv')!;
    // Den når «Tågen», men den begynder ikke der, og hjemstavnen skal sige det
    // som det er frem for at lade som om tråden er seriens egen.
    assert.equal(seen.home, '(uden for serien)');
    assert.deepEqual(seen.volumes, []);
  });
});
