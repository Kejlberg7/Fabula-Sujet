import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { openStore } from '../db/client';
import { chapter, reviewRun, reviewScene, sceneText, work } from '../db/schema';
import { inTurn, undoLast } from '../core/changelog';
import {
  finishReviewRun, reviewRuns, scenesInScope, startReviewRun,
} from '../core/services/reviews';
import { createSuggestion, suggestionsFor } from '../core/services/suggestions';
import { saveSceneText } from '../core/services/narrative';
import { createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { loadHavnen } from '../fixtures';

const actor = { kind: 'user' as const };

/**
 * Fase ti, første snit: en gennemlæsning ved, hvilken prosa den læste.
 *
 * Uden det kan en læsning fra i går ikke skelnes fra en, der handler om det,
 * der står nu — og så er den ikke værd at gemme.
 */

describe('Gennemlæsningens omfang', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  after(() => store.close());

  const firstChapter = store.db.select().from(chapter)
    .where(and(eq(chapter.workId, loaded.firstWorkId), eq(chapter.branchId, ctx.branchId)))
    .all().sort((a, b) => a.position - b.position)[0]!;

  it('læser en bog i læserækkefølge, ikke i den rækkefølge tingene skete', () => {
    const scenes = scenesInScope(store, ctx, { kind: 'work', id: loaded.firstWorkId });
    assert.ok(scenes.length >= 7);
    assert.deepEqual(scenes.map((sc) => sc.position), scenes.map((_, i) => i + 1));

    const order = store.db.select().from(chapter)
      .where(and(eq(chapter.workId, loaded.firstWorkId), eq(chapter.branchId, ctx.branchId)))
      .all().sort((a, b) => a.position - b.position).map((ch) => ch.title);
    const seen: string[] = [];
    for (const sc of scenes) if (seen.at(-1) !== sc.chapterTitle) seen.push(sc.chapterTitle);
    assert.deepEqual(seen, order);
  });

  it('tager hele serien med, bind for bind', () => {
    const both = store.db.select().from(work).where(eq(work.branchId, ctx.branchId)).all();
    const seriesId = both[0]!.seriesId!;
    const whole = scenesInScope(store, ctx, { kind: 'series', id: seriesId });
    const first = scenesInScope(store, ctx, { kind: 'work', id: loaded.firstWorkId });
    const second = scenesInScope(store, ctx, { kind: 'work', id: loaded.secondWorkId });

    assert.equal(whole.length, first.length + second.length);
    // Bind et står forrest, hele vejen. En serie læses forfra.
    assert.deepEqual(
      whole.slice(0, first.length).map((sc) => sc.sceneId),
      first.map((sc) => sc.sceneId),
    );
  });

  it('kan snævres ind til ét kapitel og til én scene', () => {
    const inChapter = scenesInScope(store, ctx, { kind: 'chapter', id: firstChapter.id });
    assert.ok(inChapter.length > 0);
    assert.ok(inChapter.every((sc) => sc.chapterTitle === firstChapter.title));

    const one = scenesInScope(store, ctx, { kind: 'scene', id: inChapter[0]!.sceneId });
    assert.equal(one.length, 1);
    assert.equal(one[0]!.sceneId, inChapter[0]!.sceneId);
  });

  it('siger fra, når omfanget ikke findes', () => {
    assert.throws(() => inTurn(store, { branchId: ctx.branchId, actor }, (s) =>
      startReviewRun(s, ctx, store, { kind: 'work', id: 'findes-ikke' })),
    /findes ikke/);
  });

  it('siger fra, når omfanget findes, men er tomt', () => {
    // En tom bog er ikke en fejl -- men en gennemlæsning af den ville være en
    // dato uden en læsning, og den skal ikke kunne gemmes.
    const tom = inTurn(store, { branchId: ctx.branchId, actor }, (s) =>
      createWork(s, ctx, { title: 'Bind tre, endnu uskrevet' }));
    assert.throws(() => inTurn(store, { branchId: ctx.branchId, actor }, (s) =>
      startReviewRun(s, ctx, store, { kind: 'work', id: tom })),
    /ingen scener/);
  });
});

