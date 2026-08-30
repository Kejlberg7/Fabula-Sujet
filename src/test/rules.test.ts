import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openStore } from '../db/client';
import { event as eventTable } from '../db/schema';
import { inTurn } from '../core/changelog';
import {
  createEntity, createLeg, createPlaceLink, recordPossession, recordPresence,
} from '../core/services/entities';
import { addParticipation, createEvent } from '../core/services/events';
import { createFact, recordBelief, recordStatement, attachFactToCarrier } from '../core/services/knowledge';
import { createLaw } from '../core/services/laws';
import { dismissFinding, revokeDismissal } from '../core/services/findings';
import { runRules } from '../core/rules';
import { review, openFindings } from '../core/review';
import { SECONDS } from '../core/time/gregorian';
import { Workbench } from '../core/workbench';
import { loadInception, loadMemento, loadPredestination } from '../fixtures';
import { makeWorld } from './helpers';

const HOUR = SECONDS.HOUR;
const DAY = SECONDS.DAY;
const T = 1_000_000_000;

/**
 * The rules are only worth having if they stay quiet.
 *
 * Half of these tests are about silence: a vague date that could be arranged
 * some other way, a different leg of the same life, a different layer of the
 * world. A tool that fires on those is a tool that gets switched off, and then
 * the ones that matter are never read either.
 */

function world() {
  const w = makeWorld();
  const bench = new Workbench(w.store);
  const ctx = bench.setActive({ worldId: w.worldId, userId: w.userId });
  return { ...w, bench, ctx };
}

function build<T>(w: ReturnType<typeof world>, work: Parameters<typeof inTurn<T>>[2]): T {
  return inTurn(w.store, { branchId: w.ctx.branchId, actor: { kind: 'user' } }, work);
}

describe('Bilokation', () => {
  it('melder to steder på samme tid for det samme ben', () => {
    const w = world();
    const found = build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      const there = createEntity(s, w.ctx, { name: 'Havnen', kind: 'place' });
      for (const [title, place] of [['Middagen', here], ['Skibet', there]] as const) {
        const e = createEvent(s, w.ctx, {
          title, realmId: w.realmId, placeId: place,
          earliest: T, latest: T, durationMin: 2 * HOUR,
        });
        addParticipation(s, w.ctx, { eventId: e, entityId: anna, role: 'actor' });
      }
      return anna;
    });
    const out = runRules(w.store, w.ctx, ['bilocation']);
    assert.equal(out.findings.length, 1);
    assert.match(out.findings[0]!.message, /Anna/);
    assert.ok(out.findings[0]!.subjects.entities?.includes(found));
  });

  it('tier, når tiden er uskarp nok til at de kan skilles ad', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      const there = createEntity(s, w.ctx, { name: 'Havnen', kind: 'place' });
      // «En gang den uge» begge to. Der findes en rækkefølge, der går op.
      for (const [title, place] of [['Middagen', here], ['Skibet', there]] as const) {
        const e = createEvent(s, w.ctx, {
          title, realmId: w.realmId, placeId: place,
          earliest: T, latest: T + 7 * DAY, durationMin: HOUR,
        });
        addParticipation(s, w.ctx, { eventId: e, entityId: anna, role: 'actor' });
      }
    });
    assert.deepEqual(runRules(w.store, w.ctx, ['bilocation']).findings, [],
      'uskarpt er ikke det samme som umuligt');
  });

  it('lader to ben af det samme liv være i to rum', () => {
    const w = world();
    build(w, (s) => {
      const her = createEntity(s, w.ctx, { name: 'Den rejsende', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      const there = createEntity(s, w.ctx, { name: 'Havnen', kind: 'place' });
      const legA = createLeg(s, w.ctx, w.store, { entityId: her, ordinal: 1, label: 'ung' });
      const legB = createLeg(s, w.ctx, w.store, { entityId: her, ordinal: 2, label: 'gammel' });
      for (const [title, place, leg] of [
        ['Middagen', here, legA], ['Skibet', there, legB],
      ] as const) {
        const e = createEvent(s, w.ctx, {
          title, realmId: w.realmId, placeId: place,
          earliest: T, latest: T, durationMin: 2 * HOUR,
        });
        addParticipation(s, w.ctx, { eventId: e, entityId: her, role: 'actor', legId: leg });
      }
    });
    assert.deepEqual(runRules(w.store, w.ctx, ['bilocation']).findings, [],
      'tidsrejse er ikke en fejl');
  });

  it('lader en evne løfte reglen', () => {
    const w = world();
    const anna = build(w, (s) => {
      const who = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      const there = createEntity(s, w.ctx, { name: 'Havnen', kind: 'place' });
      for (const [title, place] of [['Middagen', here], ['Skibet', there]] as const) {
        const e = createEvent(s, w.ctx, {
          title, realmId: w.realmId, placeId: place,
          earliest: T, latest: T, durationMin: 2 * HOUR,
        });
        addParticipation(s, w.ctx, { eventId: e, entityId: who, role: 'actor' });
      }
      return who;
    });
    build(w, (s) => createLaw(s, w.ctx, {
      kind: 'ability', hardness: 'hard', ruleCode: 'bilocation',
      subjectKind: 'entity', subjectEntityId: anna,
      statement: 'Anna kan være to steder på én gang.',
    }));
    const out = runRules(w.store, w.ctx, ['bilocation']);
    assert.deepEqual(out.findings, []);
    assert.equal(out.lifted.length, 1, 'det står stadig, som løftet af en lov');
  });
});

