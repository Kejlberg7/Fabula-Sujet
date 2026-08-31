import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { openStore } from '../db/client';
import { attachBytes } from '../core/attachments';
import { inTurn } from '../core/changelog';
import { createSource } from '../core/services/laws';
import { createWorld } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { createHttpApp } from '../server/http';

const actor = { kind: 'user' as const };

/**
 * Den ene rute, der rækker bytes ud af huset.
 *
 * En kilde gemmes og vises, aldrig læses — og «vises» er præcis her. Prøverne
 * står om det, der gør visningen sikker: typen kommer fra navnet, browseren
 * bliver holdt fast på den, og alt, der kan køre kode, bliver hentet ned frem
 * for vist på stedet.
 */

describe('Filruten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fabula-fil-'));
  const path = join(dir, 'p.db');
  let app: ReturnType<typeof createHttpApp>['app'];
  let pdfId: string;
  let svgId: string;
  let bareId: string;

  before(() => {
    const store = openStore(path);
    const world = createWorld(store, { name: 'Filprøven' });
    const ctx = new Workbench(store).setActive({ worldId: world.worldId, workId: null });
    const make = (title: string, kind: 'pdf' | 'image' | 'note') =>
      inTurn(store, { branchId: ctx.branchId, actor, summary: 'Kilde' }, (session) =>
        createSource(session, ctx, { title, kind }));
    pdfId = make('Protokollen', 'pdf');
    svgId = make('Kortet', 'image');
    bareId = make('Kun en note', 'note');
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Vedhæft' }, (session) => {
      attachBytes(store, session, ctx, {
        sourceId: pdfId, name: 'protokol.pdf', bytes: Buffer.from('%PDF-1.4 protokol'),
      });
      attachBytes(store, session, ctx, {
        sourceId: svgId, name: 'kort.svg', bytes: Buffer.from('<svg><script/></svg>'),
      });
    });
    store.close();
    app = createHttpApp(path).app;
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  const get = (id: string) => app.fetch(new Request(`http://prøve/api/fil/${id}`));

  it('rækker filen ud, som den blev lagt ind', async () => {
    const response = await get(pdfId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(await response.text(), '%PDF-1.4 protokol');
  });

  it('holder browseren fast på den type, filen blev gemt under', async () => {
    const response = await get(pdfId);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-disposition')!, /^inline; filename\*=UTF-8''protokol\.pdf$/);
  });

  it('giver filen ingenting at gøre med: intet script, intet net', async () => {
    const policy = (await get(pdfId)).headers.get('content-security-policy')!;
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /object-src 'none'/);
    // Ikke `sandbox`: den gør en PDF til en tvungen nedhentning, og en fil,
    // der kun kan hentes ned, er ikke vist. Se kommentaren ved ruten.
    assert.doesNotMatch(policy, /sandbox/);
  });

  it('henter det ned, der kan køre kode, frem for at vise det', async () => {
    const response = await get(svgId);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.match(response.headers.get('content-disposition')!, /^attachment;/);
  });

  it('svarer med en sætning, ikke et nedbrud, når der ingen fil er', async () => {
    const response = await get(bareId);
    assert.equal(response.status, 404);
    assert.match((await response.json() as { error: string }).error, /ingen fil/);
  });

  it('rækker ikke noget ud for et id, der ikke findes', async () => {
    assert.equal((await get('findes-ikke')).status, 404);
  });
});
