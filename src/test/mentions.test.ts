import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { openStore } from '../db/client';
import { entity, identity, scene, sceneEvent } from '../db/schema';
import { inTurn } from '../core/changelog';
import { runRules } from '../core/rules';
import { solveTime } from '../core/solve';
import { createEvent } from '../core/services/events';
import { createReveal, createTextAnchor } from '../core/services/narrative';
import { createFact } from '../core/services/knowledge';
import { Workbench } from '../core/workbench';
import {
  loadHavnen, loadInception, loadMemento, loadPredestination,
} from '../fixtures';

const actor = { kind: 'user' as const };
const CODES = ['mention_ahead_of_time', 'mention_name_not_yet', 'mention_reader_ahead'];

/**
 * Fase ti, tredje snit: en omtale er en påstand, motoren kan prøve.
 *
 * Halvdelen af prøverne herunder handler om, hvad reglerne *ikke* siger. En
 * omtale nævner; den sætter ingen i rummet, og den regel, der troede noget
 * andet, ville melde den mest almindelige sætning i bogen.
 */

describe('Omtaler prøvet mod bibelen', () => {
  const store = openStore(':memory:');
  const loaded = loadPredestination(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.workId });
  after(() => store.close());

  const sceneNamed = (title: string) => store.db.select().from(scene).where(and(
    eq(scene.title, title), eq(scene.branchId, ctx.branchId),
  )).get()!;
  const identityNamed = (name: string) => store.db.select().from(identity).where(and(
    eq(identity.name, name), eq(identity.branchId, ctx.branchId),
  )).get()!;

  /** Barndommen på børnehjemmet, 1945, dramatiseret og bunden til Jane. */
  const childhoodScene = sceneNamed('Jane, atten år');
  /** Aftenen i baren, 1970, hvor bartenderen allerede hedder det. */
  const barScene = sceneNamed('Jeg fortæller ham det hele');
  /** Barnet i 1945 fortalt i 1970: scenen dramatiserer ingenting. */
  const toldScene = sceneNamed('Barnet, som det bliver fortalt');

  let marks = 0;
  const anchorIn = (
    sceneId: string,
    targetKind: 'event' | 'fact' | 'entity' | 'identity',
    targetId: string,
  ) => {
    marks += 1;
    const markId = `proeve-${marks}`;
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Prøveomtale' }, (s) => {
      createTextAnchor(s, ctx, { sceneId, markId, targetKind, targetId });
    });
    return markId;
  };

  const found = (code?: string) => {
    solveTime(store, ctx);
    const out = runRules(store, ctx, CODES);
    return out.findings.filter((f) => !code || f.ruleCode === code);
  };

  it('siger ingenting om prøvecasene, som de er skrevet', () => {
    assert.deepEqual(found(), []);
  });

  it('melder et navn, der bruges før identiteten findes', () => {
    anchorIn(childhoodScene.id, 'identity', identityNamed('John').id);
    const hits = found('mention_name_not_yet');
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.message, /«John»/u);
    assert.match(hits[0]!.message, /før identiteten er taget i brug/u);
  });

  it('tier, når navnet er inden for sin gyldighed', () => {
    // Bartenderen hedder det fra 1970, og scenen er aftenen i 1970.
    anchorIn(barScene.id, 'identity', identityNamed('Bartenderen').id);
    assert.equal(found('mention_name_not_yet').length, 1);
  });

  it('tier om en scene, der ikke dramatiserer noget', () => {
    // Bartenderen fortæller i 1970 om barnet i 1945. Scenens eneste kobling er
    // «omtalt», og så har den ingen nutid at måle navnet imod.
    anchorIn(toldScene.id, 'identity', identityNamed('Bartenderen').id);
    assert.equal(found('mention_name_not_yet').length, 1);
  });

  it('tier om en identitet uden gyldighedsperiode', () => {
    const who = store.db.select().from(entity)
      .where(eq(entity.branchId, ctx.branchId)).all()[0]!;
    const navnløs = inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Identitet uden tid',
    }, (s) => s.insert(identity, {
      entityId: who.id, branchId: ctx.branchId, name: 'Den uden datoer',
    })['id'] as string);
    anchorIn(childhoodScene.id, 'identity', navnløs);
    assert.equal(found('mention_name_not_yet').length, 1);
  });
});