describe('Rejsetid', () => {
  const twoPlaces = (travelMin: number, gap: number) => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      const there = createEntity(s, w.ctx, { name: 'Havnen', kind: 'place' });
      createPlaceLink(s, w.ctx, {
        realmId: w.realmId, fromPlaceId: here, toPlaceId: there,
        mode: 'til fods', travelMin,
      });
      const first = createEvent(s, w.ctx, {
        title: 'Middagen', realmId: w.realmId, placeId: here,
        earliest: T, latest: T, durationMin: HOUR,
      });
      addParticipation(s, w.ctx, { eventId: first, entityId: anna, role: 'actor' });
      const second = createEvent(s, w.ctx, {
        title: 'Skibet', realmId: w.realmId, placeId: there,
        earliest: T + HOUR + gap, latest: T + HOUR + gap, durationMin: HOUR,
      });
      addParticipation(s, w.ctx, { eventId: second, entityId: anna, role: 'actor' });
    });
    return { w, out: runRules(w.store, w.ctx, ['travel_time']) };
  };

  it('melder en tur, der ikke kan nås', () => {
    const { out } = twoPlaces(6 * HOUR, HOUR);
    assert.equal(out.findings.length, 1);
    assert.match(out.findings[0]!.message, /Huset.*Havnen/s);
  });

  it('tier, når der er tid nok', () => {
    assert.deepEqual(twoPlaces(HOUR, 6 * HOUR).out.findings, []);
  });

  it('finder ikke på afstande, der ikke er skrevet ned', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      const there = createEntity(s, w.ctx, { name: 'Havnen', kind: 'place' });
      const first = createEvent(s, w.ctx, {
        title: 'Middagen', realmId: w.realmId, placeId: here, earliest: T, latest: T,
      });
      addParticipation(s, w.ctx, { eventId: first, entityId: anna, role: 'actor' });
      const second = createEvent(s, w.ctx, {
        title: 'Skibet', realmId: w.realmId, placeId: there,
        earliest: T + 60, latest: T + 60,
      });
      addParticipation(s, w.ctx, { eventId: second, entityId: anna, role: 'actor' });
    });
    assert.deepEqual(runRules(w.store, w.ctx, ['travel_time']).findings, [],
      'uden en rute er der ingen afstand at overtræde');
  });

  /**
   * Grænsen mellem de to regler, prøvet af.
   *
   * Et ophold er ikke et krav om, at hun aldrig gik ud — derfor tier
   * bilokationen om et ærinde midt i et ophold. Men hvis ærindet ligger for
   * langt væk til, at turen kan nås, er det stadig umuligt, og det siger
   * rejsetiden. Uden den skelnen ville enten alle ærinder blive meldt, eller
   * også ville «hun var i Australien hele juni» aldrig blive fanget.
   */
  it('fanger et ærinde, der ligger for langt fra opholdet', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const away = createEntity(s, w.ctx, { name: 'Australien', kind: 'place' });
      const home = createEntity(s, w.ctx, { name: 'Oslo', kind: 'place' });
      createPlaceLink(s, w.ctx, {
        realmId: w.realmId, fromPlaceId: away, toPlaceId: home,
        mode: 'med fly', travelMin: 2 * DAY,
      });
      recordPresence(s, w.ctx, {
        entityId: anna, placeId: away, realmId: w.realmId,
        fromTime: T, toTime: T + 30 * DAY,
      });
      // Dagen efter hun ankommer, og turen tager to dage.
      const meeting = createEvent(s, w.ctx, {
        title: 'Mødet', realmId: w.realmId, placeId: home,
        earliest: T + DAY, latest: T + DAY,
      });
      addParticipation(s, w.ctx, { eventId: meeting, entityId: anna, role: 'actor' });
    });

    assert.deepEqual(runRules(w.store, w.ctx, ['bilocation']).findings, [],
      'et ophold er ikke et krav om, at hun aldrig gik ud');
    const travel = runRules(w.store, w.ctx, ['travel_time']).findings;
    assert.ok(travel.length > 0, 'men turen kan ikke nås, og det er stadig umuligt');
    assert.match(travel[0]!.message, /Australien|Oslo/);
  });

  it('tier, når hun har tid til at flyve frem og tilbage', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const away = createEntity(s, w.ctx, { name: 'Australien', kind: 'place' });
      const home = createEntity(s, w.ctx, { name: 'Oslo', kind: 'place' });
      createPlaceLink(s, w.ctx, {
        realmId: w.realmId, fromPlaceId: away, toPlaceId: home,
        mode: 'med fly', travelMin: 2 * DAY,
      });
      recordPresence(s, w.ctx, {
        entityId: anna, placeId: away, realmId: w.realmId,
        fromTime: T, toTime: T + 30 * DAY,
      });
      const meeting = createEvent(s, w.ctx, {
        title: 'Mødet', realmId: w.realmId, placeId: home,
        earliest: T + 10 * DAY, latest: T + 10 * DAY,
      });
      addParticipation(s, w.ctx, { eventId: meeting, entityId: anna, role: 'actor' });
    });
    assert.deepEqual(runRules(w.store, w.ctx, ['travel_time']).findings, [],
      'ti dage inde i opholdet er der god tid til en tur på to dage');
  });

  it('kun en evne løfter den', () => {
    const { w } = twoPlaces(6 * HOUR, HOUR);
    build(w, (s) => createLaw(s, w.ctx, {
      kind: 'ability', hardness: 'hard', ruleCode: 'travel_time',
      statement: 'I denne verden kan man rejse øjeblikkeligt.',
    }));
    const out = runRules(w.store, w.ctx, ['travel_time']);
    assert.deepEqual(out.findings, []);
    assert.equal(out.lifted.length, 1);
  });
});

