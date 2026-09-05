import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { openStore, type Store } from '../db/client';
import { attachBytes, readAttachment } from '../core/attachments';
import { history, inTurn } from '../core/changelog';
import { createChapter, createScene, saveSceneText } from '../core/services/narrative';
import { createSource } from '../core/services/laws';
import { createWork, createWorld } from '../core/services/world';
import { Workbench, type Context } from '../core/workbench';
import {
  backupBundle, backupJson, inspectBackup, restoreBackup,
} from '../core/export/backup';
import { toMarkdown } from '../core/export/markdown';
import { readingEdition } from '../core/export/reading';

const actor = { kind: 'user' as const };

/**
 * En backup er ikke en funktion, før den er hentet tilbage.
 *
 * Derfor er den her prøve et helt roundtrip og ikke to halve: der bliver
 * skrevet en bog med en vedhæftet fil, pakket, hentet ind i en anden, tom
 * database — og bagefter bliver den samme bog læst ud igen og sammenlignet
 * ord for ord med den, der gik ind.
 */

describe('Backup og genoprettelse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fabula-backup-'));
  const pdf = Buffer.from('%PDF-1.4 en fotograferet side\n', 'utf8');
  let store: Store;
  let ctx: Context;
  let workId: string;
  let bundle: Buffer;
  let before1: string;

  before(() => {
    store = openStore(join(dir, 'kilde.db'));
    const world = createWorld(store, { name: 'Backupverdenen' });
    ctx = new Workbench(store).setActive({ worldId: world.worldId, workId: null });

    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Skriv bogen' }, (session) => {
      workId = createWork(session, ctx, { title: 'Vandet står ind' });
      const chapter = createChapter(session, ctx, store, { workId, title: 'Første kapitel' });
      const scene = createScene(session, ctx, store, { chapterId: chapter, title: 'På havnen' });
      saveSceneText(session, ctx, store, {
        sceneId: scene,
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Der var ingen storm.' }] }],
        },
        markdown: 'Der var ingen storm.',
      });
      const sourceId = createSource(session, ctx, { title: 'Søforhøret', kind: 'pdf' });
      attachBytes(store, session, ctx, { sourceId, name: 'soeforhoer.pdf', bytes: pdf });
    });

    ctx = { ...ctx, workId };
    before1 = toMarkdown(readingEdition(store, ctx, { workId }).document);
    bundle = backupBundle(store).bytes;
  });

  after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('pakker både data og de filer, data peger på', () => {
    const made = backupBundle(store);
    assert.equal(made.files, 1);
    assert.deepEqual(made.missing, []);
    assert.ok(made.rows > 10);
  });

  it('viser, hvad der er i filen, uden at røre noget', () => {
    const tom = openStore(join(dir, 'forhaand.db'));
    const preview = inspectBackup(tom, bundle);
    assert.equal(preview.kind, 'zip');
    assert.equal(preview.worlds.length, 1);
    assert.equal(preview.worlds[0]!.name, 'Backupverdenen');
    assert.deepEqual(preview.worlds[0]!.works, ['Vandet står ind']);
    assert.equal(preview.worlds[0]!.scenes, 1);
    assert.equal(preview.worlds[0]!.words, 4);
    assert.equal(preview.files.inData, 1);
    assert.equal(preview.files.inArchive, 1);
    assert.equal(preview.sameSchema, true);
    assert.equal(preview.canRestore, true);
    assert.deepEqual(preview.warnings, []);
    // Forhåndsoversigten har ikke skrevet noget: databasen er stadig tom.
    assert.equal(inspectBackup(tom, bundle).canRestore, true);
    tom.close();
  });

  it('henter hele bogen tilbage i en tom database', () => {
    const genskabt = openStore(join(dir, 'tom.db'));
    const report = restoreBackup(genskabt, bundle);
    assert.equal(report.files, 1);
    assert.deepEqual(report.worlds, ['Backupverdenen']);
    assert.ok(report.rows > 10);

    // Den samme bog, læst ud igen af den anden database.
    const ctx2 = new Workbench(genskabt).context();
    const efter = toMarkdown(readingEdition(genskabt, ctx2, { workId }).document);
    assert.equal(efter, before1);

    // Filen fulgte med, byte for byte.
    const file = readAttachment(genskabt, ctx2, backupSourceId(genskabt));
    assert.deepEqual(file.bytes, pdf);
    assert.equal(file.originalName, 'soeforhoer.pdf');

    // Og historikken kom med som historik, ikke som en ny historik.
    assert.deepEqual(
      history(genskabt.db, ctx2.branchId).map((t) => t.summary),
      history(store.db, ctx.branchId).map((t) => t.summary),
    );
    genskabt.close();
  });

  it('lægger sig ikke oven i noget', () => {
    assert.throws(() => restoreBackup(store, bundle), /ikke tom/);
    const preview = inspectBackup(store, bundle);
    assert.equal(preview.canRestore, false);
    assert.match(preview.warnings.join(' '), /ikke tom/);
  });

  it('siger det, når backuppen kun er data', () => {
    const tom = openStore(join(dir, 'kun-data.db'));
    const preview = inspectBackup(tom, backupJson(store));
    assert.equal(preview.kind, 'json');
    assert.equal(preview.files.inArchive, 0);
    assert.match(preview.warnings.join(' '), /kun data/);

    // Den kan stadig hentes ind. Rækkerne kommer; filen gør ikke.
    const report = restoreBackup(tom, backupJson(store));
    assert.equal(report.files, 0);
    assert.ok(report.rows > 10);
    tom.close();
  });

  it('siger fra over for en fil, der ikke er en backup', () => {
    const tom = openStore(join(dir, 'afvist.db'));
    assert.throws(() => inspectBackup(tom, Buffer.from('{"format":"noget andet"}')),
      /ikke en backup fra Fabula/);
    assert.throws(() => inspectBackup(tom, Buffer.from('slet ikke json')),
      /ikke læses som JSON/);
    tom.close();
  });
});

/** The one source in the restored database. */
function backupSourceId(store: Store): string {
  return (store.sqlite.prepare('select id from source').get() as { id: string }).id;
}
