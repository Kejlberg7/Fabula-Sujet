import { inTurn } from '../core/changelog';
import type { Store } from '../db/client';
import { SECONDS, parseInstant } from '../core/time/gregorian';
import {
  createEntity, createIdentity, createLeg, createPlaceLink, recordPresence,
} from '../core/services/entities';
import { addParticipation, addTemporalLink, createEvent, linkEventFact } from '../core/services/events';
import { createFact, recordBelief, recordStatement } from '../core/services/knowledge';
import {
  createChapter, createReveal, createScene, linkSceneToEvent, saveSceneText,
} from '../core/services/narrative';
import { createWorld, createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { markdownOf, paragraphs } from './prose';

const YEAR = Math.round(365.2425 * SECONDS.DAY);
const DAY = SECONDS.DAY;
const HOUR = SECONDS.HOUR;

/**
 * Predestination, as a test of personal time.
 *
 * One person, four legs, four names, and an evening where two of the legs share
 * a room. Everything here would be an error in a model that indexes knowledge
 * on world time: the same person is in two places at once, and the world clock
 * runs backwards between one leg and the next.
 *
 * None of it is an error. Bilocation needs the same *leg*; a life needs only to
 * run one way in its own time. If this fixture loads clean, the model has the
 * distinction right.
 *
 * The narrative side is where it earns its keep. Nine scenes across five
 * chapters, told from three different legs of the same person -- so the same
 * fact is unknown, suspected and known depending only on which self the scene
 * is seen through. That is not a variation the model can fake: it falls out of
 * indexing knowledge on the leg, or it does not happen at all.
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
    workId = createWork(s, ctx, {
      title: 'Predestination',
      summary: 'Én verdenslinje, fortalt fra fire steder på den.',
    });

    const traveller = createEntity(s, ctx, {
      name: 'Den rejsende', kind: 'person',
      summary: 'Én person. Fire navne, fire aldre, én verdenslinje.',
    });
    const robertson = createEntity(s, ctx, {
      name: 'Robertson', kind: 'person', summary: 'Rekrutterer. Ved mere, end han siger.',
    });
    const bar = createEntity(s, ctx, { name: 'Baren', kind: 'place' });
    const orphanage = createEntity(s, ctx, { name: 'Børnehjemmet', kind: 'place' });
    const agency = createEntity(s, ctx, { name: 'Bureauet', kind: 'place' });
    const clinic = createEntity(s, ctx, { name: 'Klinikken', kind: 'place' });
    const street = createEntity(s, ctx, { name: 'Gaden i New York', kind: 'place' });

    // Rejsetid i verdens tid. Selve springene mellem ben er ikke rejser og
    // rammes ikke af den — det er præcis dét, benene findes for.
    const route = (from: string, to: string, hours: number) =>
      createPlaceLink(s, ctx, {
        realmId, fromPlaceId: from, toPlaceId: to, mode: 'i bil', travelMin: hours * HOUR,
      });
    route(bar, agency, 1);
    route(bar, street, 1);
    route(orphanage, agency, 3);
    route(clinic, agency, 2);

    const asJane = createIdentity(s, ctx, { entityId: traveller, name: 'Jane' });
    const asJohn = createIdentity(s, ctx, { entityId: traveller, name: 'John' });
    const asBarkeep = createIdentity(s, ctx, { entityId: traveller, name: 'Bartenderen' });
    const asBomber = createIdentity(s, ctx, { entityId: traveller, name: 'Bomberen' });

    // Sandheden bag hele historien. Sandhedsværdien er kendt af os; ingen af
    // benene kender den, før det tredje gør.
    const identityFact = createFact(s, ctx, {
      predicate: 'er_samme_person', summary: 'Jane, John og bartenderen er den samme',
      realmId, slots: [{ name: 'person', valueKind: 'entity', value: { entityId: traveller } }],
    });
    // Den anden sløjfe, og den værste: han bliver til det, han jager.
    const bomberFact = createFact(s, ctx, {
      predicate: 'er_bomberen', summary: 'Bartenderen bliver til bomberen', realmId,
      slots: [{ name: 'person', valueKind: 'entity', value: { entityId: traveller } }],
    });
    const parentFact = createFact(s, ctx, {
      predicate: 'er_foraelder', summary: 'Barnet på børnehjemmet er hendes eget',
      realmId, slots: [
        { name: 'foraelder', valueKind: 'entity', value: { entityId: traveller } },
        { name: 'barn', valueKind: 'entity', value: { entityId: traveller } },
      ],
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
    /**
     * Et bens verdensvindue skal rumme alt, benet besøger -- også det, det
     * rejser tilbage til. Bartenderen lægger barnet på trappen i 1945 og står
     * bag disken i 1970, så hans vindue er begge dele. Sattes det til 1955,
     * ville liv-og-alder-reglen melde afleveringen som noget, der sker før han
     * findes -- og den ville have ret.
     */
    const leg3 = createLeg(s, ctx, store, {
      entityId: traveller, ordinal: 3, label: 'som bartenderen',
      personalStart: 33 * YEAR, personalEnd: 65 * YEAR,
      worldStart: at(1945), worldEnd: at(1977), identityId: asBarkeep,
    });
    // Benet skal række til og med den scene, det er med i. Sat til 1975 sluttede
    // det et døgn før «Han finder bomberen», og liv-og-alder-reglen meldte det.
    const leg4 = createLeg(s, ctx, store, {
      entityId: traveller, ordinal: 4, label: 'som bomberen',
      personalStart: 65 * YEAR, personalEnd: 71 * YEAR,
      worldStart: at(1970), worldEnd: at(1976), identityId: asBomber,
    });

    // -------------------------------------------------------------- kronologien
    const born = createEvent(s, ctx, {
      title: 'Barnet efterlades på børnehjemmet', realmId, placeId: orphanage,
      earliest: at(1945), latest: at(1945) + DAY, precision: 'day',
    });
    // `latest` binder STARTEN, ikke slutningen: barndommen begynder i 1945 og
    // varer atten år. Sattes latest til 1963, kunne den begynde i 1963 og løbe
    // til 1981 — og så ville hun stadig være på børnehjemmet, da hun blev hvervet.
    const childhood = createEvent(s, ctx, {
      title: 'Jane vokser op på børnehjemmet', realmId, placeId: orphanage,
      earliest: at(1945), latest: at(1945) + 30 * DAY,
      durationMin: 18 * YEAR, precision: 'year',
    });
    const recruited = createEvent(s, ctx, {
      title: 'Robertson tilbyder Jane en fremtid', realmId, placeId: agency,
      earliest: at(1963) + 90 * DAY, latest: at(1963) + 120 * DAY, precision: 'month',
    });
    const surgery = createEvent(s, ctx, {
      title: 'Operationen', realmId, placeId: clinic,
      earliest: at(1964), latest: at(1964) + 60 * DAY, durationMin: 30 * DAY, precision: 'month',
    });
    const meeting = createEvent(s, ctx, {
      title: 'Aftenen i baren', realmId, placeId: bar,
      earliest: at(1970), latest: at(1970) + 4 * HOUR, durationMin: 2 * HOUR, precision: 'hour',
    });
    const recruitedAgain = createEvent(s, ctx, {
      title: 'John hverves af bureauet', realmId, placeId: agency,
      earliest: at(1970) + 7 * DAY, latest: at(1970) + 30 * DAY, precision: 'month',
    });
    const bombing = createEvent(s, ctx, {
      title: 'Bomben i gaden', realmId, placeId: street,
      earliest: at(1975), latest: at(1975) + DAY, durationMin: HOUR, precision: 'day',
    });
    const lastMeeting = createEvent(s, ctx, {
      title: 'Han finder bomberen', realmId, placeId: street,
      earliest: at(1975) + DAY, latest: at(1975) + 2 * DAY, durationMin: HOUR, precision: 'day',
    });

    // ----------------------------------------------------------------- hvem var
    addParticipation(s, ctx, { eventId: born, entityId: traveller, legId: leg3, role: 'actor' });
    // Hun er spædbarnet på trappen. Rollen er offer, men hun tager ingenting
    // til sig — og uden det flag ville modellen mene, at Jane har vidst hvem
    // hun var, siden hun var en time gammel.
    addParticipation(s, ctx, {
      eventId: born, entityId: traveller, legId: leg1, role: 'victim',
      absorbsKnowledge: false,
    });
    addParticipation(s, ctx, { eventId: childhood, entityId: traveller, legId: leg1, role: 'actor' });
    addParticipation(s, ctx, { eventId: recruited, entityId: traveller, legId: leg1, role: 'actor' });
    addParticipation(s, ctx, { eventId: recruited, entityId: robertson, role: 'actor' });
    addParticipation(s, ctx, { eventId: surgery, entityId: traveller, legId: leg1, role: 'victim' });
    addParticipation(s, ctx, { eventId: meeting, entityId: traveller, legId: leg2, role: 'actor' });
    addParticipation(s, ctx, { eventId: meeting, entityId: traveller, legId: leg3, role: 'actor' });
    addParticipation(s, ctx, { eventId: recruitedAgain, entityId: traveller, legId: leg2, role: 'actor' });
    addParticipation(s, ctx, { eventId: recruitedAgain, entityId: robertson, role: 'actor' });
    addParticipation(s, ctx, { eventId: bombing, entityId: traveller, legId: leg4, role: 'actor' });
    addParticipation(s, ctx, { eventId: lastMeeting, entityId: traveller, legId: leg3, role: 'actor' });
    addParticipation(s, ctx, { eventId: lastMeeting, entityId: traveller, legId: leg4, role: 'actor' });

    recordPresence(s, ctx, {
      entityId: traveller, legId: leg2, placeId: bar, realmId,
      fromTime: at(1970), toTime: at(1970) + 4 * HOUR,
    });
    recordPresence(s, ctx, {
      entityId: traveller, legId: leg3, placeId: bar, realmId,
      fromTime: at(1970), toTime: at(1970) + 4 * HOUR,
    });

    // Sløjfen: i verdens tid ligger afleveringen 25 år FØR mødet, men i
    // personens egen tid ligger den efter. Det er tidsrejse, ikke en fejl.
    addTemporalLink(s, ctx, {
      fromEventId: meeting, toEventId: born, kind: 'before', axis: 'personal', legId: leg3,
      note: 'Bartenderen tager af sted efter aftenen i baren, og lander før den.',
    });
    addTemporalLink(s, ctx, {
      fromEventId: lastMeeting, toEventId: bombing, kind: 'after', axis: 'personal', legId: leg4,
      note: 'Bomberen har allerede sprængt den, når han bliver fundet.',
    });

    linkEventFact(s, ctx, { eventId: born, factId: identityFact.factId, exposes: 'establishes' });
    linkEventFact(s, ctx, { eventId: born, factId: parentFact.factId, exposes: 'establishes' });
    linkEventFact(s, ctx, { eventId: lastMeeting, factId: bomberFact.factId, exposes: 'reveals' });

    // -------------------------------------------------------------------- viden
    // Kun de sene ben ved det. Det er hele pointen med at indeksere viden på
    // personlig tid frem for på verdens.
    for (const [leg, from] of [[leg3, 33 * YEAR], [leg4, 65 * YEAR]] as const) {
      recordBelief(s, ctx, {
        entityId: traveller, legId: leg, factId: identityFact.factId, strength: 'knows',
        sincePersonal: from, slotIds: identityFact.slotIds,
        binds: { person: { entityId: traveller } },
      });
      recordBelief(s, ctx, {
        entityId: traveller, legId: leg, factId: parentFact.factId, strength: 'knows',
        sincePersonal: from, slotIds: parentFact.slotIds,
        binds: { foraelder: { entityId: traveller }, barn: { entityId: traveller } },
      });
    }
    recordBelief(s, ctx, {
      entityId: traveller, legId: leg1, factId: identityFact.factId, strength: 'unaware',
      sincePersonal: 0,
    });
    recordBelief(s, ctx, {
      entityId: traveller, legId: leg2, factId: identityFact.factId, strength: 'unaware',
      sincePersonal: 25 * YEAR,
    });
    // Bartenderen aner det længe før han ved det. Mistanke er en styrke for
    // sig, ikke halv viden — og det er den, hele tredje akt hviler på.
    recordBelief(s, ctx, {
      entityId: traveller, legId: leg3, factId: bomberFact.factId, strength: 'suspects',
      sincePersonal: 40 * YEAR,
    });
    recordBelief(s, ctx, {
      entityId: traveller, legId: leg4, factId: bomberFact.factId, strength: 'knows',
      sincePersonal: 65 * YEAR, slotIds: bomberFact.slotIds,
      binds: { person: { entityId: traveller } },
    });
    recordBelief(s, ctx, {
      entityId: robertson, factId: identityFact.factId, strength: 'knows',
      sincePersonal: at(1945), slotIds: identityFact.slotIds,
      binds: { person: { entityId: traveller } },
      note: 'Han har vidst det hele tiden. Derfor rekrutterer han hende.',
    });

    // Bartenderen fortæller sandt om noget, han faktisk ved — og han gør det
    // til den, det handler om, uden at hun opdager det.
    recordStatement(s, ctx, {
      speakerEntityId: traveller, speakerLegId: leg3, factId: identityFact.factId,
      truthful: true, eventId: meeting, audienceEntityId: traveller,
      atTime: at(1970) + HOUR, slotIds: identityFact.slotIds,
      binds: { person: { entityId: traveller } },
      note: 'Han fortæller det hele. John hører det som en anden mands historie.',
    });
    // Robertson lyver ved at holde inde. En løgn er en handling, ikke en fejl.
    recordStatement(s, ctx, {
      speakerEntityId: robertson, factId: identityFact.factId, truthful: false,
      eventId: recruited, audienceEntityId: traveller, atTime: at(1963) + DAY,
      note: 'Han siger, det er et tilfælde, at han fandt hende.',
    });

    // --------------------------------------------------------------- fortællingen
    interface SceneSpec {
      title: string;
      event: string;
      leg?: string;
      pov?: string;
      mode?: 'dramatised' | 'mentioned' | 'implied';
      reveals?: { factId: string; slotId?: string; strength: 'hinted' | 'implied' | 'stated' | 'confirmed' }[];
      prose?: string[];
    }

    const book: { title: string; summary: string; scenes: SceneSpec[] }[] = [
      {
        title: 'Manden der kom ind fra gaden',
        summary: 'Aftenen i baren, set af den der fortæller.',
        scenes: [
          {
            title: 'Jeg fortæller ham det hele', event: meeting, leg: leg2,
            reveals: [{ factId: identityFact.factId, strength: 'hinted' }],
            prose: [
              'Han tørrer af på det samme sted i disken, mens jeg taler, og han spørger aldrig om noget, jeg ikke allerede har svaret på.',
              'Jeg har fortalt historien før. Aldrig til nogen, der lyttede sådan her.',
            ],
          },
          { title: 'Barnet, som det bliver fortalt', event: born, leg: leg2, mode: 'mentioned' },
        ],
      },
      {
        title: 'Den anden side af baren',
        summary: 'Den samme aften, set af den der ved besked.',
        scenes: [
          {
            title: 'Jeg har hørt den historie før', event: meeting, leg: leg3,
            reveals: [{
              factId: identityFact.factId,
              slotId: identityFact.slotIds.get('person'), strength: 'confirmed',
            }],
            prose: [
              'Han fortæller det i den rækkefølge, jeg husker at have fortalt det, og han holder pause de samme steder.',
              'Jeg skænker op, når han skal bruge et sekund. Det er det eneste, jeg kan gøre for ham nu.',
            ],
          },
          { title: 'Hvad der venter ham', event: recruitedAgain, leg: leg3, mode: 'implied' },
        ],
      },
      {
        title: 'Børnehjemmet',
        summary: 'Årene før nogen fortalte hende noget.',
        scenes: [
          { title: 'Jane, atten år', event: childhood, leg: leg1 },
          { title: 'Robertson kommer på besøg', event: recruited, leg: leg1,
            reveals: [{ factId: identityFact.factId, strength: 'hinted' }] },
          { title: 'Klinikken', event: surgery, leg: leg1 },
        ],
      },
      {
        title: 'Afleveringen',
        summary: 'Det tidligste, der sker, og det næstsidste, han gør.',
        scenes: [
          {
            title: 'Han lægger barnet fra sig', event: born, leg: leg3,
            reveals: [{
              factId: parentFact.factId,
              slotId: parentFact.slotIds.get('barn'), strength: 'confirmed',
            }],
            prose: [
              'Hun vejer ingenting. Han bliver stående længere, end han har lov til, og så går han tilbage til bilen.',
              'Der er ikke noget at fortryde. Det er allerede sket.',
            ],
          },
        ],
      },
      {
        title: 'Gaden',
        summary: 'Sløjfen lukker sig.',
        scenes: [
          { title: 'Bomben', event: bombing, leg: leg4 },
          { title: 'Han ser sig selv i øjnene', event: lastMeeting, leg: leg3,
            reveals: [{
              factId: bomberFact.factId,
              slotId: bomberFact.slotIds.get('person'), strength: 'confirmed',
            }] },
        ],
      },
    ];

    book.forEach((chapter, chapterIndex) => {
      const chapterId = createChapter(s, ctx, store, {
        workId, title: chapter.title, position: chapterIndex + 1, summary: chapter.summary,
      });
      chapter.scenes.forEach((spec, sceneIndex) => {
        const sceneId = createScene(s, ctx, store, {
          chapterId, title: spec.title, position: sceneIndex + 1,
          povEntityId: spec.pov ?? traveller, povLegId: spec.leg,
          narrationPerson: 'first', narrationTense: 'past', realmId,
        });
        linkSceneToEvent(s, ctx, {
          sceneId, eventId: spec.event, mode: spec.mode ?? 'dramatised',
        });
        for (const shown of spec.reveals ?? []) {
          createReveal(s, ctx, {
            factId: shown.factId, sceneId, slotId: shown.slotId, strength: shown.strength,
          });
        }
        if (spec.prose) {
          saveSceneText(s, ctx, store, {
            sceneId, doc: paragraphs(...spec.prose), markdown: markdownOf(...spec.prose),
          });
        }
      });
    });
  });

  bench.setActive({ worldId: created.worldId, workId });
  return { worldId: created.worldId, workId };
}