describe('Liv og alder', () => {
  it('melder en person, der er med efter benet er slut', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      createLeg(s, w.ctx, w.store, {
        entityId: anna, ordinal: 1, worldStart: T - DAY, worldEnd: T,
      });
      const late = createEvent(s, w.ctx, {
        title: 'Begravelsen', realmId: w.realmId, placeId: here,
        earliest: T + 30 * DAY, latest: T + 30 * DAY,
      });
      addParticipation(s, w.ctx, { eventId: late, entityId: anna, role: 'actor' });
    });
    const out = runRules(w.store, w.ctx, ['life_span']);
    assert.equal(out.findings.length, 1);
    assert.match(out.findings[0]!.message, /efter/);
  });

  it('tier, når det ligger inde i benet', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      createLeg(s, w.ctx, w.store, {
        entityId: anna, ordinal: 1, worldStart: T - DAY, worldEnd: T + DAY,
      });
      const e = createEvent(s, w.ctx, {
        title: 'Middagen', realmId: w.realmId, placeId: here, earliest: T, latest: T,
      });
      addParticipation(s, w.ctx, { eventId: e, entityId: anna, role: 'actor' });
    });
    assert.deepEqual(runRules(w.store, w.ctx, ['life_span']).findings, []);
  });
});

describe('Vidensbrud', () => {
  const speaking = (truthful: boolean, bindsCulprit: boolean) => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const peter = createEntity(s, w.ctx, { name: 'Peter', kind: 'person' });
      const killed = createFact(s, w.ctx, {
        predicate: 'draebte', summary: 'Nogen dræbte Peter', realmId: w.realmId,
        slots: [
          { name: 'gerningsmand', valueKind: 'entity', value: { entityId: peter } },
        ],
      });
      recordStatement(s, w.ctx, {
        speakerEntityId: anna, factId: killed.factId, truthful, atTime: T,
        ...(bindsCulprit
          ? { slotIds: killed.slotIds, binds: { gerningsmand: { entityId: peter } } }
          : {}),
      });
    });
    return runRules(w.store, w.ctx, ['knowledge_gap']);
  };

  it('melder en sand udtalelse om noget, taleren ikke ved', () => {
    const out = speaking(true, false);
    assert.equal(out.findings.length, 1);
    assert.match(out.findings[0]!.message, /Anna siger/);
  });

  it('lader en løgn være en løgn', () => {
    assert.deepEqual(speaking(false, false).findings, [],
      'at lyve er en handling, ikke en fejl');
  });

  it('fanger, at hun navngiver en plads, hun ikke har udfyldt', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const peter = createEntity(s, w.ctx, { name: 'Peter', kind: 'person' });
      const scene = createEntity(s, w.ctx, { name: 'Gyden', kind: 'place' });
      const killed = createFact(s, w.ctx, {
        predicate: 'draebte', summary: 'Nogen dræbte Peter', realmId: w.realmId,
        slots: [{ name: 'gerningsmand', valueKind: 'entity', value: { entityId: peter } }],
      });
      // Hun ved, at det er sket — men ikke af hvem.
      recordBelief(s, w.ctx, {
        entityId: anna, factId: killed.factId, strength: 'knows', sincePersonal: T - DAY,
      });
      recordStatement(s, w.ctx, {
        speakerEntityId: anna, factId: killed.factId, truthful: true, atTime: T,
        slotIds: killed.slotIds, binds: { gerningsmand: { entityId: scene } },
      });
    });
    const out = runRules(w.store, w.ctx, ['knowledge_gap']);
    assert.equal(out.findings.length, 1);
    assert.match(out.findings[0]!.message, /gerningsmand/);
  });
});

