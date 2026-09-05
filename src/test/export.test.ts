import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { openStore, type Store } from '../db/client';
import { inTurn } from '../core/changelog';
import { createChapter, createScene, saveSceneText } from '../core/services/narrative';
import { createSource, linkSource } from '../core/services/laws';
import { createEntity } from '../core/services/entities';
import { createEvent } from '../core/services/events';
import { createSeries, createWork, createWorld } from '../core/services/world';
import { Workbench, type Context } from '../core/workbench';
import { toDocx } from '../core/export/docx';
import { toMarkdown } from '../core/export/markdown';
import { readingEdition } from '../core/export/reading';
import { unzipBytes, zipBytes } from '../core/export/zip';
import { sceneEvent } from '../db/schema';

const actor = { kind: 'user' as const };

/**
 * Fase tretten: bogen skal kunne forlade programmet.
 *
 * Det, prøverne holder fast i, er ikke at eksporten findes, men at den er den
 * samme tekst: forfatterens ord, i læserækkefølge, uden noget af det, der er
 * apparat. Et ankermærke i prosaen er den skarpe prøve -- det ligger midt inde
 * i en sætning, og det må ikke kunne ses i det, der kommer ud.
 */

/** A ProseMirror document with an anchor mark in the middle of a sentence. */
const anchored = (text: string, marked: string) => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: `${text} ` },
      {
        type: 'text',
        text: marked,
        marks: [{ type: 'anchor', attrs: { markId: 'm-42', kind: 'entity', code: 'P1' } }],
      },
      { type: 'text', text: '.' },
    ],
  }],
});

