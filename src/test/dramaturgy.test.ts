import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openStore } from '../db/client';
import { lineageRoot, createBranchFromHistory, moveReveal, workInBranch } from '../core/branches';
import { inTurn } from '../core/changelog';
import { compareTwists, twistReadings } from '../core/queries/dramaturgy';
import { createEntity } from '../core/services/entities';
import { addParticipation, createEvent, linkEventFact } from '../core/services/events';
import { createFact, recordBelief, recordStatement } from '../core/services/knowledge';
import {
  createChapter, createReveal, createScene, linkSceneToEvent,
} from '../core/services/narrative';
import { createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { loadHavnen, loadMemento } from '../fixtures';
import { makeWorld } from './helpers';

const actor = { kind: 'user' as const };
const T = 1_000_000_000;

/**
 * Grebet vurderes, ikke måles.
 *
 * Prøverne her går på to ting. Den ene er, at en aflæsning altid kan gøres
 * rede for: den peger på scener, der findes, og den tier, hvor der ikke er
 * noget at regne på. Den anden er, at akserne faktisk skelner — at flytte en
 * afsløring skal ændre aflæsningen, ellers måler den ingenting.
 */

/** En lille bog: fire scener, ét faktum, ét spor lagt ud undervejs. */
function book(options: { revealAt: number; clueAt?: number; lie?: boolean }) {
  const world = makeWorld();
  const bench = new Workbench(world.store);
  let ctx = bench.setActive({ worldId: world.worldId, userId: world.userId });
  let workId = '';
  const scenes: string[] = [];
  let factId = '';

  inTurn(world.store, { branchId: ctx.branchId, actor, summary: 'Bogen' }, (s) => {
    workId = createWork(s, ctx, { title: 'Gåden' });
    const anna = createEntity(s, ctx, { name: 'Anna', kind: 'person' });
    const peter = createEntity(s, ctx, { name: 'Peter', kind: 'person' });
    const room = createEntity(s, ctx, { name: 'Stuen', kind: 'place' });
    const secret = createFact(s, ctx, {
      predicate: 'draebte', summary: 'Anna dræbte Peter', realmId: world.realmId,
      slots: [{ name: 'offer', valueKind: 'entity', value: { entityId: peter } }],
    });
    factId = secret.factId;

    for (let n = 1; n <= 4; n += 1) {
      const chapterId = createChapter(s, ctx, world.store, { workId, title: `Kapitel ${n}` });
      const sceneId = createScene(s, ctx, world.store, {
        chapterId, title: `Scene ${n}`, povEntityId: peter, realmId: world.realmId,
      });
      const eventId = createEvent(s, ctx, {
        title: `Hændelse ${n}`, realmId: world.realmId, placeId: room,
        earliest: T + n * 3600, latest: T + n * 3600,
      });
      addParticipation(s, ctx, { eventId, entityId: anna, role: 'actor' });
      linkSceneToEvent(s, ctx, { sceneId, eventId, mode: 'dramatised' });
      scenes.push(sceneId);

      // Et uskiltet spor: scenen viser sagen uden at bogen peger på den.
      if (options.clueAt === n) {
        linkEventFact(s, ctx, { eventId, factId, exposes: 'evidences' });
      }
      if (options.revealAt === n) {
        createReveal(s, ctx, { factId, sceneId, strength: 'confirmed' });
      }
    }

    if (options.lie) {
      recordStatement(s, ctx, {
        speakerEntityId: anna, factId, truthful: false, atTime: T,
        note: 'Hun siger, hun var et andet sted.',
      });
    }
  });

  ctx = bench.setActive({ worldId: world.worldId, workId, branchId: ctx.branchId });
  return { ...world, bench, ctx, workId, scenes, factId };
}

describe('Grebet — aflæsningerne', () => {
  const read = (made: ReturnType<typeof book>) =>
    twistReadings(made.store, made.ctx, { workId: made.workId })[0]!;
  const axis = (made: ReturnType<typeof book>, name: string) =>
    read(made).readings.find((r) => r.axis === name);

  it('siger fra, når afsløringen kommer uden spor', () => {
    const fair = axis(book({ revealAt: 3 }), 'retfaerdighed')!;
    assert.equal(fair.verdict, 'tynd');
    assert.match(fair.message, /intet om det/);
  });

  it('anerkender et spor, der lå på siden i forvejen', () => {
    const made = book({ revealAt: 3, clueAt: 1 });
    assert.equal(axis(made, 'retfaerdighed')!.verdict, 'staerk');
    // Et uskiltet spor er den slags, læseren vender tilbage til bagefter.
    const back = axis(made, 'efterrationalisering')!;
    assert.equal(back.verdict, 'staerk');
    assert.equal(back.scenes[0]!.order, 1, 'aflæsningen skal pege på den scene, sporet lå i');
  });

  it('regner ikke et spor efter afsløringen med', () => {
    const made = book({ revealAt: 2, clueAt: 4 });
    assert.equal(axis(made, 'retfaerdighed')!.verdict, 'tynd',
      'et spor, der kommer bagefter, kunne læseren ikke bruge');
  });

  it('bemærker, at der ikke er plads til et efterspil', () => {
    assert.equal(axis(book({ revealAt: 4 }), 'timing')!.verdict, 'se_efter');
    assert.equal(axis(book({ revealAt: 2 }), 'timing')!.verdict, 'staerk');
  });

  it('ser forskel på en løgn i vejen og ingen modstand', () => {
    assert.equal(axis(book({ revealAt: 3 }), 'vildledning')!.verdict, 'tynd');
    const misled = axis(book({ revealAt: 3, lie: true }), 'vildledning')!;
    assert.equal(misled.verdict, 'staerk');
    assert.match(misled.message, /Anna lyver/);
  });

  it('tier om det, den ikke har noget at regne på', () => {
    const made = book({ revealAt: 3 });
    // Ingen tråde, ingen beats: så siger forberedelsesaksen ingenting.
    assert.equal(axis(made, 'forberedelse'), undefined);
    assert.equal(axis(made, 'efterrationalisering'), undefined);
  });

  it('giver aldrig et tal, men altid scener at gå til', () => {
    const report = read(book({ revealAt: 3, clueAt: 1, lie: true }));
    assert.ok(report.readings.length > 0);
    assert.equal(
      JSON.stringify(report).match(/"score"|"points"|"rating"/), null,
      'en karakter ville hverken kunne diskuteres eller handles på',
    );
    for (const reading of report.readings) {
      assert.ok(reading.message.length > 0);
      for (const point of reading.scenes) {
        assert.ok(point.order >= 1 && point.order <= report.totalScenes,
          'hver scene i en begrundelse skal findes i bogen');
      }
    }
  });
});

describe('Grebet — de tre prøvecases', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadMemento(store);
  const ctx = new Workbench(store).setActive({ worldId, workId });
  const reports = twistReadings(store, ctx, { workId });

  it('læser hver afsløring i Memento', () => {
    assert.ok(reports.length >= 5, `fik ${reports.length} afsløringer`);
    assert.ok(reports.every((r) => r.shape.length > 0));
  });

  it('lader det uafklarede stå uafklaret', () => {
    // Filmen afgør aldrig Sammy Jankis. Aksen skal sige det, ikke gætte.
    const sammy = reports.find((r) => r.summary.includes('Sammy'))!;
    assert.equal(sammy.disclosure, null);
    assert.match(sammy.readings.find((r) => r.axis === 'overraskelse')!.message, /aldrig sagt rent ud/i);
  });

  it('sorterer den senest afslørede først', () => {
    const orders = reports.map((r) => r.disclosure?.order ?? 0);
    assert.deepEqual(orders, [...orders].sort((a, b) => b - a));
  });
});

