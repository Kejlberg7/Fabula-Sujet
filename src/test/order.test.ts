import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { openStore } from '../db/client';
import { chapter, scene, thread, work } from '../db/schema';
import { inTurn } from '../core/changelog';
import { readingOrder } from '../core/queries/order';
import { runRules } from '../core/rules';
import { createBeat, createThread } from '../core/services/narrative';
import { createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { loadHavnen } from '../fixtures';
import { resolveThread } from '../mcp/resolve';

const actor = { kind: 'user' as const };

/**
 * Fase elleve, første snit: serien er én fortælling.
 *
 * Det, der prøves her, er en rækkefølge og en rækkevidde. Rækkefølgen er
 * serie → bog → kapitel → scene, og uden den ligger bind to's første kapitel
 * før bind et's andet. Rækkevidden er, hvor langt en tråd når -- og det er den,
 * der afgør, om et setup i «Saltet» kan blive indfriet i «Tidevandet».
 */

describe('Læseorden på tværs af bind', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  after(() => store.close());

  const order = readingOrder(store, ctx);
  const scenesOf = (workId: string) => store.db.select().from(scene)
    .innerJoin(chapter, eq(scene.chapterId, chapter.id))
    .where(and(eq(chapter.workId, workId), eq(scene.branchId, ctx.branchId))).all()
    .map((row) => row.scene);

  it('lægger bindene i serieorden', () => {
    assert.deepEqual(order.works.map((row) => row.title), ['Saltet', 'Tidevandet']);
    assert.equal(order.works[0]!.seriesName, 'Krag');
  });

  it('lægger hele bind et før hele bind to', () => {
    const first = scenesOf(loaded.firstWorkId).map((sc) => order.sceneRank(sc.id)!);
    const second = scenesOf(loaded.secondWorkId).map((sc) => order.sceneRank(sc.id)!);
    assert.ok(first.length > 0 && second.length > 0);
    assert.ok(Math.max(...first) < Math.min(...second),
      'bind to må ikke begynde, før bind et er læst færdigt');
  });

  it('holder kapitelrækkefølgen inden i bindet', () => {
    const scenes = scenesOf(loaded.secondWorkId);
    const chapters = store.db.select().from(chapter).where(and(
      eq(chapter.workId, loaded.secondWorkId), eq(chapter.branchId, ctx.branchId),
    )).all().sort((a, b) => a.position - b.position);
    const ranks = chapters.map((ch) => Math.min(
      ...scenes.filter((sc) => sc.chapterId === ch.id).map((sc) => order.sceneRank(sc.id)!),
    ));
    assert.deepEqual([...ranks].sort((a, b) => a - b), ranks);
  });
});

describe('En tråds rækkevidde', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  after(() => store.close());

  const order = readingOrder(store, ctx);
  const threadNamed = (name: string) => store.db.select().from(thread).where(and(
    eq(thread.name, name), eq(thread.branchId, ctx.branchId),
  )).get()!;

  it('lader en bogtråd blive i sin bog', () => {
    assert.deepEqual(order.reach(threadNamed('Skibet')), [loaded.firstWorkId]);
  });

  it('lader en serietråd nå begge bind', () => {
    assert.deepEqual(
      order.reach(threadNamed('Gælden')),
      [loaded.firstWorkId, loaded.secondWorkId],
    );
  });

  it('lader en verdenstråd nå alle bøger i verden', () => {
    const standalone = inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Enkeltstående bog',
    }, (s) => createWork(s, ctx, { title: 'Fyrmesteren' }));
    const wide = inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Verdenstråd',
    }, (s) => createThread(s, ctx, {
      workId: loaded.firstWorkId, scope: 'world', name: 'Havet selv',
    }));
    const again = readingOrder(store, ctx);
    assert.deepEqual(again.reach(threadNamed('Havet selv')).sort(), [
      loaded.firstWorkId, loaded.secondWorkId, standalone,
    ].sort());
    assert.ok(wide);
    // Og den enkeltstående bog ligger efter serien, ikke inde i den.
    assert.equal(again.works.at(-1)!.title, 'Fyrmesteren');
  });

  it('finder en serietråd frem fra det bind, den ikke begyndte i', () => {
    const inSecond = bench.setActive({
      worldId: loaded.worldId, workId: loaded.secondWorkId,
    });
    assert.equal(resolveThread(store, inSecond, 'Gælden').name, 'Gælden');
    assert.throws(() => resolveThread(store, inSecond, 'Skibet'), /Skibet/);
  });
});

