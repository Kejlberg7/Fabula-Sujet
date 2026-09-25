import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import {
  compareBranches, createBranchFromHistory, lineageRoot, moveReveal, moveScene,
  setBranchArchived, setDefaultBranch, transferBranchDifference, workInBranch,
} from '../core/branches';
import { inTurn, undoTurn } from '../core/changelog';
import { createEntity, createRelationship } from '../core/services/entities';
import { addTemporalLink, createEvent } from '../core/services/events';
import { createFact } from '../core/services/knowledge';
import { createLaw } from '../core/services/laws';
import {
  createChapter, createReveal, createScene, createThread, saveSceneText,
} from '../core/services/narrative';
import { createWork } from '../core/services/world';
import { Workbench, type Context } from '../core/workbench';
import {
  branch, change, chapter, entity, event, fact, law, relationship, reveal, scene,
  sceneText, temporalLink, thread, turn, work,
} from '../db/schema';
import { makeWorld } from './helpers';

const actor = { kind: 'user' as const };

function story() {
  const world = makeWorld();
  const bench = new Workbench(world.store);
  let ctx = bench.setActive({ worldId: world.worldId, userId: world.userId });
  let workId = '';
  let chapterId = '';
  let firstSceneId = '';
  let secondSceneId = '';
  let revealId = '';
  let factId = '';
  let entityId = '';
  let eventId = '';
  let relationId = '';
  let lawId = '';
  let threadId = '';
  let temporalLinkId = '';
  let initialSeq = 0;
  inTurn(world.store, { branchId: ctx.branchId, actor, summary: 'Grundfortællingen' }, (session) => {
    workId = createWork(session, ctx, { title: 'Gåden' });
    chapterId = createChapter(session, ctx, world.store, { workId, title: 'Døren' });
    firstSceneId = createScene(session, ctx, world.store, { chapterId, title: 'Et vink' });
    secondSceneId = createScene(session, ctx, world.store, { chapterId, title: 'Svaret' });
    saveSceneText(session, ctx, world.store, {
      sceneId: firstSceneId, doc: { type: 'doc', content: [] }, markdown: 'Døren stod åben.',
    });
    saveSceneText(session, ctx, world.store, {
      sceneId: secondSceneId, doc: { type: 'doc', content: [] }, markdown: 'Bag døren ventede svaret.',
    });
    const secret = createFact(session, ctx, {
      predicate: 'portal', summary: 'Døren er en portal', realmId: world.realmId, slots: [],
    });
    factId = secret.factId;
    revealId = createReveal(session, ctx, {
      factId: secret.factId, sceneId: secondSceneId, strength: 'confirmed',
    });
    entityId = createEntity(session, ctx, {
      name: 'Ada', kind: 'person', summary: 'Hun finder døren.',
    });
    const otherEntityId = createEntity(session, ctx, { name: 'Bo', kind: 'person' });
    eventId = createEvent(session, ctx, {
      title: 'Ada finder døren', realmId: world.realmId, earliest: 100, latest: 200,
    });
    const otherEventId = createEvent(session, ctx, {
      title: 'Døren åbner', realmId: world.realmId, earliest: 300, latest: 400,
    });
    temporalLinkId = addTemporalLink(session, ctx, {
      fromEventId: eventId, toEventId: otherEventId, kind: 'before',
    });
    relationId = createRelationship(session, ctx, {
      fromEntityId: entityId, toEntityId: otherEntityId, kind: 'stoler på',
    });
    lawId = createLaw(session, ctx, {
      kind: 'prohibition', hardness: 'soft', statement: 'Døren åbner kun én gang.',
    });
    threadId = createThread(session, ctx, {
      workId, name: 'Den låste dør', summary: 'Hvorfor døren står åben.',
    });
  });
  initialSeq = world.store.db.select({ max: sql<number>`max(${change.seq})` }).from(change).get()!.max;
  ctx = bench.setActive({ worldId: world.worldId, workId, branchId: ctx.branchId });
  return {
    ...world, bench, ctx, workId, chapterId, firstSceneId, secondSceneId, revealId,
    factId, entityId, eventId, relationId, lawId, threadId, temporalLinkId, initialSeq,
  };
}

