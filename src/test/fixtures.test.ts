import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { openStore } from '../db/client';
import { chapter, entityLeg, event, sceneEvent, scene } from '../db/schema';
import { whoKnewWhat } from '../core/queries/knowledge';
import { whoWasWhere, worldline } from '../core/queries/presence';
import { solveTime } from '../core/solve';
import { RealmClocks } from '../core/time/realms';
import { SECONDS, formatSpan } from '../core/time/gregorian';
import { Workbench } from '../core/workbench';
import { loadInception, loadMemento, loadPredestination } from '../fixtures';
import { realm } from '../db/schema';

/**
 * The fixtures are the point of the fixtures: each film presses on a different
 * axis, and a model that can hold all three can hold most things. These tests
 * check the axis, not the plot.
 */

describe('Memento — fortællerorden mod kronologi', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadMemento(store);
  const ctx = new Workbench(store).setActive({ worldId, workId });

  it('fortæller farvesporet baglæns', () => {
    const chapters = store.db.select().from(chapter).where(eq(chapter.workId, workId)).all()
      .sort((a, b) => a.position - b.position);
    const colourChapters = chapters.filter((c) => c.title.startsWith('Farve'));
    assert.equal(colourChapters.length, 5);

    const chronology = colourChapters.map((c) => {
      const sc = store.db.select().from(scene).where(eq(scene.chapterId, c.id)).get()!;
      const link = store.db.select().from(sceneEvent).where(eq(sceneEvent.sceneId, sc.id)).get()!;
      return store.db.select().from(event).where(eq(event.id, link.eventId)).get()!.earliest!;
    });

    const descending = [...chronology].sort((a, b) => b - a);
    assert.deepEqual(chronology, descending,
      'jo senere i læserækkefølgen, jo tidligere i kronologien');
    assert.notDeepEqual(chronology, [...chronology].sort((a, b) => a - b));
  });

  it('lader erindringen udløbe, mens polaroiden bliver ved', () => {
    const leonard = store.sqlite.prepare('select id from entity where name = ?').get('Leonard') as { id: string };
    const colourStart = store.db.select().from(event)
      .where(eq(event.title, 'Farve 1')).get()!.earliest!;

    const fresh = whoKnewWhat(store, ctx, { entityId: leonard.id, at: colourStart + 5 * SECONDS.MINUTE });
    const teddyFresh = fresh.items.find((i) => i.summary.includes('Teddy'))!;
    assert.equal(teddyFresh.source, 'stated');
    assert.equal(teddyFresh.strength, 'convinced', 'lige efter husker han det selv');

    const later = whoKnewWhat(store, ctx, { entityId: leonard.id, at: colourStart + 3 * 3600 });
    const teddyLater = later.items.find((i) => i.summary.includes('Teddy'))!;
    assert.equal(teddyLater.source, 'carried', 'tre timer senere husker han intet — men han bærer beviset');
    assert.equal(teddyLater.viaObject, 'Polaroid af Teddy');
  });

  it('efterlader sandheden om Teddy uafgjort med vilje', () => {
    const truth = store.sqlite.prepare('select truth from fact where summary like ?')
      .get('%Teddy%') as { truth: string };
    assert.equal(truth.truth, 'undecided');
    assert.equal(solveTime(store, ctx).findings.length, 0, 'et uafgjort faktum er ikke et problem');
  });
});