describe('Omtale før sin tid', () => {
  const store = openStore(':memory:');
  const loaded = loadPredestination(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.workId });
  after(() => store.close());

  const childhoodScene = store.db.select().from(scene).where(and(
    eq(scene.title, 'Jane, atten år'), eq(scene.branchId, ctx.branchId),
  )).get()!;
  const realmId = childhoodScene.realmId!;

  let marks = 0;
  const anchorEvent = (sceneId: string, eventId: string) => {
    marks += 1;
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Prøveomtale' }, (s) => {
      createTextAnchor(s, ctx, {
        sceneId, markId: `senere-${marks}`, targetKind: 'event', targetId: eventId,
      });
    });
  };
  const ahead = () => {
    solveTime(store, ctx);
    return runRules(store, ctx, CODES).findings
      .filter((f) => f.ruleCode === 'mention_ahead_of_time');
  };
  const YEAR = Math.round(365.2425 * 86400);

  it('melder en passage, der peger på noget, der først kan ske senere', () => {
    const later = inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Senere event',
    }, (s) => createEvent(s, ctx, {
      title: 'Noget, der først sker om tredive år', realmId,
      earliest: 0 + 30 * YEAR, latest: 0 + 31 * YEAR,
    }));
    anchorEvent(childhoodScene.id, later);
    const hits = ahead();
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.message, /tidligst sker senere/u);
  });

  it('tier, når eventet lige så godt kan ligge før scenen', () => {
    // Uskarp tid er ikke en fejl. Kan det arrangeres, så det går op, er der
    // ikke noget at melde — forfatteren har bare ikke besluttet sig endnu.
    const vague = inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Uskarpt event',
    }, (s) => createEvent(s, ctx, {
      title: 'Noget, der kan ligge hvor som helst', realmId,
      earliest: -50 * YEAR, latest: 50 * YEAR,
    }));
    anchorEvent(childhoodScene.id, vague);
    assert.equal(ahead().length, 1);
  });

  it('tier, når fortælleren er alvidende', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Alvidende' }, (s) => {
      s.update(scene, childhoodScene.id, { narrationPerson: 'third_omniscient' });
    });
    assert.equal(ahead().length, 0);
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Bunden igen' }, (s) => {
      s.update(scene, childhoodScene.id, { narrationPerson: childhoodScene.narrationPerson });
    });
    assert.equal(ahead().length, 1);
  });

  it('lader POV-reglen om det event, scenen selv dramatiserer', () => {
    // En omtale af scenens eget event er POV-lækagens sag. To regler, der
    // melder det samme, er én regel for meget.
    const own = store.db.select().from(sceneEvent).where(and(
      eq(sceneEvent.sceneId, childhoodScene.id), eq(sceneEvent.branchId, ctx.branchId),
    )).get()!;
    anchorEvent(childhoodScene.id, own.eventId);
    assert.equal(ahead().length, 1);
  });
});

describe('Omtale før læseren ved det', () => {
  const store = openStore(':memory:');
  const loaded = loadPredestination(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.workId });
  after(() => store.close());

  const sceneNamed = (title: string) => store.db.select().from(scene).where(and(
    eq(scene.title, title), eq(scene.branchId, ctx.branchId),
  )).get()!;
  const childhoodScene = sceneNamed('Jane, atten år');

  const reader = () => {
    solveTime(store, ctx);
    return runRules(store, ctx, CODES).findings
      .filter((f) => f.ruleCode === 'mention_reader_ahead');
  };

  let secret = '';
  it('melder en passage, der peger på noget, læseren aldrig får', () => {
    secret = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Hemmelighed' }, (s) => {
      const made = createFact(s, ctx, {
        predicate: 'aldrig_fortalt', summary: 'Noget ingen læser får at vide',
        realmId: childhoodScene.realmId!, slots: [],
      });
      createTextAnchor(s, ctx, {
        sceneId: childhoodScene.id, markId: 'hemmelig-1',
        targetKind: 'fact', targetId: made.factId,
      });
      return made.factId;
    });
    const hits = reader();
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.message, /aldrig får at vide/u);
  });

  it('tier, når scenen selv skriver afsløringen ned', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Afslør her' }, (s) => {
      createReveal(s, ctx, {
        factId: secret, sceneId: childhoodScene.id, strength: 'hinted',
      });
    });
    assert.deepEqual(reader(), []);
  });

  it('tier, når læseren allerede har fået det i et tidligere kapitel', () => {
    // «Jane, John og bartenderen er den samme» antydes i kapitel 1.
    const known = store.db.select().from(scene).where(and(
      eq(scene.title, 'Jeg fortæller ham det hele'), eq(scene.branchId, ctx.branchId),
    )).get()!;
    assert.ok(known);
    assert.deepEqual(reader(), []);
  });
});

describe('Prøvecasene falder ikke i omtalereglerne', () => {
  for (const [name, load] of [
    ['Memento', loadMemento], ['Predestination', loadPredestination],
    ['Inception', loadInception], ['Havnen', loadHavnen],
  ] as const) {
    it(`${name} melder ingenting`, () => {
      const store = openStore(':memory:');
      const world = load(store);
      const bench = new Workbench(store);
      const ctx = bench.setActive({ worldId: world.worldId });
      solveTime(store, ctx);
      const hits = runRules(store, ctx, CODES);
      assert.deepEqual(hits.findings.map((f) => f.message), []);
      assert.deepEqual(hits.lifted.map((f) => f.message), []);
      store.close();
    });
  }
});
