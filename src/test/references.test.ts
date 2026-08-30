import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { createBranchFromHistory } from '../core/branches';
import { inTurn, undoLast } from '../core/changelog';
import { referenceBacklinks, referenceCatalog } from '../core/queries/references';
import { createEntity, createIdentity } from '../core/services/entities';
import { createEvent } from '../core/services/events';
import { createFact } from '../core/services/knowledge';
import {
  createChapter, createReveal, createScene, createTextAnchor, createThread,
} from '../core/services/narrative';
import { createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { change, entity, storyReference } from '../db/schema';
import { makeWorld } from './helpers';

const actor = { kind: 'user' as const };

function referencedStory() {
  const world = makeWorld();
  const bench = new Workbench(world.store);
  let ctx = bench.setActive({ worldId: world.worldId, userId: world.userId });
  let personId = '';
  let placeId = '';
  let objectId = '';
  let identityId = '';
  let eventId = '';
  let factId = '';
  let revealId = '';
  let sceneId = '';
  let threadId = '';
  let workId = '';

  inTurn(world.store, { branchId: ctx.branchId, actor, summary: 'Byg referenceprøven' }, (session) => {
    personId = createEntity(session, ctx, { name: 'Anna', kind: 'person' });
    placeId = createEntity(session, ctx, { name: 'Fyret', kind: 'place' });
    objectId = createEntity(session, ctx, { name: 'Nøglen', kind: 'object' });
    identityId = createIdentity(session, ctx, { entityId: personId, name: 'Den fremmede' });
    eventId = createEvent(session, ctx, { title: 'Døren åbnes', realmId: world.realmId });
    factId = createFact(session, ctx, {
      predicate: 'opens', summary: 'Nøglen åbner døren', realmId: world.realmId, slots: [],
    }).factId;
    workId = createWork(session, ctx, { title: 'Prøvebogen' });
    const chapterId = createChapter(session, ctx, world.store, { workId, title: 'Døren' });
    sceneId = createScene(session, ctx, world.store, { chapterId, title: 'Ved fyret' });
    revealId = createReveal(session, ctx, { factId, sceneId, strength: 'stated' });
    threadId = createThread(session, ctx, { workId, name: 'Den forsvundne nøgle' });
  });
  ctx = bench.setActive({ worldId: world.worldId, branchId: ctx.branchId, workId });
  return {
    ...world, bench, ctx, personId, placeId, objectId, identityId, eventId,
    factId, revealId, sceneId, threadId, workId,
  };
}

describe('arbejdsreferencer', () => {
  it('giver alle adresserbare typer en kort dansk arbejdskode i samme tur', () => {
    const made = referencedStory();
    try {
      const byTarget = new Map(referenceCatalog(made.store, made.ctx)
        .map((item) => [item.targetId, item.code]));
      assert.match(byTarget.get(made.personId)!, /^P\d+$/);
      assert.match(byTarget.get(made.placeId)!, /^S\d+$/);
      assert.match(byTarget.get(made.objectId)!, /^G\d+$/);
      assert.match(byTarget.get(made.identityId)!, /^I\d+$/);
      assert.match(byTarget.get(made.eventId)!, /^E\d+$/);
      assert.match(byTarget.get(made.factId)!, /^F\d+$/);
      assert.match(byTarget.get(made.revealId)!, /^A\d+$/);
      assert.match(byTarget.get(made.sceneId)!, /^SC\d+$/);
      assert.match(byTarget.get(made.threadId)!, /^T\d+$/);
    } finally {
      made.store.close();
    }
  });

  it('bevarer koden gennem omdøbning og omskriver ikke adressen', () => {
    const made = referencedStory();
    try {
      const before = referenceCatalog(made.store, made.ctx)
        .find((item) => item.targetId === made.objectId)!;
      inTurn(made.store, { branchId: made.ctx.branchId, actor, summary: 'Omdøb nøglen' }, (session) =>
        session.update(entity, made.objectId, { name: 'Den rustne nøgle' }));
      const after = referenceCatalog(made.store, made.ctx)
        .find((item) => item.targetId === made.objectId)!;
      assert.equal(after.code, before.code);
      assert.equal(after.label, 'Den rustne nøgle');
    } finally {
      made.store.close();
    }
  });

  it('kopierer samme kode til samme ting på en historiegren', () => {
    const made = referencedStory();
    try {
      const before = referenceCatalog(made.store, made.ctx)
        .find((item) => item.targetId === made.objectId)!;
      const seq = made.store.db.select({ max: sql<number>`max(${change.seq})` })
        .from(change).where(eq(change.branchId, made.ctx.branchId)).get()!.max;
      const fork = createBranchFromHistory(made.store, {
        sourceBranchId: made.ctx.branchId, sourceWorkId: made.workId,
        name: 'Nøglen findes tidligere', changeSeq: seq, actor,
      });
      const childCtx = { ...made.ctx, branchId: fork.branchId, workId: fork.workId };
      const childObject = made.store.db.select().from(entity)
        .where(eq(entity.originId, made.objectId)).all()
        .find((item) => item.branchId === fork.branchId)!;
      const after = referenceCatalog(made.store, childCtx)
        .find((item) => item.targetId === childObject.id)!;
      assert.equal(after.code, before.code);
      assert.notEqual(after.id, before.id);
    } finally {
      made.store.close();
    }
  });

  it('bevarer en slettet kode som en synligt brudt reference, og fortryd reparerer den', () => {
    const made = referencedStory();
    try {
      const code = referenceCatalog(made.store, made.ctx)
        .find((item) => item.targetId === made.objectId)!.code;
      inTurn(made.store, { branchId: made.ctx.branchId, actor, summary: 'Slet nøglen' }, (session) =>
        session.remove(entity, made.objectId));
      const broken = referenceCatalog(made.store, made.ctx).find((item) => item.code === code)!;
      assert.equal(broken.exists, false);
      assert.match(broken.label, /slettet/);

      undoLast(made.store, made.ctx.branchId, actor);
      const repaired = referenceCatalog(made.store, made.ctx).find((item) => item.code === code)!;
      assert.equal(repaired.exists, true);
      assert.equal(repaired.label, 'Nøglen');
    } finally {
      made.store.close();
    }
  });

  it('finder alle prosasteder, der peger tilbage på målet', () => {
    const made = referencedStory();
    try {
      inTurn(made.store, { branchId: made.ctx.branchId, actor, summary: 'Omtal nøglen' }, (session) =>
        createTextAnchor(session, made.ctx, {
          sceneId: made.sceneId, markId: 'mark-noeglen', targetKind: 'entity',
          targetId: made.objectId, excerpt: 'Nøglen lå kold i hendes hånd.',
        }));
      const hits = referenceBacklinks(made.store, made.ctx, {
        targetKind: 'entity', targetId: made.objectId,
      });
      assert.equal(hits.length, 1);
      assert.equal(hits[0]!.sceneTitle, 'Ved fyret');
      assert.equal(hits[0]!.workTitle, 'Prøvebogen');
      assert.match(hits[0]!.href, /mark-noeglen/);
    } finally {
      made.store.close();
    }
  });

  it('fortryder målet og dets kode som én handling', () => {
    const world = makeWorld();
    try {
      const bench = new Workbench(world.store);
      const ctx = bench.setActive({ worldId: world.worldId, userId: world.userId });
      let objectId = '';
      inTurn(world.store, { branchId: ctx.branchId, actor, summary: 'Opret kompasset' }, (session) => {
        objectId = createEntity(session, ctx, { name: 'Kompasset', kind: 'object' });
      });
      assert.ok(world.store.db.select().from(storyReference)
        .where(eq(storyReference.targetId, objectId)).get());
      undoLast(world.store, ctx.branchId, actor);
      assert.equal(world.store.db.select().from(entity).where(eq(entity.id, objectId)).get(), undefined);
      assert.equal(world.store.db.select().from(storyReference)
        .where(eq(storyReference.targetId, objectId)).get(), undefined);
    } finally {
      world.store.close();
    }
  });
});
