import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import {
  compareBranches, createBranchFromHistory, lineageRoot, moveReveal, moveScene,
  setBranchArchived, setDefaultBranch, workInBranch,
} from '../core/branches';
import { inTurn } from '../core/changelog';
import { createFact } from '../core/services/knowledge';
import {
  createChapter, createReveal, createScene, saveSceneText,
} from '../core/services/narrative';
import { createWork } from '../core/services/world';
import { Workbench, type Context } from '../core/workbench';
import { branch, change, chapter, reveal, scene, sceneText, turn, work } from '../db/schema';
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
    revealId = createReveal(session, ctx, {
      factId: secret.factId, sceneId: secondSceneId, strength: 'confirmed',
    });
  });
  initialSeq = world.store.db.select({ max: sql<number>`max(${change.seq})` }).from(change).get()!.max;
  ctx = bench.setActive({ worldId: world.worldId, workId, branchId: ctx.branchId });
  return {
    ...world, bench, ctx, workId, chapterId, firstSceneId, secondSceneId, revealId, initialSeq,
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
