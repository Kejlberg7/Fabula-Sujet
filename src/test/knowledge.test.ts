import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { openStore, type Store } from '../db/client';
import { inTurn } from '../core/changelog';
import { whoKnewWhat } from '../core/queries/knowledge';
import { whatReaderKnows } from '../core/queries/reader';
import { whoWasWhere } from '../core/queries/presence';
import { createEntity, recordMemoryPolicy, recordPossession, recordPresence } from '../core/services/entities';
import { addParticipation, createEvent, linkEventFact } from '../core/services/events';
import { attachFactToCarrier, createFact, recordBelief } from '../core/services/knowledge';
import { createChapter, createReveal, createScene } from '../core/services/narrative';
import { createWorld, createWork } from '../core/services/world';
import { solveTime } from '../core/solve';
import { SECONDS } from '../core/time/gregorian';
import { Workbench, type Context } from '../core/workbench';

const DAY = SECONDS.DAY;
const actor = { kind: 'user' as const };

/**
 * A small murder, built the way the app is meant to be used, to check that the
 * pieces hold together: partial knowledge, a wrong belief, a note in a pocket,
 * and what the reader has been told by chapter three.
 */
describe('viden i praksis', () => {
  let store: Store;
  let bench: Workbench;
  let ctx: Context;
  const id: Record<string, string> = {};
  let slots: Map<string, string>;
  let knifeSlots: Map<string, string>;

  before(() => {
    store = openStore(':memory:');
    bench = new Workbench(store);
    const created = createWorld(store, { name: 'Mordgåden' });
    ctx = bench.setActive({ worldId: created.worldId, userId: created.userId });
    id['realm'] = created.realmId;

    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Byg gåden' }, (s) => {
      for (const [key, name] of [['anna', 'Anna'], ['peter', 'Peter'], ['teddy', 'Teddy'], ['bo', 'Bo']] as const) {
        id[key] = createEntity(s, ctx, { name, kind: 'person' });
      }
      id['stuen'] = createEntity(s, ctx, { name: 'Stuen', kind: 'place' });
      id['seddel'] = createEntity(s, ctx, { name: 'Sammenkrøllet seddel', kind: 'object' });

      const killing = createFact(s, ctx, {
        predicate: 'draebte', summary: 'Nogen dræbte Peter', realmId: id['realm']!,
        slots: [
          { name: 'gerningsmand', valueKind: 'entity', value: { entityId: id['teddy'] } },
          { name: 'offer', valueKind: 'entity', value: { entityId: id['peter'] } },
        ],
      });
      id['fakta_mord'] = killing.factId;
      slots = killing.slotIds;

      const knife = createFact(s, ctx, {
        predicate: 'kniven_ligger', summary: 'Kniven ligger i skuret', realmId: id['realm']!,
        slots: [{ name: 'sted', valueKind: 'text', value: { text: 'skuret' } }],
      });
      id['fakta_kniv'] = knife.factId;
      knifeSlots = knife.slotIds;

      // Mordet sker. Anna er i huset, men opdager det ikke.
      id['mordet'] = createEvent(s, ctx, {
        title: 'Mordet', realmId: id['realm']!, earliest: 1 * DAY, latest: 1 * DAY, placeId: id['stuen'],
      });
      addParticipation(s, ctx, { eventId: id['mordet']!, entityId: id['teddy']!, role: 'actor' });
      addParticipation(s, ctx, { eventId: id['mordet']!, entityId: id['anna']!, role: 'present_unaware' });
      linkEventFact(s, ctx, { eventId: id['mordet']!, factId: id['fakta_mord']!, exposes: 'establishes' });

      // Dagen efter finder hun liget: hun får offeret at vide, ikke gerningsmanden.
      id['fundet'] = createEvent(s, ctx, {
        title: 'Anna finder liget', realmId: id['realm']!, earliest: 2 * DAY, latest: 2 * DAY, placeId: id['stuen'],
      });
      addParticipation(s, ctx, { eventId: id['fundet']!, entityId: id['anna']!, role: 'witness' });
      linkEventFact(s, ctx, {
        eventId: id['fundet']!, factId: id['fakta_mord']!, exposes: 'reveals',
        slotIds: [slots.get('offer')!],
      });

      recordPresence(s, ctx, {
        entityId: id['anna']!, placeId: id['stuen']!, realmId: id['realm']!,
        fromTime: 1 * DAY, toTime: 3 * DAY,
      });
      recordPresence(s, ctx, {
        entityId: id['teddy']!, placeId: id['stuen']!, realmId: id['realm']!,
        fromTime: 1 * DAY, toTime: 1 * DAY + 3600,
      });
    });

    solveTime(store, ctx);
  });

  after(() => store.close());

  it('giver kun de pladser, eventet faktisk blotlagde', () => {
    const known = whoKnewWhat(store, ctx, { entityId: id['anna']!, at: 2 * DAY });
    const mord = known.items.find((i) => i.factId === id['fakta_mord']);
    assert.ok(mord, 'Anna skal vide, at Peter blev dræbt');
    assert.equal(mord!.binds['offer'], 'Peter');
    assert.equal(mord!.binds['gerningsmand'], undefined,
      'at finde liget siger hvem der døde, ikke hvem der gjorde det');
  });

  it('lader den, der var til stede uden at opdage det, blive uvidende', () => {
    const known = whoKnewWhat(store, ctx, { entityId: id['anna']!, at: 1 * DAY + 60 });
    assert.equal(known.items.length, 0, 'hun var i huset, men opdagede intet');
  });

  it('lader en regel på personen udløbe oplevet viden uden at røre det nedskrevne', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Anna glemmer hurtigt' }, (s) => {
      recordMemoryPolicy(s, ctx, {
        entityId: id['anna']!, fromPersonal: 2 * DAY, retentionSeconds: 3600,
      });
    });

    const fresh = whoKnewWhat(store, ctx, { entityId: id['anna']!, at: 2 * DAY + 1800 });
    assert.ok(fresh.items.some((i) => i.factId === id['fakta_mord'] && i.source === 'derived'));

    const forgotten = whoKnewWhat(store, ctx, { entityId: id['anna']!, at: 2 * DAY + 3600 });
    assert.ok(!forgotten.items.some((i) => i.factId === id['fakta_mord']),
      'oplevelsen falder bort præcis ved fastholdelsesgrænsen');
  });

  it('lader en nedskrevet overbevisning slå det udledte', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Anna mistænker Bo' }, (s) => {
      recordBelief(s, ctx, {
        entityId: id['anna']!, factId: id['fakta_mord']!, strength: 'mistaken',
        sincePersonal: 3 * DAY, slotIds: slots,
        binds: { gerningsmand: { entityId: id['bo'] }, offer: { entityId: id['peter'] } },
      });
    });

    const known = whoKnewWhat(store, ctx, { entityId: id['anna']!, at: 4 * DAY });
    const mord = known.items.find((i) => i.factId === id['fakta_mord'])!;
    assert.equal(mord.source, 'stated');
    assert.equal(mord.strength, 'mistaken');
    assert.equal(mord.binds['gerningsmand'], 'Bo', 'hun tror det var Bo, og det skal kunne ses');
  });

  it('regner en seddel i lommen med — og kun mens den er der', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Seddel om kniven' }, (s) => {
      attachFactToCarrier(s, ctx, {
        objectEntityId: id['seddel']!, factId: id['fakta_kniv']!,
        slotIds: knifeSlots, binds: { sted: { text: 'skuret' } },
      });
      recordPossession(s, ctx, {
        holderEntityId: id['anna']!, objectEntityId: id['seddel']!,
        fromTime: 5 * DAY, toTime: 6 * DAY,
      });
    });

    const withNote = whoKnewWhat(store, ctx, { entityId: id['anna']!, at: 5 * DAY + 3600 });
    const carried = withNote.items.find((i) => i.factId === id['fakta_kniv']);
    assert.ok(carried, 'med sedlen på sig ved hun, hvor kniven er');
    assert.equal(carried!.source, 'carried');
    assert.equal(carried!.viaObject, 'Sammenkrøllet seddel');

    const without = whoKnewWhat(store, ctx, { entityId: id['anna']!, at: 7 * DAY });
    assert.equal(without.items.find((i) => i.factId === id['fakta_kniv']), undefined,
      'sedlen er lagt fra sig, og så ved hun det ikke længere');
  });

  it('lader en overbevisning udløbe', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Han glemmer det igen' }, (s) => {
      recordBelief(s, ctx, {
        entityId: id['teddy']!, factId: id['fakta_kniv']!, strength: 'knows',
        sincePersonal: 1 * DAY, untilPersonal: 2 * DAY,
      });
    });
    const before = whoKnewWhat(store, ctx, { entityId: id['teddy']!, at: 1.5 * DAY });
    const after = whoKnewWhat(store, ctx, { entityId: id['teddy']!, at: 3 * DAY });
    assert.ok(before.items.some((i) => i.factId === id['fakta_kniv']));
    assert.ok(!after.items.some((i) => i.factId === id['fakta_kniv']), 'viden kan forsvinde igen');
  });

  it('svarer på hvem der var hvor', () => {
    const atMurder = whoWasWhere(store, ctx, { from: 1 * DAY + 600, placeId: id['stuen'] });
    assert.deepEqual(atMurder.map((p) => p.entityName).sort(), ['Anna', 'Teddy']);

    const later = whoWasWhere(store, ctx, { from: 2 * DAY, placeId: id['stuen'] });
    assert.deepEqual(later.map((p) => p.entityName), ['Anna']);
  });

  it('holder læserens viden adskilt fra personernes', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Kapitler' }, (s) => {
      id['vaerk'] = createWork(s, ctx, { title: 'Mordgåden' });
      const k1 = createChapter(s, ctx, store, { workId: id['vaerk']!, title: 'Liget' });
      const k3 = createChapter(s, ctx, store, { workId: id['vaerk']!, title: 'Sandheden', position: 3 });
      const s1 = createScene(s, ctx, store, { chapterId: k1, povEntityId: id['anna'] });
      const s3 = createScene(s, ctx, store, { chapterId: k3, povEntityId: id['anna'] });
      // Læseren får offeret i kapitel 1 og gerningsmanden i kapitel 3.
      createReveal(s, ctx, { factId: id['fakta_mord']!, sceneId: s1, slotId: slots.get('offer')! });
      createReveal(s, ctx, { factId: id['fakta_mord']!, sceneId: s3, slotId: slots.get('gerningsmand')! });
    });

    const afterOne = whatReaderKnows(store, ctx, { workId: id['vaerk']!, throughChapterPosition: 1 });
    assert.deepEqual(afterOne[0]!.slots, ['offer']);
    assert.equal(afterOne[0]!.complete, false, 'twistet er ikke givet væk endnu');

    const afterThree = whatReaderKnows(store, ctx, { workId: id['vaerk']!, throughChapterPosition: 3 });
    assert.deepEqual(afterThree[0]!.slots.sort(), ['gerningsmand', 'offer']);
    assert.equal(afterThree[0]!.complete, true);
    assert.equal(afterThree[0]!.firstChapter, 1, 'faktummet blev åbnet i kapitel 1');
  });

  it('løser tiden og skriver de fundne grænser tilbage', () => {
    const report = solveTime(store, ctx);
    assert.equal(report.findings.length, 0);
    const events = store.sqlite.prepare('select solved_earliest from "event" where id = ?')
      .get(id['fundet']) as { solved_earliest: number };
    assert.equal(events.solved_earliest, 2 * DAY);
  });
});
