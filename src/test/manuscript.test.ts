import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { openStore } from '../db/client';
import { chapter, entity, scene, sceneText, suggestion } from '../db/schema';
import { inTurn, undoLast } from '../core/changelog';
import { sourceShelf } from '../core/queries/sources';
import { manuscriptPacket } from '../core/queries/manuscript';
import { createSource, linkSource } from '../core/services/laws';
import { deleteRow } from '../core/services/generic';
import { saveSceneText } from '../core/services/narrative';
import {
  applySuggestion, createSuggestion, suggestionsFor,
} from '../core/services/suggestions';
import { Workbench } from '../core/workbench';
import { loadHavnen } from '../fixtures';

const actor = { kind: 'user' as const };

/**
 * Fase otte: research bliver læselig, og et tekstforslag kan skrives ind —
 * men kun af forfatteren, og kun i én tur.
 */

describe('Kildehylden', () => {
  const store = openStore(':memory:');
  const { worldId, firstWorkId } = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId: firstWorkId });
  after(() => store.close());

  const someone = store.db.select().from(entity)
    .where(and(eq(entity.worldId, worldId), eq(entity.kind, 'person'))).all()[0]!;

  it('siger, hvad kilden holder oppe — med navn, ikke med id', () => {
    const id = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Kilde' }, (s) => {
      const sourceId = createSource(s, ctx, { title: 'Havnekortet 1893', kind: 'image' });
      linkSource(s, ctx, {
        sourceId, targetKind: 'entity', targetId: someone.id, relation: 'supports',
      });
      return sourceId;
    });

    const item = sourceShelf(store, ctx).find((row) => row.id === id)!;
    assert.equal(item.unused, false);
    assert.equal(item.backs.length, 1);
    assert.equal(item.backs[0]!.label, someone.name);
  });

  it('lader en gemt og glemt kilde stå frem som ubrugt', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Kilde' }, (s) =>
      createSource(s, ctx, { title: 'Artikel, aldrig knyttet', kind: 'article' }));

    const item = sourceShelf(store, ctx).find((row) => row.title === 'Artikel, aldrig knyttet')!;
    assert.equal(item.unused, true);
    assert.equal(item.backs.length, 0);
  });

  it('lægger en mulig modstrid øverst', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Kilde' }, (s) => {
      const sourceId = createSource(s, ctx, { title: 'Lærebogen', kind: 'pdf' });
      linkSource(s, ctx, {
        sourceId, targetKind: 'entity', targetId: someone.id, relation: 'conflicts',
      });
    });

    const shelf = sourceShelf(store, ctx);
    assert.equal(shelf[0]!.title, 'Lærebogen', 'det, der strider, skal ikke stå nederst');
    assert.equal(shelf[0]!.conflicts, 1);
  });

  it('skjuler ikke en henvisning, hvis rækken den peger på er slettet', () => {
    const sourceId = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Kilde' }, (s) => {
      const id = createSource(s, ctx, { title: 'Skibsregistret', kind: 'file' });
      linkSource(s, ctx, {
        sourceId: id, targetKind: 'fact', targetId: 'et-faktum-der-ikke-findes',
      });
      return id;
    });

    const item = sourceShelf(store, ctx).find((row) => row.id === sourceId)!;
    assert.equal(item.unused, false, 'henvisningen findes stadig');
    assert.equal(item.backs[0]!.label, null, 'og den peger på ingenting');
  });

  it('holder henvisningen i grenen og kilden i verden', () => {
    // En kilde hører til verden; hvad den bakker op, kan være forskelligt på to
    // grene. Hylden læses derfor gennem grenen, også når kilden er den samme.
    const other = new Workbench(store).setActive({ worldId, workId: firstWorkId });
    const shelf = sourceShelf(store, { ...other, branchId: 'en-gren-der-ikke-findes' });
    assert.ok(shelf.length > 0, 'kilderne er der');
    assert.ok(shelf.every((item) => item.unused), 'men ingen henvisninger fra den gren');
  });
});

