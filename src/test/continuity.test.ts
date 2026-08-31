import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inTurn } from '../core/changelog';
import {
  createEntity, createIdentity, createRelationship, recordDisappearance,
  recordEntityState, recordPossession,
} from '../core/services/entities';
import { addParticipation, createEvent } from '../core/services/events';
import { createLaw, createSource, linkSource } from '../core/services/laws';
import { createBeat, createThread } from '../core/services/narrative';
import { deleteRow } from '../core/services/generic';
import { createWork } from '../core/services/world';
import { runRules } from '../core/rules';
import { SECONDS } from '../core/time/gregorian';
import { Workbench } from '../core/workbench';
import { makeWorld } from './helpers';

const T = 1_000_000_000;
const DAY = SECONDS.DAY;

function world() {
  const made = makeWorld();
  const bench = new Workbench(made.store);
  const ctx = bench.setActive({ worldId: made.worldId, userId: made.userId });
  return { ...made, bench, ctx };
}

function build<T>(w: ReturnType<typeof world>, fn: Parameters<typeof inTurn<T>>[2]): T {
  return inTurn(w.store, { branchId: w.ctx.branchId, actor: { kind: 'user' } }, fn);
}

describe('Genstandskontinuitet', () => {
  it('fanger samme fysiske ting hos to personer på samme tid', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const bo = createEntity(s, w.ctx, { name: 'Bo', kind: 'person' });
      const key = createEntity(s, w.ctx, { name: 'Nøglen', kind: 'object' });
      recordPossession(s, w.ctx, {
        holderEntityId: anna, objectEntityId: key, fromTime: T, toTime: T + 2 * DAY,
      });
      recordPossession(s, w.ctx, {
        holderEntityId: bo, objectEntityId: key, fromTime: T + DAY, toTime: T + 3 * DAY,
      });
    });
    const found = runRules(w.store, w.ctx, ['object_continuity']).findings;
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /Nøglen.*Anna.*Bo/);
  });

  it('tillader et rent skift, men ikke to modstridende tilstande', () => {
    const w = world();
    build(w, (s) => {
      const door = createEntity(s, w.ctx, { name: 'Døren', kind: 'object' });
      recordEntityState(s, w.store, w.ctx, {
        entityId: door, category: 'lås', value: 'låst', fromTime: T, toTime: T + DAY,
      });
      recordEntityState(s, w.store, w.ctx, {
        entityId: door, category: 'lås', value: 'åben', fromTime: T + DAY, toTime: T + 2 * DAY,
      });
      recordEntityState(s, w.store, w.ctx, {
        entityId: door, category: 'lås', value: 'låst', fromTime: T + DAY + 1, toTime: T + 2 * DAY,
      });
    });
    const found = runRules(w.store, w.ctx, ['object_continuity']).findings;
    assert.equal(found.length, 1, 'grænsen er ren; kun det egentlige overlap meldes');
    assert.match(found[0]!.message, /åben.*låst/);
  });
});

describe('Relationstilstand', () => {
  it('bruger kun en udtrykkelig kategori til at afgøre hvad der udelukker hinanden', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const bo = createEntity(s, w.ctx, { name: 'Bo', kind: 'person' });
      createRelationship(s, w.ctx, {
        fromEntityId: anna, toEntityId: bo, kind: 'loyal', category: 'alliance',
        fromTime: T, toTime: T + 2 * DAY,
      });
      createRelationship(s, w.ctx, {
        fromEntityId: anna, toEntityId: bo, kind: 'forråder', category: 'alliance',
        fromTime: T + DAY, toTime: T + 3 * DAY,
      });
      createRelationship(s, w.ctx, {
        fromEntityId: anna, toEntityId: bo, kind: 'søster',
        fromTime: T, toTime: T + 3 * DAY,
      });
    });
    const found = runRules(w.store, w.ctx, ['relationship_state']).findings;
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /loyal.*forråder/);
  });
});

describe('Setups og payoffs', () => {
  it('finder kun det setup der ikke har et senere payoff', () => {
    const w = world();
    build(w, (s) => {
      const workId = createWork(s, w.ctx, { title: 'Bogen' });
      const paid = createThread(s, w.ctx, { workId, name: 'Brevet' });
      createBeat(s, w.ctx, { threadId: paid, kind: 'setup', summary: 'Et forseglet brev', position: 1 });
      createBeat(s, w.ctx, { threadId: paid, kind: 'payoff', summary: 'Brevet åbnes', position: 9 });
      const loose = createThread(s, w.ctx, { workId, name: 'Nøglen' });
      createBeat(s, w.ctx, { threadId: loose, kind: 'setup', summary: 'En rusten nøgle', position: 2 });
    });
    const found = runRules(w.store, w.ctx, ['dangling_setup']).findings;
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /Nøglen.*rusten nøgle/);
  });

  it('lader en evne løfte reglen', () => {
    const w = world();
    build(w, (s) => {
      const workId = createWork(s, w.ctx, { title: 'Bogen' });
      const loose = createThread(s, w.ctx, { workId, name: 'Nøglen' });
      createBeat(s, w.ctx, { threadId: loose, kind: 'setup', summary: 'En rusten nøgle', position: 2 });
    });
    assert.equal(runRules(w.store, w.ctx, ['dangling_setup']).findings.length, 1);

    build(w, (s) => createLaw(s, w.ctx, {
      kind: 'ability', hardness: 'hard', ruleCode: 'dangling_setup',
      statement: 'Bogen slutter med løse ender. Det er meningen.',
    }));
    const out = runRules(w.store, w.ctx, ['dangling_setup']);
    assert.deepEqual(out.findings, []);
    assert.equal(out.lifted.length, 1, 'det står stadig, som løftet af en lov');
  });
});