describe('Gennemlæsningen er bundet til den prosa, den læste', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  after(() => store.close());

  const current = (sceneId: string) => store.db.select().from(sceneText).where(and(
    eq(sceneText.sceneId, sceneId), eq(sceneText.isCurrent, true),
  )).get();

  const run = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Gennemlæsning' }, (s) =>
    startReviewRun(s, ctx, store, { kind: 'work', id: loaded.firstWorkId }));
  const sceneId = run.scenes[0]!.sceneId;

  it('skriver den version ned, hver scene stod i', () => {
    const rows = store.db.select().from(reviewScene)
      .where(eq(reviewScene.runId, run.runId)).all();
    assert.equal(rows.length, run.scenes.length);
    for (const row of rows) {
      assert.equal(row.textId, current(row.sceneId)?.id ?? null);
    }
  });

  it('rører ikke prosaen', () => {
    const before = current(sceneId)!;
    inTurn(store, { branchId: ctx.branchId, actor }, (s) =>
      startReviewRun(s, ctx, store, { kind: 'scene', id: sceneId }));
    assert.equal(current(sceneId)!.id, before.id);
  });

  const noteId = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Note' }, (s) =>
    createSuggestion(s, ctx, {
      sceneId, kind: 'craft', message: 'Andet afsnit siger det samme to gange.',
      runId: run.runId,
    }, store));

  it('stempler noten med den version, den handler om', () => {
    const note = suggestionsFor(store, ctx, { sceneId }).find((row) => row.id === noteId)!;
    assert.equal(note.runId, run.runId);
    assert.equal(note.textId, current(sceneId)!.id);
    assert.equal(note.stale, false);
  });

  it('markerer noten som forældet, når scenen bliver skrevet om', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Skriv om' }, (s) =>
      saveSceneText(s, ctx, store, {
        sceneId,
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nyt.' }] }] },
        markdown: 'Nyt.',
      }));

    const note = suggestionsFor(store, ctx, { sceneId }).find((row) => row.id === noteId)!;
    assert.equal(note.stale, true);
    // Den er forældet, ikke afgjort: forfatteren har ikke taget stilling til den.
    assert.equal(note.status, 'open');
  });

  it('tæller, hvor meget af læsningen der er skrevet om siden', () => {
    const report = reviewRuns(store, ctx).find((row) => row.id === run.runId)!;
    assert.equal(report.scenes, run.scenes.length);
    assert.equal(report.rewritten, 1);
    assert.equal(report.notes, 1);
    assert.equal(report.openNotes, 1);
  });

  it('kalder ikke en ældre note forældet, når der ikke står en version på den', () => {
    // Noter fra før fase ti har ingen version. Her efterlignes sådan en ved at
    // tømme stemplet igen. Ukendt er ikke det samme som uændret, og et gæt
    // ville her være værre end at tie.
    const older = inTurn(store, { branchId: ctx.branchId, actor }, (s) =>
      createSuggestion(s, ctx, {
        sceneId, kind: 'continuity', message: 'Skrevet før versionerne fandtes.',
      }, store));
    store.sqlite.prepare('update suggestion set text_id = null where id = ?').run(older);

    const note = suggestionsFor(store, ctx, { sceneId }).find((row) => row.id === older)!;
    assert.equal(note.textId, null);
    assert.equal(note.stale, false);
  });

  it('lader én fortrydelse tage hele læsningen tilbage', () => {
    const fresh = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Gennemlæsning' }, (s) =>
      startReviewRun(s, ctx, store, { kind: 'chapter', id: store.db.select().from(chapter)
        .where(eq(chapter.branchId, ctx.branchId)).all()[0]!.id }));
    assert.ok(store.db.select().from(reviewRun).where(eq(reviewRun.id, fresh.runId)).get());

    undoLast(store, ctx.branchId, actor);
    assert.equal(store.db.select().from(reviewRun).where(eq(reviewRun.id, fresh.runId)).get(), undefined);
    assert.equal(store.db.select().from(reviewScene).where(eq(reviewScene.runId, fresh.runId)).all().length, 0);
  });

  it('kan afsluttes én gang, og siger fra anden gang', () => {
    inTurn(store, { branchId: ctx.branchId, actor }, (s) =>
      finishReviewRun(s, ctx, store, { id: run.runId, summary: 'Første bind hænger sammen.' }));
    const report = reviewRuns(store, ctx).find((row) => row.id === run.runId)!;
    assert.ok(report.finishedAt);
    assert.equal(report.summary, 'Første bind hænger sammen.');

    assert.throws(() => inTurn(store, { branchId: ctx.branchId, actor }, (s) =>
      finishReviewRun(s, ctx, store, { id: run.runId })), /allerede afsluttet/);
  });
});