describe('Grebet på tværs af bindene', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const ctx = new Workbench(store)
    .setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  const reports = twistReadings(store, ctx, { workId: loaded.firstWorkId });
  const sinking = reports.find((r) => r.summary.includes('sænket'))!;

  it('måler forberedelsen helt frem til indfrielsen i næste bind', () => {
    const prep = sinking.readings.find((r) => r.axis === 'forberedelse')!;
    // «Gælden» sættes op i «Saltet» og indfries i «Tidevandet». Målt på
    // bindets egne ni scener kunne afstanden aldrig blive større end otte.
    const scenes = Number(prep.message.match(/går (\d+) scener/)![1]);
    assert.ok(scenes > 9, `forberedelsen målte kun ${scenes} scener`);
    assert.match(prep.message, /fra «Saltet» til «Tidevandet»/);
  });

  it('siger hvilket bind en scene fra et andet bind står i', () => {
    const prep = sinking.readings.find((r) => r.axis === 'forberedelse')!;
    const elsewhere = prep.scenes.filter((sc) => sc.otherWork);
    assert.equal(elsewhere.length, 1);
    assert.equal(elsewhere[0]!.otherWork, 'Tidevandet');
    // Nummeret tæller stadig fra et i sit eget bind; det er derfor, bindet skal
    // stå der. Et nummer på tværs af serien ville ingen kunne slå op.
    assert.ok(elsewhere[0]!.order <= 9);
  });

  it('nævner hver scene én gang, hvor mange gange den end tæller med', () => {
    for (const report of reports) {
      for (const reading of report.readings) {
        const ids = reading.scenes.map((sc) => sc.id);
        assert.equal(new Set(ids).size, ids.length,
          `${report.summary} · ${reading.axis} nævner den samme scene to gange`);
      }
    }
  });

  it('lader et bind uden serie måle på sig selv alene', () => {
    const alone = openStore(':memory:');
    const one = loadMemento(alone);
    const there = new Workbench(alone).setActive({ worldId: one.worldId, workId: one.workId });
    const all = twistReadings(alone, there, { workId: one.workId })
      .flatMap((r) => r.readings).flatMap((r) => r.scenes);
    assert.ok(all.length > 0);
    assert.ok(all.every((sc) => sc.otherWork === null));
    alone.close();
  });
});