describe('Navne og identiteter', () => {
  it('melder en identitet brugt efter dens tidsrum', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const alias = createIdentity(s, w.ctx, {
        entityId: anna, name: 'Den røde ræv', validFrom: T, validTo: T + DAY,
      });
      const late = createEvent(s, w.ctx, {
        title: 'Maskeballet', realmId: w.realmId,
        earliest: T + 3 * DAY, latest: T + 3 * DAY,
      });
      addParticipation(s, w.ctx, {
        eventId: late, entityId: anna, identityId: alias, role: 'actor',
      });
    });
    const found = runRules(w.store, w.ctx, ['name_or_identity']).findings;
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /Den røde ræv.*ophørt/);
  });
});

describe('Forsvindinger', () => {
  it('fanger en sikker optræden inde i hullet og lader tilbagekomsten stå', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const gone = createEvent(s, w.ctx, {
        title: 'Anna forsvinder', realmId: w.realmId, earliest: T, latest: T,
      });
      const seen = createEvent(s, w.ctx, {
        title: 'På stationen', realmId: w.realmId,
        earliest: T + 2 * DAY, latest: T + 2 * DAY,
      });
      const back = createEvent(s, w.ctx, {
        title: 'Anna vender hjem', realmId: w.realmId,
        earliest: T + 5 * DAY, latest: T + 5 * DAY,
      });
      addParticipation(s, w.ctx, { eventId: seen, entityId: anna, role: 'actor' });
      addParticipation(s, w.ctx, { eventId: back, entityId: anna, role: 'actor' });
      recordDisappearance(s, w.ctx, {
        entityId: anna, disappearsEventId: gone, returnsEventId: back,
      });
    });
    const found = runRules(w.store, w.ctx, ['disappearance']).findings;
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /På stationen/);
  });
});

describe('Researchkilder', () => {
  it('viser kun en modstrid som forfatteren udtrykkeligt har markeret', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const context = createSource(s, w.ctx, { title: 'Kortet', kind: 'image' });
      linkSource(s, w.ctx, {
        sourceId: context, targetKind: 'entity', targetId: anna, relation: 'context',
      });
      const conflict = createSource(s, w.ctx, { title: 'Lærebogen', kind: 'pdf' });
      linkSource(s, w.ctx, {
        sourceId: conflict, targetKind: 'entity', targetId: anna, relation: 'conflicts',
        note: 'Alderen passer muligvis ikke.',
      });
    });
    const found = runRules(w.store, w.ctx, ['source_conflict']).findings;
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /Lærebogen.*ikke læst/);
  });

  it('lader en evne løfte reglen', () => {
    const w = world();
    build(w, (s) => {
      const anna = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const conflict = createSource(s, w.ctx, { title: 'Lærebogen', kind: 'pdf' });
      linkSource(s, w.ctx, {
        sourceId: conflict, targetKind: 'entity', targetId: anna, relation: 'conflicts',
      });
      createLaw(s, w.ctx, {
        kind: 'ability', hardness: 'hard', ruleCode: 'source_conflict',
        statement: 'Bogen afviger fra kilderne med vilje.',
      });
    });
    const out = runRules(w.store, w.ctx, ['source_conflict']);
    assert.deepEqual(out.findings, []);
    assert.equal(out.lifted.length, 1);
  });
});

/**
 * Fladen er dansk, også når databasen siger fra.
 *
 * En sletning, der ikke kan lade sig gøre, er et svar til forfatteren. Navnene
 * på det, der står i vejen, hører til fase 15; sætningen hører til her.
 */
describe('En sletning, der ikke kan lade sig gøre', () => {
  it('svarer på dansk i stedet for at videregive SQLite', () => {
    const w = world();
    const anna = build(w, (s) => {
      const who = createEntity(s, w.ctx, { name: 'Anna', kind: 'person' });
      const e = createEvent(s, w.ctx, { title: 'Middagen', realmId: w.realmId, earliest: T, latest: T });
      addParticipation(s, w.ctx, { eventId: e, entityId: who, role: 'actor' });
      return who;
    });
    assert.throws(
      () => build(w, (s) => deleteRow(s, w.store, { table: 'entity', id: anna })),
      /stadig noget i historien, der peger på den/,
    );
  });
});
