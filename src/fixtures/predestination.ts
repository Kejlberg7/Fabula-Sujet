import { inTurn } from '../core/changelog';
import type { Store } from '../db/client';
import { SECONDS, parseInstant } from '../core/time/gregorian';
import { createEntity, createIdentity, createLeg, recordPresence } from '../core/services/entities';
import { addParticipation, addTemporalLink, createEvent, linkEventFact } from '../core/services/events';
import { createFact, recordBelief } from '../core/services/knowledge';
import { createWorld, createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';

const YEAR = Math.round(365.2425 * SECONDS.DAY);

/**
 * Predestination, as a test of personal time.
 *
 * One person, three legs, three names, and an evening where two of the legs
 * share a room. Everything here would be an error in a model that indexes
 * knowledge on world time: the same person is in two places at once, and the
 * world clock runs backwards between one leg and the next.
 *
 * None of it is an error. Bilocation needs the same *leg*; a life needs only to
 * run one way in its own time. If this fixture loads clean, the model has the
 * distinction right.
 *
 * Loaded: the protagonist's worldline. The rest of the plot is not what presses
 * on the model.
 */
export function loadPredestination(store: Store): { worldId: string; workId: string } {
  const created = createWorld(store, {
    name: 'Predestination',
    summary: 'Prøvecase: personlig tid, selvmøder og flere identiteter.',
  });
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: created.worldId, userId: created.userId });
  const realmId = created.realmId;
  let workId = '';

  const at = (year: number) => parseInstant(String(year)).earliest;

  inTurn(store, {
    branchId: ctx.branchId,
    actor: { kind: 'system' },
    summary: 'Indlæs Predestination',
  }, (s) => {
    workId = createWork(s, ctx, { title: 'Predestination' });

    const traveller = createEntity(s, ctx, {
      name: 'Den rejsende', kind: 'person',
      summary: 'Én person. Tre navne, tre aldre, én verdenslinje.',
    });
    const bar = createEntity(s, ctx, { name: 'Baren', kind: 'place' });
    const orphanage = createEntity(s, ctx, { name: 'Børnehjemmet', kind: 'place' });

    const asJane = createIdentity(s, ctx, { entityId: traveller, name: 'Jane' });
    const asJohn = createIdentity(s, ctx, { entityId: traveller, name: 'John' });
    const asBarkeep = createIdentity(s, ctx, { entityId: traveller, name: 'Bartenderen' });

    // Sandheden bag hele historien. Sandhedsværdien er kendt af os; ingen af
    // benene kender den, før det sidste gør.
    const identityFact = createFact(s, ctx, {
      predicate: 'er_samme_person', summary: 'Jane, John og bartenderen er den samme',
      realmId, slots: [{ name: 'person', valueKind: 'entity', value: { entityId: traveller } }],
    });

    // Personlig tid stiger altid. Verdens tid gør ikke.
    const leg1 = createLeg(s, ctx, store, {
      entityId: traveller, ordinal: 1, label: 'som Jane',
      personalStart: 0, personalEnd: 25 * YEAR,
      worldStart: at(1945), worldEnd: at(1970), identityId: asJane,
    });
    const leg2 = createLeg(s, ctx, store, {
      entityId: traveller, ordinal: 2, label: 'som John',
      personalStart: 25 * YEAR, personalEnd: 33 * YEAR,
      worldStart: at(1963), worldEnd: at(1971), identityId: asJohn,
    });
    const leg3 = createLeg(s, ctx, store, {
      entityId: traveller, ordinal: 3, label: 'som bartenderen',
      personalStart: 33 * YEAR, personalEnd: 60 * YEAR,
      worldStart: at(1955), worldEnd: at(1985), identityId: asBarkeep,
    });

    // Aftenen i baren: to ben af samme menneske i samme rum.
    const meeting = createEvent(s, ctx, {
      title: 'Aftenen i baren', realmId, placeId: bar,
      earliest: at(1970), latest: at(1970) + 4 * 3600, durationMin: 2 * 3600, precision: 'hour',
    });
    addParticipation(s, ctx, { eventId: meeting, entityId: traveller, legId: leg2, role: 'actor' });
    addParticipation(s, ctx, { eventId: meeting, entityId: traveller, legId: leg3, role: 'actor' });
    recordPresence(s, ctx, {
      entityId: traveller, legId: leg2, placeId: bar, realmId,
      fromTime: at(1970), toTime: at(1970) + 4 * 3600,
    });
    recordPresence(s, ctx, {
      entityId: traveller, legId: leg3, placeId: bar, realmId,
      fromTime: at(1970), toTime: at(1970) + 4 * 3600,
    });

    const dropOff = createEvent(s, ctx, {
      title: 'Barnet efterlades på børnehjemmet', realmId, placeId: orphanage,
      earliest: at(1945), latest: at(1945) + SECONDS.DAY, precision: 'day',
    });
    addParticipation(s, ctx, { eventId: dropOff, entityId: traveller, legId: leg3, role: 'actor' });
    addParticipation(s, ctx, { eventId: dropOff, entityId: traveller, legId: leg1, role: 'victim' });

    // Sløjfen: i verdens tid ligger afleveringen 25 år FØR mødet, men i
    // personens egen tid ligger den efter. Det er tidsrejse, ikke en fejl.
    addTemporalLink(s, ctx, {
      fromEventId: meeting, toEventId: dropOff, kind: 'before', axis: 'personal', legId: leg3,
      note: 'Bartenderen tager af sted efter aftenen i baren, og lander før den.',
    });

    linkEventFact(s, ctx, { eventId: dropOff, factId: identityFact.factId, exposes: 'establishes' });

    // Kun det sidste ben ved det. Det er hele pointen med at indeksere viden
    // på personlig tid frem for på verdens.
    recordBelief(s, ctx, {
      entityId: traveller, legId: leg3, factId: identityFact.factId, strength: 'knows',
      sincePersonal: 33 * YEAR, slotIds: identityFact.slotIds,
      binds: { person: { entityId: traveller } },
    });
    recordBelief(s, ctx, {
      entityId: traveller, legId: leg1, factId: identityFact.factId, strength: 'unaware',
      sincePersonal: 0,
    });
  });

  bench.setActive({ worldId: created.worldId, workId });
  return { worldId: created.worldId, workId };
}