describe('Bæreren mangler', () => {
  it('melder en overbevisning, der hviler på noget, hun ikke har på sig', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const note = createEntity(s, w.ctx, { name: 'Sedlen', kind: 'object' });
      const truth = createFact(s, w.ctx, {
        predicate: 'moede', summary: 'Mødet er klokken ti', realmId: w.realmId, slots: [],
      });
      const written = attachFactToCarrier(s, w.ctx, {
        objectEntityId: note, factId: truth.factId,
      });
      // Sedlen ligger hjemme: ingen besiddelse på det tidspunkt.
      recordBelief(s, w.ctx, {
        entityId: anna, factId: truth.factId, strength: 'knows',
        sincePersonal: T, sourceCarrierId: written,
      });
      recordPossession(s, w.ctx, {
        holderEntityId: anna, objectEntityId: note,
        fromTime: T + 10 * DAY, toTime: T + 20 * DAY,
      });
    });
    const errors = runRules(w.store, w.ctx, ['missing_carrier']).findings
      .filter((f) => f.severity === 'error');
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /Sedlen/);
  });

  it('bemærker noget skrevet på en ting, ingen nogensinde bærer', () => {
    const w = world();
    build(w, (s) => {
      const note = createEntity(s, w.ctx, { name: 'Sedlen', kind: 'object' });
      const truth = createFact(s, w.ctx, {
        predicate: 'moede', summary: 'Mødet er klokken ti', realmId: w.realmId, slots: [],
      });
      attachFactToCarrier(s, w.ctx, { objectEntityId: note, factId: truth.factId });
    });
    const notes = runRules(w.store, w.ctx, ['missing_carrier']).findings
      .filter((f) => f.severity === 'note');
    assert.equal(notes.length, 1);
  });
});