describe('Læseudgaven', () => {
  let store: Store;
  let ctx: Context;
  let workId: string;
  let seriesId: string;

  before(() => {
    store = openStore(':memory:');
    const world = createWorld(store, { name: 'Eksportverdenen' });
    const bench = new Workbench(store);
    ctx = bench.setActive({ worldId: world.worldId, workId: null });

    inTurn(store, { branchId: ctx.branchId, actor, summary: 'Byg bogen' }, (session) => {
      seriesId = createSeries(session, ctx, { name: 'Havnetrilogien', position: 1 });
      workId = createWork(session, ctx, { title: 'Vandet står ind', seriesId, position: 1 });
      const two = createWork(session, ctx, { title: 'Bagefter', seriesId, position: 2 });
      ctx = { ...ctx, workId };

      const one = createChapter(session, ctx, store, { workId, title: 'Første kapitel' });
      const first = createScene(session, ctx, store, { chapterId: one, title: 'På havnen' });
      const second = createScene(session, ctx, store, { chapterId: one, title: 'Senere' });
      saveSceneText(session, ctx, store, {
        sceneId: first,
        doc: anchored('Han stod og så på', 'Valdemar'),
        markdown: 'Han stod og så på Valdemar.',
      });
      saveSceneText(session, ctx, store, {
        sceneId: second,
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Vandet steg.' }] }] },
        markdown: 'Vandet steg.',
      });

      const chapterTwo = createChapter(session, ctx, store, { workId: two, title: 'Andet binds kapitel' });
      const later = createScene(session, ctx, store, { chapterId: chapterTwo, title: 'Bagefter' });
      saveSceneText(session, ctx, store, {
        sceneId: later,
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Der var stille.' }] }] },
        markdown: 'Der var stille.',
      });

      // Noget at lave et appendiks af.
      const valdemar = createEntity(session, ctx, {
        kind: 'person', name: 'Valdemar', summary: 'Havnefogeden',
      });
      const havnen = createEntity(session, ctx, {
        kind: 'place', name: 'Havnen', summary: 'Hvor det hele sker',
      });
      const storm = createEvent(session, ctx, {
        title: 'Stormen', realmId: world.realmId, placeId: havnen,
        earliest: 0, latest: 0, precision: 'day',
      });
      session.insert(sceneEvent, {
        branchId: ctx.branchId, sceneId: first, eventId: storm, mode: 'dramatised',
      });
      const kilde = createSource(session, ctx, { title: 'Stormfloden 1872', kind: 'article', url: 'https://example.dk/storm' });
      linkSource(session, ctx, { sourceId: kilde, targetKind: 'event', targetId: storm, relation: 'supports' });
      void valdemar;
    });
  });

  it('tager forfatterens ord med og apparatet ikke', () => {
    const { document, stats } = readingEdition(store, ctx, { workId });
    const markdown = toMarkdown(document);

    assert.match(markdown, /Han stod og så på Valdemar\./);
    assert.match(markdown, /Vandet steg\./);
    // Ankeret ligger inde i den sætning, der lige er læst. Intet af det må ud.
    assert.doesNotMatch(markdown, /m-42|anchor|data-anchor|P1/);
    assert.equal(stats.scenes, 2);
    assert.equal(stats.written, 2);
  });

  it('lader scenetitler blive, hvor de arbejder', () => {
    const uden = toMarkdown(readingEdition(store, ctx, { workId }).document);
    assert.doesNotMatch(uden, /På havnen/);

    const med = toMarkdown(readingEdition(store, ctx, { workId }, { sceneTitles: true }).document);
    assert.match(med, /På havnen/);
  });

  it('sætter et scenebrud mellem to scener i samme kapitel', () => {
    const markdown = toMarkdown(readingEdition(store, ctx, { workId }).document);
    const between = markdown.slice(
      markdown.indexOf('Valdemar'), markdown.indexOf('Vandet steg'),
    );
    assert.match(between, /---/);
  });

  it('læser serien i rækkefølge og bogen alene for sig', () => {
    const alene = toMarkdown(readingEdition(store, ctx, { workId }).document);
    assert.doesNotMatch(alene, /Der var stille/);

    const hele = toMarkdown(readingEdition(store, ctx, { seriesId }).document);
    assert.ok(hele.indexOf('Vandet står ind') < hele.indexOf('Bagefter'));
    assert.match(hele, /Der var stille\./);
    assert.match(hele, /^# Havnetrilogien/m);
  });

  it('siger ikke noget om huller, med mindre man spørger', () => {
    const tom = inTurn(store, { branchId: ctx.branchId, actor, summary: 'Tom scene' }, (session) => {
      const ch = createChapter(session, ctx, store, { workId, title: 'Tredje kapitel' });
      return createScene(session, ctx, store, { chapterId: ch, title: 'Ikke skrevet' });
    });
    assert.ok(tom);

    const stille = toMarkdown(readingEdition(store, ctx, { workId }).document);
    assert.doesNotMatch(stille, /ikke skrevet endnu/);

    const med = toMarkdown(readingEdition(store, ctx, { workId }, { gaps: true }).document);
    assert.match(med, /\[Scenen er ikke skrevet endnu\.\]/);
  });

  it('tager kun det appendiks med, der bliver bedt om', () => {
    const uden = toMarkdown(readingEdition(store, ctx, { workId }).document);
    assert.doesNotMatch(uden, /Personer/);

    const med = toMarkdown(readingEdition(store, ctx, { workId }, {
      appendix: ['people', 'places', 'timeline', 'sources'],
    }).document);
    assert.match(med, /# Personer/);
    assert.match(med, /Valdemar/);
    assert.match(med, /# Steder/);
    assert.match(med, /Havnen/);
    assert.match(med, /# Tidslinje/);
    assert.match(med, /Stormen/);
    assert.match(med, /# Kilder/);
    assert.match(med, /Stormfloden 1872/);
    // Kilden nævnes, aldrig læst: art og adresse, ikke indhold.
    assert.match(med, /artikel/);
  });
});

describe('Word-filen', () => {
  const document = {
    title: 'Vandet står ind',
    subtitle: 'Havnetrilogien',
    createdAt: new Date('2026-09-05T10:00:00Z'),
    blocks: [
      { kind: 'heading' as const, level: 1, runs: [{ text: 'Første kapitel' }], startsPage: true },
      { kind: 'paragraph' as const, runs: [{ text: 'Han stod & så på ' }, { text: 'Valdemar', italic: true }], style: 'prose_first' as const },
      { kind: 'separator' as const },
      { kind: 'paragraph' as const, runs: [{ text: 'Vandet steg.' }], style: 'prose' as const },
    ],
  };

  it('er et rigtigt ZIP-arkiv med de dele, Word kræver', () => {
    const parts = unzipBytes(toDocx(document));
    for (const name of [
      '[Content_Types].xml', '_rels/.rels', 'word/document.xml',
      'word/styles.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml',
    ]) {
      assert.ok(parts.has(name), `mangler ${name}`);
    }
    assert.equal(toDocx(document).subarray(0, 2).toString('latin1'), 'PK');
  });

  it('skriver teksten som XML, der kan åbnes', () => {
    const xml = unzipBytes(toDocx(document)).get('word/document.xml')!.toString('utf8');
    assert.match(xml, /Han stod &amp; så på /);
    assert.match(xml, /<w:i\/>/);
    assert.match(xml, /<w:pStyle w:val="ProsaFoerste"\/>/);
    assert.match(xml, /<w:pageBreakBefore\/>/);
    // Ingen rå <, > eller & slipper igennem og gør filen uåbnelig.
    assert.doesNotMatch(xml.replace(/<[^>]*>/g, ''), /[<>]/);
  });
});

describe('ZIP-arkivet', () => {
  it('kommer helskindet tilbage', () => {
    const bytes = Buffer.from('Æblegrød og en meget lang, meget gentagen sætning. '.repeat(50), 'utf8');
    const back = unzipBytes(zipBytes([
      { name: 'mappe/fil.txt', bytes },
      { name: 'tom.bin', bytes: Buffer.alloc(0) },
    ]));
    assert.deepEqual(back.get('mappe/fil.txt'), bytes);
    assert.equal(back.get('tom.bin')!.byteLength, 0);
  });

  it('pakker det, der kan pakkes, og lader det andet være', () => {
    const repetitive = Buffer.from('a'.repeat(10_000));
    const packed = zipBytes([{ name: 'a.txt', bytes: repetitive }]);
    assert.ok(packed.byteLength < 1_000, `blev ${packed.byteLength} bytes`);
    // Tilfældige bytes bliver ikke mindre af at blive pakket; så bliver de gemt.
    const random = Buffer.from(Array.from({ length: 4_000 }, (_, i) => (i * 37) % 251));
    assert.ok(unzipBytes(zipBytes([{ name: 'r.bin', bytes: random }])).get('r.bin')!.equals(random));
  });

  it('siger fra, når det ikke er et arkiv', () => {
    assert.throws(() => unzipBytes(Buffer.from('ikke et arkiv')), /ikke et ZIP-arkiv/);
  });
});
