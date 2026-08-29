import { inTurn } from '../core/changelog';
import type { Store } from '../db/client';
import { SECONDS, parseInstant } from '../core/time/gregorian';
import { createEntity, recordPresence } from '../core/services/entities';
import { addParticipation, createEvent } from '../core/services/events';
import { createFact } from '../core/services/knowledge';
import { createLaw } from '../core/services/laws';
import { createChapter, createScene, linkSceneToEvent } from '../core/services/narrative';
import { createRealm, createWorld, createWork, defaultTimeSystemOf } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { updateRow } from '../core/services/generic';

const MIN = SECONDS.MINUTE;

/**
 * Inception, as a test of nested realms.
 *
 * Four layers, each running twenty times faster than the one above it, pinned
 * to each other so their clocks can actually be compared. Ten minutes in the
 * van is over eight weeks at the bottom, and the model has to be able to say
 * both numbers about the same stretch of time without either being wrong.
 *
 * It also carries the two laws the film needs and every dream story needs
 * differently: what happens to a body upstairs, and whether you remember the
 * dream when you wake. Neither is something the tool should guess.
 *
 * Loaded: the four layers, their ratios and their entrances and exits.
 */
export function loadInception(store: Store): { worldId: string; workId: string; realmIds: string[] } {
  const created = createWorld(store, {
    name: 'Inception',
    summary: 'Prøvecase: lag inden i lag, med hvert sit ur.',
  });
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: created.worldId, userId: created.userId });
  const reality = created.realmId;
  const epoch = parseInstant('2010-07-16T12:00').earliest;
  let workId = '';
  const realmIds: string[] = [reality];

  inTurn(store, {
    branchId: ctx.branchId,
    actor: { kind: 'system' },
    summary: 'Indlæs Inception',
  }, (s) => {
    workId = createWork(s, ctx, { title: 'Inception' });
    const timeSystemId = defaultTimeSystemOf(store, ctx);

    const cobb = createEntity(s, ctx, { name: 'Cobb', kind: 'person' });
    const van = createEntity(s, ctx, { name: 'Varevognen', kind: 'place' });
    const hotel = createEntity(s, ctx, { name: 'Hotellet', kind: 'place' });
    const fortress = createEntity(s, ctx, { name: 'Snefæstningen', kind: 'place' });
    const limbo = createEntity(s, ctx, { name: 'Kysten', kind: 'place' });

    // Hvert lag er tyve gange hurtigere end det over, og fæstnet til det på det
    // øjeblik, man går ind. Uden holdepunktet siger forholdet kun hvor hurtigt
    // laget løber, ikke hvornår det begyndte.
    let parent = reality;
    const places = [van, hotel, fortress, limbo];
    const names = ['Regnvejret i varevognen', 'Hotellet', 'Snefæstningen', 'Kysten'];
    for (let level = 1; level <= 3; level += 1) {
      const id = createRealm(s, ctx, {
        name: `Drøm, lag ${level}`, kind: 'dream', parentRealmId: parent,
        timeSystemId, timeRatio: 20, parentEpoch: epoch, localEpoch: epoch,
        summary: `${names[level]} — tyve gange hurtigere end laget over.`,
      });
      realmIds.push(id);
      parent = id;
    }

    // Én sammenhængende strækning, set fra fire ure på én gang.
    const entry = createEvent(s, ctx, {
      title: 'Man falder i søvn', realmId: reality, placeId: van,
      earliest: epoch, latest: epoch, precision: 'minute',
    });
    const exit = createEvent(s, ctx, {
      title: 'Sparket', realmId: reality, placeId: van,
      earliest: epoch + 10 * MIN, latest: epoch + 10 * MIN, precision: 'minute',
    });
    addParticipation(s, ctx, { eventId: entry, entityId: cobb, role: 'actor' });
    addParticipation(s, ctx, { eventId: exit, entityId: cobb, role: 'actor' });

    realmIds.slice(1).forEach((realmId, index) => {
      const level = index + 1;
      const localSpan = 10 * MIN * 20 ** level;
      const inside = createEvent(s, ctx, {
        title: `Arbejdet i lag ${level}`, realmId, placeId: places[level],
        earliest: epoch, latest: epoch + localSpan,
        durationMin: localSpan, precision: 'minute',
      });
      addParticipation(s, ctx, { eventId: inside, entityId: cobb, role: 'actor' });
      recordPresence(s, ctx, {
        entityId: cobb, placeId: places[level]!, realmId,
        fromTime: epoch, toTime: epoch + localSpan,
      });
      updateRow(s, store, {
        table: 'realm', id: realmId,
        patch: { entryEventId: entry, exitEventId: exit },
      });
    });

    // Kroppen sover i laget over, mens personen arbejder i laget under. Det er
    // ikke bilokation, og reglen skal vide det.
    recordPresence(s, ctx, { entityId: cobb, placeId: van, realmId: reality, fromTime: epoch, toTime: epoch + 10 * MIN });

    createFact(s, ctx, {
      predicate: 'kan_ikke_doe', summary: 'Man vågner af at dø i en drøm', realmId: realmIds[1]!,
      slots: [{ name: 'lag', valueKind: 'text', value: { text: 'drøm' } }],
    });

    createLaw(s, ctx, {
      kind: 'ability', hardness: 'hard', ruleCode: 'bilocation',
      scopeKind: 'world',
      statement: 'Kroppen bliver i laget over, mens personen handler i laget under. '
        + 'Samme person i to lag på samme tid er ikke bilokation.',
    });
    createLaw(s, ctx, {
      kind: 'prohibition', hardness: 'soft',
      statement: 'Man husker drømmen, når man vågner — i denne verden. '
        + 'I de fleste andre historier gør man ikke, og så skal denne lov skiftes ud.',
    });

    const chapterId = createChapter(s, ctx, store, { workId, title: 'Nedstigningen' });
    realmIds.forEach((realmId, level) => {
      const sceneId = createScene(s, ctx, store, {
        chapterId, title: level === 0 ? 'Varevognen' : `Lag ${level}`,
        povEntityId: cobb, narrationPerson: 'third_limited', narrationTense: 'past', realmId,
      });
      if (level === 0) linkSceneToEvent(s, ctx, { sceneId, eventId: entry, mode: 'dramatised' });
    });
  });

  bench.setActive({ worldId: created.worldId, workId });
  return { worldId: created.worldId, workId, realmIds };
}