describe('Gennemgangen', () => {
  it('holder mund om de tre prøvecases', () => {
    for (const load of [loadMemento, loadPredestination, loadInception]) {
      const store = openStore(':memory:');
      const { worldId, workId } = load(store);
      const ctx = new Workbench(store).setActive({ worldId, workId });
      const report = review(store, ctx);
      assert.deepEqual(
        { errors: report.counts.errors, warnings: report.counts.warnings, notes: report.counts.notes },
        { errors: 0, warnings: 0, notes: 0 },
        `${load.name} skal loade helt rent, fik: ${report.findings.map((f) => f.message).join(' / ')}`,
      );
    }
  });

  it('husker et fund på tværs af kørsler og lukker det, når det er rettet', () => {
    const w = world();
    const events: string[] = [];
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      const there = createEntity(s, w.ctx, { name: 'Havnen', kind: 'place' });
      for (const [title, place] of [['Middagen', here], ['Skibet', there]] as const) {
        const e = createEvent(s, w.ctx, {
          title, realmId: w.realmId, placeId: place,
          earliest: T, latest: T, durationMin: 2 * HOUR,
        });
        events.push(e);
        addParticipation(s, w.ctx, { eventId: e, entityId: anna, role: 'actor' });
      }
    });

    const first = review(w.store, w.ctx);
    assert.equal(first.counts.errors, 1);
    assert.equal(first.appeared, 1);
    const print = first.findings[0]!.fingerprint;

    // Samme problem, samme fingeraftryk. Ellers ville en afvisning aldrig holde.
    const again = review(w.store, w.ctx);
    assert.equal(again.appeared, 0);
    assert.equal(again.findings[0]!.fingerprint, print);

    // Ryk det ene event en uge væk, og fundet skal lukke sig selv.
    build(w, (s) => {
      s.update(eventTable, events[1]!, { earliest: T + 7 * DAY, latest: T + 7 * DAY });
    });
    const fixed = review(w.store, w.ctx);
    assert.equal(fixed.counts.errors, 0);
    assert.equal(fixed.resolved, 1);
    assert.deepEqual(openFindings(w.store, w.ctx), []);
  });

  it('lader en afvisning holde, og tage tilbage igen', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const here = createEntity(s, w.ctx, { name: 'Huset', kind: 'place' });
      const there = createEntity(s, w.ctx, { name: 'Havnen', kind: 'place' });
      for (const [title, place] of [['Middagen', here], ['Skibet', there]] as const) {
        const e = createEvent(s, w.ctx, {
          title, realmId: w.realmId, placeId: place,
          earliest: T, latest: T, durationMin: 2 * HOUR,
        });
        addParticipation(s, w.ctx, { eventId: e, entityId: anna, role: 'actor' });
      }
    });
    const print = review(w.store, w.ctx).findings[0]!.fingerprint;

    build(w, (s) => dismissFinding(s, w.ctx, w.store, {
      fingerprint: print, reason: 'Det er tvillingen. Det opdager læseren senere.',
    }));
    const after = review(w.store, w.ctx);
    assert.equal(after.counts.errors, 0, 'afvist tæller ikke med');
    assert.equal(after.counts.dismissed, 1, 'men den er der stadig');
    assert.match(after.findings[0]!.dismissedReason!, /tvillingen/);

    build(w, (s) => revokeDismissal(s, w.ctx, w.store, { fingerprint: print }));
    assert.equal(review(w.store, w.ctx).counts.errors, 1, 'og den kan tages tilbage');
  });

  it('kræver en grund til at afvise', () => {
    const w = world();
    assert.throws(() => build(w, (s) =>
      dismissFinding(s, w.ctx, w.store, { fingerprint: 'x', reason: '  ' })), /hvorfor/);
  });
});