function fork(base: ReturnType<typeof story>, name = 'Tidligt svar') {
  return createBranchFromHistory(base.store, {
    sourceBranchId: base.ctx.branchId,
    sourceWorkId: base.workId,
    name,
    changeSeq: base.initialSeq,
    actor,
  });
}

describe('Fortællegrene', () => {
  it('genskaber det valgte historikpunkt uden at røre kildens senere ændringer', () => {
    const base = story();
    inTurn(base.store, { branchId: base.ctx.branchId, actor, summary: 'Omdøb scenen' }, (session) =>
      session.update(scene, base.firstSceneId, { title: 'Det meget tydelige vink' }));

    const created = fork(base);
    assert.notEqual(created.workId, base.workId);
    const childScenes = base.store.db.select().from(scene).where(eq(scene.branchId, created.branchId)).all();
    assert.ok(childScenes.some((item) => item.title === 'Et vink'), 'barnet skal se den gamle titel');
    assert.ok(!childScenes.some((item) => item.title === 'Det meget tydelige vink'));
    assert.equal(
      base.store.db.select().from(scene).where(eq(scene.id, base.firstSceneId)).get()!.title,
      'Det meget tydelige vink',
      'kilden må ikke rulles tilbage for at skabe barnet',
    );
  });

  it('giver alle narrative rækker nye id’er og peger deres interne forbindelser om', () => {
    const base = story();
    const created = fork(base);
    const childWork = base.store.db.select().from(work).where(eq(work.id, created.workId!)).get()!;
    const childChapter = base.store.db.select().from(chapter)
      .where(and(eq(chapter.branchId, created.branchId), eq(chapter.workId, childWork.id))).get()!;
    const childScenes = base.store.db.select().from(scene)
      .where(and(eq(scene.branchId, created.branchId), eq(scene.chapterId, childChapter.id))).all();
    const childTexts = base.store.db.select().from(sceneText)
      .where(eq(sceneText.branchId, created.branchId)).all();
    const childReveal = base.store.db.select().from(reveal)
      .where(eq(reveal.branchId, created.branchId)).get()!;

    assert.equal(childWork.originId, base.workId);
    assert.notEqual(childChapter.id, base.chapterId);
    assert.equal(childChapter.originId, base.chapterId);
    assert.equal(childScenes.length, 2);
    assert.ok(childTexts.every((text) => childScenes.some((item) => item.id === text.sceneId)));
    assert.ok(childScenes.some((item) => item.id === childReveal.sceneId));
    assert.equal(lineageRoot(base.store, 'reveal', childReveal.id), base.revealId);
    assert.equal(base.store.sqlite.pragma('integrity_check', { simple: true }), 'ok');
  });

  it('skifter bogens id med grenen i stedet for at beholde et id fra forælderen', () => {
    const base = story();
    const created = fork(base);
    const selected = base.bench.setActive({ worldId: base.worldId, branchId: created.branchId });
    assert.equal(selected.workId, created.workId);
    assert.equal(workInBranch(base.store, base.workId, created.branchId), created.workId);
  });

  it('sammenligner flyttede scener og afsløringer gennem deres fælles ophav', () => {
    const base = story();
    const created = fork(base);
    const childCtx: Context = {
      ...base.ctx, branchId: created.branchId, workId: created.workId,
    };
    const childChapter = base.store.db.select().from(chapter)
      .where(eq(chapter.branchId, created.branchId)).get()!;
    const childScenes = base.store.db.select().from(scene)
      .where(eq(scene.branchId, created.branchId)).all().sort((a, b) => a.position - b.position);
    const childReveal = base.store.db.select().from(reveal)
      .where(eq(reveal.branchId, created.branchId)).get()!;
    inTurn(base.store, { branchId: created.branchId, actor, summary: 'Prøv afsløringen tidligere' }, (session) => {
      moveScene(session, base.store, childCtx, {
        sceneId: childScenes[1]!.id, targetChapterId: childChapter.id, toIndex: 0,
      });
      moveReveal(session, base.store, childCtx, {
        revealId: childReveal.id, sceneId: childScenes[0]!.id, strength: 'hinted',
      });
    });
    const compared = compareBranches(base.store, {
      leftBranchId: base.ctx.branchId,
      rightBranchId: created.branchId,
      workId: base.workId,
    });
    assert.ok(compared.differences.some((item) => item.kind === 'scene_moved'));
    assert.ok(compared.differences.some((item) => item.kind === 'reveal_moved'));
    assert.ok(compared.differences.some((item) => item.kind === 'reveal_changed'));
  });

  it('sammenligner hele historiemodellen og markerer en ægte trevejskonflikt', () => {
    const base = story();
    const made = fork(base);
    const copied = <T extends { id: string; originId: string | null; branchId: string }>(
      rows: T[], originId: string,
    ) => rows.find((row) => row.branchId === made.branchId && row.originId === originId)!;
    const childEntity = copied(base.store.db.select().from(entity).all(), base.entityId);
    const childEvent = copied(base.store.db.select().from(event).all(), base.eventId);
    const childFact = copied(base.store.db.select().from(fact).all(), base.factId);
    const childLaw = copied(base.store.db.select().from(law).all(), base.lawId);
    const childRelation = copied(base.store.db.select().from(relationship).all(), base.relationId);
    const childThread = copied(base.store.db.select().from(thread).all(), base.threadId);
    const childLink = copied(base.store.db.select().from(temporalLink).all(), base.temporalLinkId);
    const childScene = copied(base.store.db.select().from(scene).all(), base.firstSceneId);

    inTurn(base.store, { branchId: made.branchId, actor, summary: 'Prøv en anden verden' }, (session) => {
      session.update(entity, childEntity.id, { description: 'Hun har allerede været her.' });
      session.update(event, childEvent.id, { title: 'Ada genfinder døren', earliest: 500 });
      session.update(fact, childFact.id, { truth: 'disputed' });
      session.update(law, childLaw.id, { statement: 'Døren åbner to gange.' });
      createLaw(session, { ...base.ctx, branchId: made.branchId, workId: made.workId }, {
        kind: 'prohibition', hardness: 'soft', statement: 'Ada må ikke sige navnet.',
        scopeKind: 'work', scopeId: made.workId!, subjectKind: 'entity',
        subjectEntityId: childEntity.id,
      });
      session.update(relationship, childRelation.id, { kind: 'mistænker' });
      session.update(thread, childThread.id, { summary: 'Hvem lukkede døren første gang?' });
      session.update(temporalLink, childLink.id, { kind: 'offset', offsetMin: 60, offsetMax: 60 });
      saveSceneText(session, { ...base.ctx, branchId: made.branchId, workId: made.workId }, base.store, {
        sceneId: childScene.id,
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Døren stod på klem.' }] }] },
        markdown: 'Døren stod på klem.',
      });
    });
    inTurn(base.store, { branchId: base.branchId, actor, summary: 'Ada ændres også' }, (session) =>
      session.update(entity, base.entityId, { description: 'Hun har aldrig set stedet.' }));

    const compared = compareBranches(base.store, {
      leftBranchId: base.branchId, rightBranchId: made.branchId, workId: base.workId,
    });
    for (const section of ['personer', 'events', 'tid', 'fakta', 'love', 'relationer', 'plottraade', 'prosa']) {
      assert.ok(compared.differences.some((item) => item.section === section), `mangler ${section}`);
    }
    assert.equal(compared.differences.find((item) => item.kind === 'entity_changed')?.conflict, true);
    assert.equal(compared.differences.find((item) => item.kind === 'time_changed')?.conflict, false);
    const prose = compared.differences.find((item) => item.kind === 'scene_prose_changed');
    assert.match(prose?.detail?.removed ?? '', /åben/);
    assert.match(prose?.detail?.added ?? '', /på klem/);

    const timeDifference = compared.differences.find((item) => item.kind === 'time_changed')!;
    inTurn(base.store, { branchId: base.branchId, actor, summary: 'Overfør tiden' }, (session) =>
      transferBranchDifference(session, base.store, {
        leftBranchId: base.branchId, rightBranchId: made.branchId,
        workId: base.workId, differenceId: timeDifference.id,
      }));
    assert.equal(base.store.db.select().from(event).where(eq(event.id, base.eventId)).get()!.earliest, 500);
    const transferTurn = base.store.db.select().from(turn).all()
      .find((item) => item.summary === 'Overfør tiden')!;
    undoTurn(base.store, transferTurn.id, actor);
    assert.equal(base.store.db.select().from(event).where(eq(event.id, base.eventId)).get()!.earliest, 100);

    const relationDifference = compared.differences.find((item) => item.kind === 'relationship_changed')!;
    inTurn(base.store, { branchId: base.branchId, actor, summary: 'Overfør relationen' }, (session) =>
      transferBranchDifference(session, base.store, {
        leftBranchId: base.branchId, rightBranchId: made.branchId,
        workId: base.workId, differenceId: relationDifference.id,
      }));
    const transferredRelation = base.store.db.select().from(relationship)
      .where(eq(relationship.id, base.relationId)).get()!;
    assert.equal(transferredRelation.kind, 'mistænker');
    assert.equal(transferredRelation.fromEntityId, base.entityId,
      'en overført forbindelse skal pege på målgrenens person');

    const lawDifference = compared.differences.find((item) => item.kind === 'law_changed')!;
    inTurn(base.store, { branchId: base.branchId, actor, summary: 'Overfør loven' }, (session) =>
      transferBranchDifference(session, base.store, {
        leftBranchId: base.branchId, rightBranchId: made.branchId,
        workId: base.workId, differenceId: lawDifference.id,
      }));
    assert.equal(base.store.db.select().from(law).where(eq(law.id, base.lawId)).get()!.statement,
      'Døren åbner to gange.');

    const addedLaw = compared.differences.find((item) => item.kind === 'law_added')!;
    inTurn(base.store, { branchId: base.branchId, actor, summary: 'Overfør ny lov' }, (session) =>
      transferBranchDifference(session, base.store, {
        leftBranchId: base.branchId, rightBranchId: made.branchId,
        workId: base.workId, differenceId: addedLaw.id,
      }));
    const insertedLaw = base.store.db.select().from(law)
      .where(and(eq(law.branchId, base.branchId), eq(law.statement, 'Ada må ikke sige navnet.'))).get()!;
    assert.equal(insertedLaw.scopeId, base.workId);
    assert.equal(insertedLaw.subjectEntityId, base.entityId);
    assert.equal(base.store.sqlite.pragma('integrity_check', { simple: true }), 'ok');
  });

  it('overfører prosa som en ny udgave og lader én fortrydelse tage hele turen tilbage', () => {
    const base = story();
    const made = fork(base);
    const childScene = base.store.db.select().from(scene).all()
      .find((item) => item.branchId === made.branchId && item.originId === base.firstSceneId)!;
    inTurn(base.store, { branchId: made.branchId, actor, summary: 'Skriv alternativ prosa' }, (session) =>
      saveSceneText(session, { ...base.ctx, branchId: made.branchId, workId: made.workId }, base.store, {
        sceneId: childScene.id,
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Døren var låst.' }] }] },
        markdown: 'Døren var låst.',
      }));
    const compared = compareBranches(base.store, {
      leftBranchId: base.branchId, rightBranchId: made.branchId, workId: base.workId,
    });
    const prose = compared.differences.find((item) => item.kind === 'scene_prose_changed')!;
    inTurn(base.store, { branchId: base.branchId, actor, summary: 'Overfør prosa' }, (session) =>
      transferBranchDifference(session, base.store, {
        leftBranchId: base.branchId, rightBranchId: made.branchId,
        workId: base.workId, differenceId: prose.id,
      }));
    const current = () => base.store.db.select().from(sceneText)
      .where(and(eq(sceneText.sceneId, base.firstSceneId), eq(sceneText.isCurrent, true))).get()!;
    assert.equal(current().markdown, 'Døren var låst.');
    const transferTurn = base.store.db.select().from(turn).all()
      .find((item) => item.summary === 'Overfør prosa')!;
    undoTurn(base.store, transferTurn.id, actor);
    assert.equal(current().markdown, 'Døren stod åben.');
  });

  /**
   * En gren skal kunne stå alene.
   *
   * Det var her det gik galt første gang: laget blev oprettet uden om
   * ændringsloggen, så øjebliksbilledet kunne ikke se det, og hver eneste event
   * på den nye gren pegede videre på forælderens lag. Sammenligningen mærkede
   * intet — den ser kun på fortællingen — men gennemgangen faldt med «Ukendt
   * lag», og tidslinjen ville have gjort det samme.
   *
   * Prøven går derfor på hele grenen: ingen række må pege på noget, der hører
   * til en anden gren.
   */
  it('efterlader ingen henvisninger ud af grenen', () => {
    const base = story();
    const made = fork(base);

    const branchScoped = base.store.sqlite.prepare(
      `select m.name as table_name from sqlite_master m
       where m.type = 'table' and exists (
         select 1 from pragma_table_info(m.name) c where c.name = 'branch_id'
       )`,
    ).all() as { table_name: string }[];

    const idsIn = (table: string, branchId: string) => new Set(
      (base.store.sqlite.prepare(`select id from "${table}" where branch_id = ?`)
        .all(branchId) as { id: string }[]).map((row) => row.id),
    );

    const strays: string[] = [];
    for (const { table_name: table } of branchScoped) {
      // `change` og `turn` hører til loggen selv og peger med vilje på fortiden.
      if (table === 'change' || table === 'turn' || table === 'checkpoint') continue;
      const columns = (base.store.sqlite.prepare(`pragma table_info("${table}")`).all() as
        { name: string }[]).map((c) => c.name);
      const rows = base.store.sqlite
        .prepare(`select * from "${table}" where branch_id = ?`)
        .all(made.branchId) as Record<string, unknown>[];

      for (const column of columns) {
        if (column === 'id' || column === 'branch_id' || column === 'origin_id') continue;
        if (!column.endsWith('_id')) continue;
        // Hvilken tabel peger kolonnen på? Kun de gren-delte er interessante.
        const target = branchScoped.map((t) => t.table_name)
          .find((t) => `${t}_id` === column || `${t.replace(/_/g, '')}_id` === column);
        if (!target) continue;
        const mine = idsIn(target, made.branchId);
        for (const row of rows) {
          const value = row[column];
          if (typeof value === 'string' && value && !mine.has(value)) {
            strays.push(`${table}.${column} → ${target} ${value}`);
          }
        }
      }
    }
    assert.deepEqual(strays, [], 'hver henvisning skal pege på grenens egen række');
  });

  it('bevarer grene ved valg og arkivering og logger oprettelsen på barnet', () => {
    const base = story();
    const created = fork(base);
    setDefaultBranch(base.store, created.branchId, actor);
    assert.equal(base.store.db.select().from(branch).where(eq(branch.id, created.branchId)).get()!.isDefault, true);
    assert.equal(base.store.db.select().from(branch).where(eq(branch.id, base.branchId)).get()!.isDefault, false);

    inTurn(base.store, { branchId: created.branchId, actor, summary: 'Arkivér originalen' }, (session) =>
      setBranchArchived(session, base.store, base.branchId, true));
    assert.ok(base.store.db.select().from(branch).where(eq(branch.id, base.branchId)).get()!.archivedAt);
    assert.ok(base.store.db.select().from(branch).where(eq(branch.id, created.branchId)).get());
    const creation = base.store.db.select().from(turn)
      .where(eq(turn.branchId, created.branchId)).all()
      .find((item) => item.summary === 'Opret gren: Tidligt svar');
    assert.ok(creation, 'branchens kopiering skal kunne ses og fortrydes på den nye gren');
  });
});