describe('Hængende setup over to bind', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  after(() => store.close());

  const threadNamed = (name: string) => store.db.select().from(thread).where(and(
    eq(thread.name, name), eq(thread.branchId, ctx.branchId),
  )).get()!;
  const dangling = () => runRules(store, ctx, ['dangling_setup']).findings;

  it('tier om et setup, der bliver indfriet i næste bind', () => {
    assert.equal(dangling().filter((f) => f.message.includes('Gælden')).length, 0);
  });

  it('ser et setup i næste bind, når tråden når derover — og ikke ellers', () => {
    const later = store.db.select().from(scene)
      .innerJoin(chapter, eq(scene.chapterId, chapter.id))
      .where(and(
        eq(chapter.workId, loaded.secondWorkId), eq(scene.branchId, ctx.branchId),
      )).all()[0]!.scene;
    const id = inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Tråd med løs ende i bind to',
    }, (s) => {
      const line = createThread(s, ctx, {
        workId: loaded.secondWorkId, scope: 'series', name: 'Fyrtårnet',
      });
      createBeat(s, ctx, {
        threadId: line, kind: 'setup', sceneId: later.id, summary: 'Lyset står tændt',
      });
      return line;
    });
    // Tråden hører hjemme i «Tidevandet», og den valgte bog er «Saltet». En
    // løs ende i serien er seriens sag, så den skal ses herfra -- men kun så
    // længe tråden faktisk når herover.
    const found = dangling().filter((f) => f.message.includes('Fyrtårnet'));
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /senere bind/);

    store.db.update(thread).set({ scope: 'work' }).where(eq(thread.id, id)).run();
    assert.equal(dangling().filter((f) => f.message.includes('Fyrtårnet')).length, 0);
  });

  it('tier om et payoff, der endnu ikke er skrevet ind i en scene', () => {
    const line = inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Uskreven tråd',
    }, (s) => {
      const id = createThread(s, ctx, { workId: loaded.firstWorkId, name: 'Fyret' });
      const anyScene = store.db.select().from(scene)
        .where(eq(scene.branchId, ctx.branchId)).all()[0]!;
      createBeat(s, ctx, {
        threadId: id, kind: 'setup', sceneId: anyScene.id, summary: 'Lyset slukkes',
      });
      createBeat(s, ctx, { threadId: id, kind: 'payoff', summary: 'Nogen tænder det igen' });
      return id;
    });
    assert.ok(line);
    assert.equal(dangling().filter((f) => f.message.includes('Fyret')).length, 0);
  });

  it('melder et payoff, der ligger før sit setup på tværs af bindene', () => {
    const scenesIn = (workId: string) => store.db.select().from(scene)
      .innerJoin(chapter, eq(scene.chapterId, chapter.id))
      .where(and(eq(chapter.workId, workId), eq(scene.branchId, ctx.branchId))).all()
      .map((row) => row.scene);
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Bagvendt tråd' }, (s) => {
      const id = createThread(s, ctx, {
        workId: loaded.firstWorkId, scope: 'series', name: 'Bagvendt',
      });
      createBeat(s, ctx, {
        threadId: id, kind: 'payoff', sceneId: scenesIn(loaded.firstWorkId)[0]!.id,
        summary: 'Svaret',
      });
      createBeat(s, ctx, {
        threadId: id, kind: 'setup', sceneId: scenesIn(loaded.secondWorkId)[0]!.id,
        summary: 'Spørgsmålet',
      });
    });
    const found = dangling().filter((f) => f.message.includes('Bagvendt'));
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /senere bind/);
  });

  it('regner stadig kun på den valgte bogs egne tråde, når den ikke når videre', () => {
    const all = store.db.select().from(work).where(eq(work.branchId, ctx.branchId)).all();
    assert.ok(all.length >= 2);
    const inSecond = bench.setActive({
      worldId: loaded.worldId, workId: loaded.secondWorkId,
    });
    const names = runRules(store, inSecond, ['dangling_setup']).findings
      .map((f) => f.message);
    assert.equal(names.filter((m) => m.includes('Skibet')).length, 0);
  });
});
