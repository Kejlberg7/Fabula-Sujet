import { inTurn } from '../core/changelog';
import type { Store } from '../db/client';
import { SECONDS, parseInstant } from '../core/time/gregorian';
import { createEntity, recordPossession, recordPresence } from '../core/services/entities';
import { addParticipation, createEvent, linkEventFact } from '../core/services/events';
import { attachFactToCarrier, createFact, recordBelief } from '../core/services/knowledge';
import { createChapter, createReveal, createScene, linkSceneToEvent } from '../core/services/narrative';
import { createWorld, createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';

const DAY = SECONDS.DAY;
const MIN = SECONDS.MINUTE;
const start = parseInstant('2000-03-01').earliest;

/**
 * Memento, as a test of the model rather than a retelling.
 *
 * Two things are being pressed on here. The colour strand is told backwards, so
 * chapter order and chronology run in opposite directions -- if the two axes
 * were one field, this fixture could not be written down at all. And Leonard
 * cannot form new memories, so his beliefs expire while what is written on his
 * polaroids does not: the difference between what he remembers and what he
 * knows is the whole character, and it has to survive being modelled.
 *
 * Loaded: the five colour scenes, the black-and-white strand that carries the
 * Sammy Jankis account, and nothing else. The rest is padding for our purposes.
 */
export function loadMemento(store: Store): { worldId: string; workId: string } {
  const created = createWorld(store, {
    name: 'Memento',
    summary: 'Prøvecase: fortællerorden mod kronologi, og viden der forsvinder.',
  });
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: created.worldId, userId: created.userId });
  const realmId = created.realmId;
  let workId = '';

  inTurn(store, {
    branchId: ctx.branchId,
    actor: { kind: 'system' },
    summary: 'Indlæs Memento',
  }, (s) => {
    workId = createWork(s, ctx, { title: 'Memento', summary: 'Farvesporet plus Sammy Jankis-sporet' });

    const leonard = createEntity(s, ctx, { name: 'Leonard', kind: 'person', summary: 'Kan ikke danne nye erindringer' });
    const teddy = createEntity(s, ctx, { name: 'Teddy', kind: 'person' });
    const natalie = createEntity(s, ctx, { name: 'Natalie', kind: 'person' });
    const motel = createEntity(s, ctx, { name: 'Motellet', kind: 'place' });
    const bar = createEntity(s, ctx, { name: 'Baren', kind: 'place' });
    const polaroid = createEntity(s, ctx, { name: 'Polaroid af Teddy', kind: 'object' });

    // Sandheden om Teddy er netop dét, filmen nægter at afgøre. "undecided" er
    // et fortællegreb, ikke sjusk, og motoren skal lade det være.
    const teddyFact = createFact(s, ctx, {
      predicate: 'kan_stoles_paa', summary: 'Teddy kan ikke stoles på', realmId,
      truth: 'undecided',
      slots: [{ name: 'person', valueKind: 'entity', value: { entityId: teddy } }],
    });

    const sammyFact = createFact(s, ctx, {
      predicate: 'sammy_findes', summary: 'Sammy Jankis er en anden end Leonard', realmId,
      truth: 'disputed',
      slots: [{ name: 'person', valueKind: 'text', value: { text: 'Sammy Jankis' } }],
    });

    // Kronologien: fem sort-hvide og derefter fem farvede.
    const bw = [1, 2, 3, 4, 5].map((n) =>
      createEvent(s, ctx, {
        title: `S/H ${n}: Leonard fortæller om Sammy`, realmId, placeId: motel,
        earliest: start + (n - 1) * DAY, latest: start + (n - 1) * DAY + 2 * 3600,
        durationMin: 30 * MIN, precision: 'hour',
      }));

    const colourStart = start + 5 * DAY;
    const colour = [1, 2, 3, 4, 5].map((n) =>
      createEvent(s, ctx, {
        title: `Farve ${n}`, realmId, placeId: n % 2 ? motel : bar,
        earliest: colourStart + (n - 1) * 3600 * 4,
        latest: colourStart + (n - 1) * 3600 * 4 + 3600,
        durationMin: 20 * MIN, precision: 'minute',
      }));

    for (const [index, id] of bw.entries()) {
      addParticipation(s, ctx, { eventId: id, entityId: leonard, role: 'actor' });
      if (index >= 2) linkEventFact(s, ctx, { eventId: id, factId: sammyFact.factId, exposes: 'evidences' });
    }
    for (const id of colour) {
      addParticipation(s, ctx, { eventId: id, entityId: leonard, role: 'actor' });
    }
    addParticipation(s, ctx, { eventId: colour[0]!, entityId: teddy, role: 'witness' });
    addParticipation(s, ctx, { eventId: colour[4]!, entityId: natalie, role: 'witness' });
    linkEventFact(s, ctx, { eventId: colour[0]!, factId: teddyFact.factId, exposes: 'evidences' });

    recordPresence(s, ctx, {
      entityId: leonard, placeId: motel, realmId,
      fromTime: start, toTime: colourStart + 5 * 3600 * 4,
    });

    // Han lærer det, og han glemmer det igen et kvarter senere.
    recordBelief(s, ctx, {
      entityId: leonard, factId: teddyFact.factId, strength: 'convinced',
      sincePersonal: colourStart, untilPersonal: colourStart + 15 * MIN,
      sourceEventId: colour[0], slotIds: teddyFact.slotIds,
      binds: { person: { entityId: teddy } },
      note: 'Erindringen holder et kvarter.',
    });

    // Polaroiden holder. Derfor skriver han på den.
    attachFactToCarrier(s, ctx, {
      objectEntityId: polaroid, factId: teddyFact.factId,
      slotIds: teddyFact.slotIds, binds: { person: { entityId: teddy } },
      writtenEventId: colour[0], note: 'Håndskrift på bagsiden: STOL IKKE PÅ HANS LØGNE',
    });
    recordPossession(s, ctx, {
      holderEntityId: leonard, objectEntityId: polaroid,
      fromTime: colourStart, toTime: colourStart + 30 * DAY,
    });

    // Fortællerorden: sort-hvid fremad, farve baglæns, flettet.
    const order: { title: string; event: string }[] = [];
    for (let i = 0; i < 5; i += 1) {
      order.push({ title: `S/H ${i + 1}`, event: bw[i]! });
      order.push({ title: `Farve ${5 - i}`, event: colour[4 - i]! });
    }
    order.forEach((entry, index) => {
      const chapterId = createChapter(s, ctx, store, {
        workId, title: entry.title, position: index + 1,
      });
      const sceneId = createScene(s, ctx, store, {
        chapterId, title: entry.title, povEntityId: leonard,
        narrationPerson: 'third_limited', narrationTense: 'present', realmId,
      });
      linkSceneToEvent(s, ctx, { sceneId, eventId: entry.event, mode: 'dramatised' });

      // Twistet om Teddy ligger sidst i læserækkefølgen og først i kronologien.
      if (index === order.length - 1) {
        createReveal(s, ctx, {
          factId: teddyFact.factId, sceneId,
          slotId: teddyFact.slotIds.get('person'), strength: 'confirmed',
        });
      }
    });
  });

  bench.setActive({ worldId: created.worldId, workId });
  return { worldId: created.worldId, workId };
}