describe('Predestination — personlig tid', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadPredestination(store);
  const ctx = new Workbench(store).setActive({ worldId, workId });
  const traveller = store.sqlite.prepare('select id from entity where name = ?')
    .get('Den rejsende') as { id: string };

  it('har én person med tre ben og tre navne', () => {
    const legs = worldline(store, ctx, traveller.id);
    assert.equal(legs.length, 3);
    assert.deepEqual(legs.map((l) => l.label), ['som Jane', 'som John', 'som bartenderen']);

    const personal = legs.map((l) => l.personalStart!);
    assert.deepEqual(personal, [...personal].sort((a, b) => a - b), 'egen tid stiger altid');

    const worldTimes = legs.map((l) => l.worldStart!);
    assert.notDeepEqual(worldTimes, [...worldTimes].sort((a, b) => a - b),
      'verdens tid gør ikke — det er hele pointen');
  });

  it('lader personen møde sig selv uden at det er bilokation', () => {
    const bar = store.sqlite.prepare('select id from entity where name = ?').get('Baren') as { id: string };
    const evening = store.db.select().from(event).where(eq(event.title, 'Aftenen i baren')).get()!;
    const there = whoWasWhere(store, ctx, { from: evening.earliest! + 3600, placeId: bar.id });

    assert.equal(there.length, 2);
    assert.equal(new Set(there.map((p) => p.entityName)).size, 1, 'samme menneske');
    assert.equal(new Set(there.map((p) => p.legOrdinal)).size, 2, 'to forskellige ben');
  });

  it('holder det unge ben uvidende om det, det ældste ved', () => {
    const legs = store.db.select().from(entityLeg)
      .where(eq(entityLeg.entityId, traveller.id)).all().sort((a, b) => a.ordinal - b.ordinal);

    const young = whoKnewWhat(store, ctx, { entityId: traveller.id, legId: legs[0]!.id, at: 10 * 31556952 });
    const old = whoKnewWhat(store, ctx, { entityId: traveller.id, legId: legs[2]!.id, at: 40 * 31556952 });

    const knowsIdentity = (r: { items: { summary: string }[] }) =>
      r.items.some((i) => i.summary.includes('samme'));
    assert.equal(knowsIdentity(young), false, 'som Jane aner hun det ikke');
    assert.equal(knowsIdentity(old), true, 'som bartenderen ved han det godt');
  });

  it('accepterer en verdens-tid, der springer tilbage', () => {
    const report = solveTime(store, ctx);
    assert.equal(report.findings.length, 0,
      'sløjfen er tidsrejse, ikke en umulig kronologi');
  });
});

describe('Inception — lag inden i lag', () => {
  const store = openStore(':memory:');
  const { worldId, workId, realmIds } = loadInception(store);
  const ctx = new Workbench(store).setActive({ worldId, workId });

  it('har fire lag, hvert tyve gange hurtigere', () => {
    assert.equal(realmIds.length, 4);
    const rows = store.db.select().from(realm).where(eq(realm.worldId, worldId)).all();
    const dreams = rows.filter((r) => r.kind === 'dream');
    assert.equal(dreams.length, 3);
    assert.ok(dreams.every((d) => d.timeRatioNum === 20 && d.parentEpoch != null),
      'hvert lag er både hurtigere end og fæstnet til det over');
  });

  it('svarer forskelligt på "hvor lang tid gik der", alt efter hvilket ur man spørger', () => {
    const rows = store.db.select().from(realm).where(eq(realm.worldId, worldId)).all();
    const clocks = new RealmClocks(rows.map((r) => ({
      id: r.id, parentRealmId: r.parentRealmId,
      timeRatioNum: r.timeRatioNum, timeRatioDen: r.timeRatioDen,
      parentEpoch: r.parentEpoch, localEpoch: r.localEpoch,
    })));

    const tenMinutes = 10 * SECONDS.MINUTE;
    assert.equal(formatSpan(clocks.spanFromRoot(realmIds[1]!, tenMinutes)), '3 timer 20 minutter');
    assert.equal(formatSpan(clocks.spanFromRoot(realmIds[2]!, tenMinutes)), '2 døgn 19 timer');
    assert.equal(formatSpan(clocks.spanFromRoot(realmIds[3]!, tenMinutes)), '56 døgn');
  });

  it('lader kroppen sove ovenpå, mens personen arbejder nedenunder', () => {
    const cobb = store.sqlite.prepare('select id from entity where name = ?').get('Cobb') as { id: string };
    const epoch = store.db.select().from(event).where(eq(event.title, 'Man falder i søvn')).get()!.earliest!;
    const everywhere = whoWasWhere(store, ctx, { from: epoch + 60, entityId: cobb.id });

    assert.ok(everywhere.length >= 2, 'han er både i varevognen og i drømmen');
    assert.equal(new Set(everywhere.map((p) => p.realmId)).size, everywhere.length,
      'men aldrig to steder i det samme lag');
  });

  it('lader dig selv bestemme, om man husker drømmen', () => {
    const laws = store.sqlite.prepare('select statement, hardness from law where world_id = ?')
      .all(worldId) as { statement: string; hardness: string }[];
    assert.ok(laws.some((l) => l.hardness === 'soft' && /husker drømmen/.test(l.statement)),
      'det er en lov, du sætter — ikke noget værktøjet gætter');
  });
});
