import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { openStore } from '../db/client';
import { textAnchor } from '../db/schema';
import { inTurn } from '../core/changelog';
import { proseGaps } from '../core/queries/proseGaps';
import { createEntity } from '../core/services/entities';
import { saveSceneText } from '../core/services/narrative';
import { scenesInScope } from '../core/services/reviews';
import { Workbench } from '../core/workbench';
import { loadHavnen } from '../fixtures';
import { placeMentions } from '../fixtures/mentions';

const actor = { kind: 'user' as const };

/**
 * Fase ti, andet snit: hvad står der i prosaen, som bibelen ikke svarer for.
 *
 * Prøverne her handler lige så meget om tavsheden som om fundene. En liste,
 * der melder hvert stort bogstav i en dansk sætning, bliver lukket den første
 * dag og aldrig åbnet igen, så hver falsk positiv har sin egen prøve.
 */

describe('Navne uden kobling', () => {
  const store = openStore(':memory:');
  const loaded = loadHavnen(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: loaded.worldId, workId: loaded.firstWorkId });
  after(() => store.close());

  const scenes = scenesInScope(store, ctx, { kind: 'work', id: loaded.firstWorkId });
  // En scene, prøvecasen ikke allerede har hængt en omtale på: et anker bliver
  // stående, når prosaen skiftes ud, og ville gøre hver prøve herunder tavs.
  const anchored = new Set(store.db.select().from(textAnchor)
    .where(eq(textAnchor.branchId, ctx.branchId)).all().map((a) => a.sceneId));
  const pad = scenes.find((sc) => !anchored.has(sc.sceneId))!;

  const doc = (paras: string[]) => ({
    type: 'doc',
    content: paras.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  });

  const write = (...paras: string[]) => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Prøveprosa' }, (s) => {
      saveSceneText(s, ctx, store, {
        sceneId: pad.sceneId, doc: doc(paras), markdown: paras.join('\n\n'),
      });
    });
  };

  /** Kun det, prøven lige har skrevet — resten af bogen er ikke sagen her. */
  const here = () => proseGaps(store, ctx, { kind: 'scene', id: pad.sceneId })[0]
    ?? { unlinked: [], unknown: [] };

  it('finder et navn, prosaen bruger, og bibelen kender', () => {
    write('Valdemar stod ved døren og ventede på, at nogen skulle sige noget.');
    const found = here().unlinked;
    assert.equal(found.length, 1);
    assert.equal(found[0]!.label, 'Valdemar Sund');
    assert.equal(found[0]!.phrase, 'Valdemar');
    assert.equal(found[0]!.count, 1);
  });

  it('tæller genitiven med i stedet for at opfinde en person mere', () => {
    write('Valdemars båd lå stille, og Valdemar så ikke på den.');
    const found = here();
    assert.equal(found.unlinked.length, 1);
    assert.equal(found.unlinked[0]!.count, 2);
    assert.deepEqual(found.unknown, []);
  });

  it('tier om et efternavn, tre personer deler', () => {
    // Krag er både Mads, Ingeborg og Jens. At pege på én af dem ville være et
    // gæt, og et gæt her er værre end ingenting.
    write('Krag sagde det højt, og bagefter var der ingen, der spurgte igen.');
    assert.deepEqual(here().unlinked.map((u) => u.label), []);
  });

  it('tier, når scenen allerede har omtalen', () => {
    write('Valdemar stod ved døren og ventede på, at nogen skulle sige noget.');
    placeMentions(store, ctx, [{
      scene: pad.title!, phrase: 'Valdemar', kind: 'entity', name: 'Valdemar Sund',
    }]);
    const found = here();
    assert.deepEqual(found.unlinked, []);
    // Og ordet er ikke pludselig et ukendt navn, fordi det er mærket.
    assert.deepEqual(found.unknown, []);
  });

  it('melder et navn, ingen post svarer til', () => {
    write('Skibet hed Marie Krag, og han sagde navnet uden at se op.');
    const found = here();
    assert.deepEqual(found.unlinked, []);
    assert.deepEqual(found.unknown, [{ phrase: 'Marie Krag', count: 1 }]);
  });

  it('regner ikke et stort begyndelsesbogstav for et navn', () => {
    write(
      'Vandet stod ind. Bagefter blev der stille.',
      'Hun ventede. Der var ingen storm. Skibet lå, hvor det havde ligget.',
    );
    assert.deepEqual(here().unknown, []);
  });

  it('lader det formelle De og det flertals-I stå i fred', () => {
    write('Han spurgte, om De ville sidde ned, og om I havde spist.');
    assert.deepEqual(here().unknown, []);
  });

  it('deler ikke et navn op, hvor kun det første ord er stort', () => {
    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Prøveperson' }, (s) => {
      createEntity(s, ctx, { name: 'Den gamle skipper', kind: 'person' });
    });
    write('Den var tom, og der var gammelt salt i bunden.');
    assert.deepEqual(here().unlinked.map((u) => u.label), []);
  });

  it('slår fornavnet sammen med det fulde navn, når ingen af dem har en post', () => {
    write('Anton Bruun kom ind. Han så på Anton og sagde ingenting.');
    const unknown = here().unknown;
    assert.deepEqual(unknown, [{ phrase: 'Anton Bruun', count: 2 }]);
  });

  it('springer scener uden prosa over i stedet for at melde dem tomme', () => {
    const whole = proseGaps(store, ctx, { kind: 'work', id: loaded.firstWorkId });
    assert.ok(whole.every((g) => g.unlinked.length > 0 || g.unknown.length > 0));
    assert.ok(whole.length < scenes.length);
  });
});