describe('Margennoten og det udtrykkelige ja', () => {
  const store = openStore(':memory:');
  const { worldId, firstWorkId } = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId: firstWorkId });
  after(() => store.close());

  const firstChapter = store.db.select().from(chapter)
    .where(eq(chapter.workId, firstWorkId)).all().sort((a, b) => a.position - b.position)[0]!;
  const sceneId = store.db.select().from(scene)
    .where(eq(scene.chapterId, firstChapter.id)).all()
    .sort((a, b) => a.position - b.position)[0]!.id;

  const currentText = () => store.db.select().from(sceneText).where(and(
    eq(sceneText.sceneId, sceneId), eq(sceneText.isCurrent, true),
  )).get();

  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  const before = 'Han så på vandet, og vandet så ikke tilbage.';
  const after_ = 'Han så på vandet. Vandet så ikke tilbage.';

  inTurn(store, { branchId: ctx.branchId, actor, summary: 'Prosa' }, (s) =>
    saveSceneText(s, ctx, store, { sceneId, doc: doc(before), markdown: before }));

  const noteId = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Note' }, (s) =>
    createSuggestion(s, ctx, {
      sceneId, markId: 'maerke-1', kind: 'craft',
      message: 'To sætninger står bedre end én her.',
      proposedText: after_,
    }, store));

  it('rører ikke prosaen, når noten skrives', () => {
    assert.equal(currentText()?.markdown, before);
    const note = suggestionsFor(store, ctx, { sceneId })
      .find((row) => row.id === noteId)!;
    assert.equal(note.status, 'open');
    assert.equal(note.appliedAt, null);
  });

  it('afviser en tekst, der ikke indeholder den foreslåede formulering', () => {
    assert.throws(() => inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Skriv ind',
    }, (s) => applySuggestion(s, ctx, store, {
      id: noteId, doc: doc('Noget helt andet.'), markdown: 'Noget helt andet.',
    })), /indeholder ikke den foreslåede formulering/);
    assert.equal(currentText()?.markdown, before, 'prosaen står urørt');
  });

  it('skriver formuleringen ind og sætter noten i den samme tur', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Skriv margennote ind' }, (s) =>
      applySuggestion(s, ctx, store, { id: noteId, doc: doc(after_), markdown: after_ }));

    assert.equal(currentText()?.markdown, after_);
    const note = store.db.select().from(suggestion).where(eq(suggestion.id, noteId)).get()!;
    assert.equal(note.status, 'accepted');
    assert.ok(note.appliedAt, 'noten bærer, hvornår den blev skrevet ind');
  });

  it('tager både teksten og noten tilbage med ét fortryd', () => {
    undoLast(store, ctx.branchId, actor);

    assert.equal(currentText()?.markdown, before, 'prosaen er tilbage');
    const note = store.db.select().from(suggestion).where(eq(suggestion.id, noteId)).get()!;
    assert.equal(note.appliedAt, null, 'og noten står åben igen');
  });

  it('afviser en note uden foreslået formulering', () => {
    const bare = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Note' }, (s) =>
      createSuggestion(s, ctx, {
        sceneId, kind: 'pacing', message: 'Scenen slutter et slag for sent.',
      }, store));

    assert.throws(() => inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Skriv ind',
    }, (s) => applySuggestion(s, ctx, store, {
      id: bare, doc: doc(before), markdown: before,
    })), /foreslår ingen formulering/);
  });

  it('skriver ikke den samme formulering ind to gange', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Skriv ind' }, (s) =>
      applySuggestion(s, ctx, store, { id: noteId, doc: doc(after_), markdown: after_ }));

    assert.throws(() => inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Igen',
    }, (s) => applySuggestion(s, ctx, store, {
      id: noteId, doc: doc(after_), markdown: after_,
    })), /allerede skrevet ind/);
  });
});

describe('Gennemgangspakken', () => {
  const store = openStore(':memory:');
  const { worldId, firstWorkId } = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId: firstWorkId });
  after(() => store.close());

  const firstChapter = store.db.select().from(chapter)
    .where(eq(chapter.workId, firstWorkId)).all().sort((a, b) => a.position - b.position)[0]!;
  const sceneId = store.db.select().from(scene)
    .where(eq(scene.chapterId, firstChapter.id)).all()
    .sort((a, b) => a.position - b.position)[0]!.id;

  it('siger, om forfatteren har markeret kilden som en mulig modstrid', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Kilde' }, (s) => {
      const sourceId = createSource(s, ctx, { title: 'Vejrarkivet', kind: 'article' });
      linkSource(s, ctx, {
        sourceId, targetKind: 'scene', targetId: sceneId, relation: 'conflicts',
        note: 'Der var ikke storm den aften.',
      });
    });

    const packet = manuscriptPacket(store, ctx, sceneId);
    const found = packet.sources.find((item) => item.title === 'Vejrarkivet')!;
    assert.equal(found.backs.relation, 'conflicts');
    assert.ok(found.backs.label, 'pakken siger hvad kilden strider mod, ikke bare at den gør');
  });

  it('kan ikke læse selve filen — kun det, forfatteren selv har skrevet', () => {
    const packet = manuscriptPacket(store, ctx, sceneId);
    for (const item of packet.sources) {
      assert.ok(!('content' in item), 'kildens indhold hentes aldrig');
      assert.ok(!('text' in item), 'kildens indhold hentes aldrig');
    }
  });
});

describe('En slettet henvisning', () => {
  const store = openStore(':memory:');
  const { worldId, firstWorkId } = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId: firstWorkId });
  after(() => store.close());

  it('forsvinder fra hylden uden at tage kilden med sig', () => {
    const person = store.db.select().from(entity)
      .where(and(eq(entity.worldId, worldId), eq(entity.kind, 'person'))).all()[0]!;
    const { sourceId, linkId } = inTurn(store, {
      branchId: ctx.branchId, actor, summary: 'Kilde',
    }, (s) => {
      const id = createSource(s, ctx, { title: 'Kirkebogen', kind: 'pdf' });
      const link = linkSource(s, ctx, {
        sourceId: id, targetKind: 'entity', targetId: person.id, relation: 'supports',
      });
      return { sourceId: id, linkId: link };
    });

    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Fjern henvisning' }, (s) =>
      deleteRow(s, store, { table: 'source_link', id: linkId }));

    const item = sourceShelf(store, ctx).find((row) => row.id === sourceId)!;
    assert.equal(item.unused, true);
  });
});