describe('Grebet — den samme afsløring på to grene', () => {
  it('viser hvilke akser der flytter sig, når afsløringen flyttes', () => {
    const made = book({ revealAt: 4, clueAt: 1 });
    const seq = made.store.sqlite
      .prepare('select max(seq) as n from "change" where branch_id = ?')
      .get(made.ctx.branchId) as { n: number };

    const variant = createBranchFromHistory(made.store, {
      sourceBranchId: made.ctx.branchId,
      sourceWorkId: made.workId,
      name: 'Tidligere',
      changeSeq: seq.n,
      actor,
    });
    const otherCtx = { ...made.ctx, branchId: variant.branchId };
    const otherWorkId = workInBranch(made.store, made.workId, variant.branchId)!;

    // Flyt afsløringen fra sidste til anden scene på grenen.
    const target = twistReadings(made.store, otherCtx, { workId: otherWorkId })[0]!;
    const secondScene = made.store.sqlite.prepare(
      'select id from scene where branch_id = ? order by rowid limit 1 offset 1',
    ).get(variant.branchId) as { id: string };
    inTurn(made.store, { branchId: variant.branchId, actor, summary: 'Flyt' }, (s) => {
      const revealId = made.store.sqlite.prepare(
        'select id from reveal where branch_id = ?',
      ).get(variant.branchId) as { id: string };
      moveReveal(s, made.store, otherCtx, { revealId: revealId.id, sceneId: secondScene.id });
    });
    assert.ok(target);

    const shifts = compareTwists(made.store, {
      here: made.ctx, hereWorkId: made.workId,
      there: otherCtx, thereWorkId: otherWorkId,
      lineage: (table, id) => lineageRoot(made.store, table, id),
    });

    assert.equal(shifts.length, 1, 'det samme faktum skal genkendes på tværs af grenene');
    const shift = shifts[0]!;
    assert.equal(shift.here, 4);
    assert.equal(shift.there, 2);
    assert.ok(shift.moved.some((m) => m.axis === 'timing'),
      'at flytte afsløringen frem skal give plads til et efterspil, og det skal ses');
  });
});

/** Videnstilbageholdelse skal skelnes fra en utæthed. */
describe('Grebet — informationskontrol', () => {
  it('kalder det tilbageholdt information, når synsvinklen har vidst det hele vejen', () => {
    const world = makeWorld();
    const bench = new Workbench(world.store);
    let ctx = bench.setActive({ worldId: world.worldId, userId: world.userId });
    let workId = '';
    inTurn(world.store, { branchId: ctx.branchId, actor, summary: 'Bogen' }, (s) => {
      workId = createWork(s, ctx, { title: 'Den der ved det' });
      const anna = createEntity(s, ctx, { name: 'Anna', kind: 'person' });
      const secret = createFact(s, ctx, {
        predicate: 'ved', summary: 'Anna har gjort det', realmId: world.realmId, slots: [],
      });
      recordBelief(s, ctx, {
        entityId: anna, factId: secret.factId, strength: 'knows', sincePersonal: 0,
      });
      for (let n = 1; n <= 4; n += 1) {
        const chapterId = createChapter(s, ctx, world.store, { workId, title: `Kapitel ${n}` });
        const sceneId = createScene(s, ctx, world.store, {
          chapterId, title: `Scene ${n}`, povEntityId: anna, realmId: world.realmId,
        });
        if (n === 4) createReveal(s, ctx, { factId: secret.factId, sceneId, strength: 'confirmed' });
      }
    });
    ctx = bench.setActive({ worldId: world.worldId, workId, branchId: ctx.branchId });

    const control = twistReadings(world.store, ctx, { workId })[0]!
      .readings.find((r) => r.axis === 'informationskontrol')!;
    assert.equal(control.verdict, 'staerk', 'præmissen er ikke en fejl');
    assert.match(control.message, /hele vejen/);
  });
});
