import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { openStore, type Store } from '../db/client';
import { source } from '../db/schema';
import {
  archiveRoot, attachBytes, attachFile, checkAttachments, detachFile, orphanFiles,
  readAttachment, safeInline, typeForName,
} from '../core/attachments';
import { inTurn, undoLast } from '../core/changelog';
import { runRules } from '../core/rules';
import { createSource } from '../core/services/laws';
import { createWorld } from '../core/services/world';
import { Workbench } from '../core/workbench';
import type { Context } from '../core/workbench';

const actor = { kind: 'user' as const };

/**
 * Fase tolv: en sti er et løfte, ingen har givet.
 *
 * Prøverne kører mod en rigtig fil på disken, ikke mod hukommelsen. Det er
 * ikke pedanteri: hele fasen handler om, at bytes ligger et sted, og en
 * database i hukommelsen har intet sted at lægge dem.
 */

describe('Projektarkivet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fabula-proeve-'));
  let store: Store;
  let ctx: Context;
  let sourceId: string;

  before(() => {
    store = openStore(join(dir, 'p.db'));
    const world = createWorld(store, { name: 'Arkivprøven' });
    ctx = new Workbench(store).setActive({ worldId: world.worldId, workId: null });
    sourceId = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Kilde' }, (session) =>
      createSource(session, ctx, { title: 'Fotograferet side', kind: 'pdf' }));
  });

  after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const attach = (name: string, bytes: Buffer) =>
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Vedhæft' }, (session) =>
      attachBytes(store, session, ctx, { sourceId, name, bytes }));

  const row = () => store.db.select().from(source).where(eq(source.id, sourceId)).get()!;

  it('lægger arkivet ved siden af databasen, ikke i den', () => {
    assert.equal(archiveRoot(store), join(dir, 'p-filer'));
    assert.equal(archiveRoot(openStore(':memory:')), null);
  });

  it('kopierer bytes ind og husker navn, type, størrelse og kontrolsum', () => {
    const filed = attach('side 12.pdf', Buffer.from('%PDF-1.4 prøve'));
    assert.equal(filed.originalName, 'side 12.pdf');
    assert.equal(filed.mimeType, 'application/pdf');
    assert.equal(filed.byteSize, 15);   // «ø» fylder to
    assert.match(filed.checksum, /^[0-9a-f]{64}$/);
    assert.equal(
      readFileSync(join(archiveRoot(store)!, filed.filePath), 'utf8'), '%PDF-1.4 prøve',
    );
    assert.equal(row().filePath, filed.filePath);
  });

  it('gætter aldrig typen ud fra indholdet, kun ud fra navnet', () => {
    assert.equal(typeForName('kajen.PNG'), 'image/png');
    assert.equal(typeForName('noget-uden-endelse'), 'application/octet-stream');
    // Filer, der kan køre kode, må gemmes -- de må bare aldrig vises på stedet.
    assert.equal(safeInline(typeForName('kort.svg')), false);
    assert.equal(safeInline(typeForName('side.html')), false);
    assert.equal(safeInline(typeForName('side.pdf')), true);
  });

  it('lader en sti hen over mapper være et filnavn, ikke en vej ud af arkivet', () => {
    const filed = attach('../../../etc/passwd', Buffer.from('ikke mig'));
    assert.equal(filed.originalName, 'passwd');
    assert.equal(filed.filePath, join(sourceId, 'passwd'));
    assert.ok(existsSync(join(archiveRoot(store)!, sourceId, 'passwd')));
  });

  it('afviser en fil, der ikke findes, frem for at gemme en tom kilde', () => {
    assert.throws(
      () => inTurn(store, { branchId: ctx.branchId, actor, summary: 'Vedhæft' }, (session) =>
        attachFile(store, session, ctx, { sourceId, path: join(dir, 'findes-ikke.pdf') })),
      /ingen fil/,
    );
  });

  it('rækker bytes videre præcis som de blev lagt ind', () => {
    attach('note.txt', Buffer.from('Læses af mennesker.'));
    const file = readAttachment(store, ctx, sourceId);
    assert.equal(file.bytes.toString('utf8'), 'Læses af mennesker.');
    assert.equal(file.mimeType, 'text/plain');
    assert.equal(file.inline, true);
  });

  describe('når filen ikke er den, den var', () => {
    it('siger uændret, når den er uændret', () => {
      attach('protokol.pdf', Buffer.from('%PDF-1.4 protokol'));
      const [check] = checkAttachments(store, ctx);
      assert.equal(check!.state, 'ok');
      assert.equal(runRules(store, ctx, ['attachment_missing']).findings.length, 0);
    });

    it('opdager, at indholdet er skiftet, uden at læse det', () => {
      writeFileSync(join(archiveRoot(store)!, row().filePath!), '%PDF-1.4 noget andet');
      const [check] = checkAttachments(store, ctx);
      assert.equal(check!.state, 'beskadiget');
      // Størrelsen er også en anden, så den billige regel fanger den her.
      const { findings } = runRules(store, ctx, ['attachment_missing']);
      assert.equal(findings.length, 1);
      assert.match(findings[0]!.message, /størrelse|ikke længere/i);
    });

    it('opdager, at filen er væk', () => {
      rmSync(join(archiveRoot(store)!, row().filePath!));
      assert.equal(checkAttachments(store, ctx)[0]!.state, 'mangler');
      const { findings } = runRules(store, ctx, ['attachment_missing']);
      assert.equal(findings.length, 1);
      assert.match(findings[0]!.message, /ikke ligger i arkivet/);
    });

    it('tier om en database uden arkiv i stedet for at melde alt væk', () => {
      const memory = openStore(':memory:');
      const world = createWorld(memory, { name: 'Uden arkiv' });
      const memoryCtx = new Workbench(memory).setActive({ worldId: world.worldId, workId: null });
      const id = inTurn(memory, { branchId: memoryCtx.branchId, actor, summary: 'Kilde' }, (session) =>
        createSource(session, memoryCtx, { title: 'Uden fil', kind: 'pdf' }));
      assert.ok(id);
      assert.equal(runRules(memory, memoryCtx, ['attachment_missing']).findings.length, 0);
      memory.close();
    });
  });

  describe('at slippe filen og at slette den', () => {
    it('slipper henvisningen og lader filen ligge', () => {
      const filed = attach('bliver-liggende.pdf', Buffer.from('%PDF-1.4 bliver'));
      const done = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Slip' }, (session) =>
        detachFile(store, session, ctx, { sourceId }));
      assert.equal(done.fileRemoved, false);
      assert.equal(row().filePath, null);
      assert.equal(row().checksum, null);
      assert.ok(existsSync(join(archiveRoot(store)!, filed.filePath)));
    });

    it('fortryd henter henvisningen tilbage, fordi filen stadig er der', () => {
      undoLast(store, ctx.branchId, actor);
      assert.equal(row().originalName, 'bliver-liggende.pdf');
      assert.equal(checkAttachments(store, ctx)[0]!.state, 'ok');
    });

    it('sletter kun filen, når det udtrykkeligt er det, der bliver bedt om', () => {
      const path = join(archiveRoot(store)!, row().filePath!);
      inTurn(store, { branchId: ctx.branchId, actor, summary: 'Slet' }, (session) =>
        detachFile(store, session, ctx, { sourceId, removeFile: true }));
      assert.equal(existsSync(path), false);
    });

    it('fortryder aldrig en sletning, men siger det med en regel', () => {
      // Fortryd henter rækken tilbage; filen kommer ikke igen af sig selv, og
      // så skal den manglende fil kunne ses frem for at ligge og lyve.
      undoLast(store, ctx.branchId, actor);
      assert.ok(row().filePath);
      assert.equal(runRules(store, ctx, ['attachment_missing']).findings.length, 1);
    });
  });

  it('nævner filer i arkivet, som ingen kilde peger på, og sletter dem ikke', () => {
    const before = orphanFiles(store).length;
    const filed = attach('forældreløs.pdf', Buffer.from('%PDF-1.4 alene'));
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Slip' }, (session) =>
      detachFile(store, session, ctx, { sourceId }));
    const orphans = orphanFiles(store);
    assert.ok(orphans.length > before);
    assert.ok(orphans.some((row) => row.filePath === filed.filePath));
    assert.ok(existsSync(join(archiveRoot(store)!, filed.filePath)));
  });
});
