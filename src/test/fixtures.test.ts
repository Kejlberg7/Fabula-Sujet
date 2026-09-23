import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { openStore, type Store } from '../db/client';
import {
  beat, chapter, entity, entityLeg, event, identity, sceneEvent, scene, sceneText,
  storyReference, textAnchor, thread,
} from '../db/schema';
import { whoKnewWhat } from '../core/queries/knowledge';
import { whoWasWhere, worldline } from '../core/queries/presence';
import { solveTime } from '../core/solve';
import { RealmClocks } from '../core/time/realms';
import { SECONDS, formatSpan } from '../core/time/gregorian';
import { Workbench } from '../core/workbench';
import { loadHavnen, loadInception, loadMemento, loadPredestination } from '../fixtures';
import { realm } from '../db/schema';
import { createApi } from '../server/api';

/**
 * The fixtures are the point of the fixtures: each film presses on a different
 * axis, and a model that can hold all three can hold most things. These tests
 * check the axis, not the plot.
 */

/** Every work reference the prose itself carries -- P1, S1, G1 and the rest. */
function mentionedCodes(doc: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      marks?: { type?: string; attrs?: Record<string, unknown> }[];
      content?: unknown[];
    };
    for (const mark of n.marks ?? []) {
      if (mark.type === 'anchor' && typeof mark.attrs?.['code'] === 'string') {
        found.push(mark.attrs['code']);
      }
    }
    for (const child of n.content ?? []) walk(child);
  };
  walk(doc);
  return found;
}

describe('Memento — fortællerorden mod kronologi', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadMemento(store);
  const ctx = new Workbench(store).setActive({ worldId, workId });

  it('fortæller farvesporet baglæns', () => {
    const chapters = store.db.select().from(chapter).where(eq(chapter.workId, workId)).all()
      .sort((a, b) => a.position - b.position);
    const colourChapters = chapters.filter((c) => c.title.startsWith('Farve'));
    assert.ok(colourChapters.length >= 4, 'der skal være et farvespor at måle på');

    // Første scene i hvert farvekapitel. Jo senere i bogen, jo tidligere på
    // dagen — det er hele grebet, og det er det, de to akser findes for.
    const chronology = colourChapters.map((c) => {
      const sc = store.db.select().from(scene).where(eq(scene.chapterId, c.id)).all()
        .sort((a, b) => a.position - b.position)[0]!;
      const link = store.db.select().from(sceneEvent).where(eq(sceneEvent.sceneId, sc.id)).get()!;
      return store.db.select().from(event).where(eq(event.id, link.eventId)).get()!.earliest!;
    });

    const descending = [...chronology].sort((a, b) => b - a);
    assert.deepEqual(chronology, descending,
      'jo senere i læserækkefølgen, jo tidligere i kronologien');
    assert.notDeepEqual(chronology, [...chronology].sort((a, b) => a - b));
  });

  it('lader erindringen udløbe, mens polaroiden bliver ved', () => {
    const leonard = store.sqlite.prepare('select id from entity where name = ?').get('Leonard') as { id: string };
    // Øjeblikket han skriver det ned. Det er dér erindringen stadig er hans.
    const colourStart = store.db.select().from(event)
      .where(eq(event.title, 'Han skriver på polaroiden af Teddy')).get()!.earliest!;

    const fresh = whoKnewWhat(store, ctx, { entityId: leonard.id, at: colourStart + 5 * SECONDS.MINUTE });
    const teddyFresh = fresh.items.find((i) => i.summary.includes('Teddy'))!;
    assert.equal(teddyFresh.source, 'derived');
    assert.equal(teddyFresh.strength, 'suspects', 'lige efter husker han stadig det, han oplevede');

    const later = whoKnewWhat(store, ctx, { entityId: leonard.id, at: colourStart + 3 * 3600 });
    const teddyLater = later.items.find((i) => i.summary.includes('Teddy'))!;
    assert.equal(teddyLater.source, 'carried', 'tre timer senere husker han intet — men han bærer beviset');
    assert.equal(teddyLater.viaObject, 'Polaroid af Teddy');
  });

  it('svarer for det sidste øjeblik, vi kender, når man ikke spørger om et', () => {
    const leonard = store.sqlite.prepare('select id from entity where name = ?').get('Leonard') as { id: string };
    const now = whoKnewWhat(store, ctx, { entityId: leonard.id });

    assert.ok(now.at != null, 'et svar uden tidspunkt skal stadig gælde et tidspunkt');
    assert.ok(now.items.some((i) => i.source === 'carried'),
      'ved tidernes ende bærer han intet — og så er svaret sandt, men ubrugeligt');
  });

  it('efterlader sandheden om Teddy uafgjort med vilje', () => {
    const truth = store.sqlite.prepare('select truth from fact where summary like ?')
      .get('%Teddy%') as { truth: string };
    assert.equal(truth.truth, 'undecided');
    assert.equal(solveTime(store, ctx).findings.length, 0, 'et uafgjort faktum er ikke et problem');
  });

  it('viser polaroiden som en arbejdsreference direkte i prosaen', () => {
    const polaroid = store.db.select().from(entity)
      .where(eq(entity.name, 'Polaroid af Teddy')).get()!;
    const anchor = store.db.select().from(textAnchor)
      .where(eq(textAnchor.targetId, polaroid.id)).get();
    assert.equal(anchor?.targetKind, 'entity');
    assert.match(anchor?.excerpt ?? '', /Stol ikke/);
  });

  it('viser hvilke scener der har omtaler allerede i skrivebordets indholdsfortegnelse', () => {
    const scenes = createApi(store)['scene.list']({});
    const withMentions = scenes.filter((item) => item.anchorCount > 0);
    assert.equal(withMentions.length, 5);
    assert.ok(withMentions.some((item) =>
      item.title === 'Han skriver på bagsiden' && item.referenceCodes.length > 0));
    assert.ok(withMentions.every((item) => item.referenceCodes.length > 0));
  });
});

describe('Predestination — personlig tid', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadPredestination(store);
  const ctx = new Workbench(store).setActive({ worldId, workId });
  const traveller = store.sqlite.prepare('select id from entity where name = ?')
    .get('Den rejsende') as { id: string };

  it('har én person med fire ben og fire navne', () => {
    const legs = worldline(store, ctx, traveller.id);
    assert.equal(legs.length, 4);
    assert.deepEqual(legs.map((l) => l.label),
      ['som Jane', 'som John', 'som bartenderen', 'som bomberen']);

    const personal = legs.map((l) => l.personalStart!);
    assert.deepEqual(personal, [...personal].sort((a, b) => a - b), 'egen tid stiger altid');

    const worldTimes = legs.map((l) => l.worldStart!);
    assert.notDeepEqual(worldTimes, [...worldTimes].sort((a, b) => a - b),
      'verdens tid gør ikke — det er hele pointen');
  });

  it('lader personen møde sig selv uden at det er bilokation', () => {
    const bar = store.sqlite.prepare('select id from entity where name = ?').get('Baren') as { id: string };
    const evening = store.db.select().from(event).where(eq(event.title, 'Aftenen i baren')).get()!;
    const there = whoWasWhere(store, ctx, { from: evening.earliest! + 3600, placeId: bar.id });

    assert.equal(there.length, 2);
    assert.equal(new Set(there.map((p) => p.entityName)).size, 1, 'samme menneske');
    assert.equal(new Set(there.map((p) => p.legOrdinal)).size, 2, 'to forskellige ben');
  });

  it('holder det unge ben uvidende om det, det ældste ved', () => {
    const legs = store.db.select().from(entityLeg)
      .where(eq(entityLeg.entityId, traveller.id)).all().sort((a, b) => a.ordinal - b.ordinal);

    const young = whoKnewWhat(store, ctx, { entityId: traveller.id, legId: legs[0]!.id, at: 10 * 31556952 });
    const old = whoKnewWhat(store, ctx, { entityId: traveller.id, legId: legs[2]!.id, at: 40 * 31556952 });

    const knowsIdentity = (r: { items: { summary: string }[] }) =>
      r.items.some((i) => i.summary.includes('samme'));
    assert.equal(knowsIdentity(young), false, 'som Jane aner hun det ikke');
    assert.equal(knowsIdentity(old), true, 'som bartenderen ved han det godt');
  });

  it('accepterer en verdens-tid, der springer tilbage', () => {
    const report = solveTime(store, ctx);
    assert.equal(report.findings.length, 0,
      'sløjfen er tidsrejse, ikke en umulig kronologi');
  });

  it('kan adressere bartender-identiteten fra prosaen', () => {
    const barkeep = store.db.select().from(identity)
      .where(eq(identity.name, 'Bartenderen')).get()!;
    const anchor = store.db.select().from(textAnchor)
      .where(eq(textAnchor.targetId, barkeep.id)).get();
    assert.equal(anchor?.targetKind, 'identity');
  });
});

describe('Inception — lag inden i lag', () => {
  const store = openStore(':memory:');
  const { worldId, workId, realmIds } = loadInception(store);
  const ctx = new Workbench(store).setActive({ worldId, workId });

  it('har fire lag, hvert tyve gange hurtigere', () => {
    assert.equal(realmIds.length, 4);
    const rows = store.db.select().from(realm).where(eq(realm.worldId, worldId)).all();
    const dreams = rows.filter((r) => r.kind === 'dream');
    assert.equal(dreams.length, 3);
    assert.ok(dreams.every((d) => d.timeRatioNum === 20 && d.parentEpoch != null),
      'hvert lag er både hurtigere end og fæstnet til det over');
  });

  it('svarer forskelligt på "hvor lang tid gik der", alt efter hvilket ur man spørger', () => {
    const rows = store.db.select().from(realm).where(eq(realm.worldId, worldId)).all();
    const clocks = new RealmClocks(rows.map((r) => ({
      id: r.id, parentRealmId: r.parentRealmId,
      timeRatioNum: r.timeRatioNum, timeRatioDen: r.timeRatioDen,
      parentEpoch: r.parentEpoch, localEpoch: r.localEpoch,
    })));

    const tenMinutes = 10 * SECONDS.MINUTE;
    assert.equal(formatSpan(clocks.spanFromRoot(realmIds[1]!, tenMinutes)), '3 timer 20 minutter');
    assert.equal(formatSpan(clocks.spanFromRoot(realmIds[2]!, tenMinutes)), '2 døgn 19 timer');
    assert.equal(formatSpan(clocks.spanFromRoot(realmIds[3]!, tenMinutes)), '56 døgn');
  });

  it('lader kroppen sove ovenpå, mens personen arbejder nedenunder', () => {
    const cobb = store.sqlite.prepare('select id from entity where name = ?').get('Cobb') as { id: string };
    const epoch = store.db.select().from(event).where(eq(event.title, 'Man falder i søvn')).get()!.earliest!;
    const everywhere = whoWasWhere(store, ctx, { from: epoch + 60, entityId: cobb.id });

    assert.ok(everywhere.length >= 2, 'han er både i varevognen og i drømmen');
    assert.equal(new Set(everywhere.map((p) => p.realmId)).size, everywhere.length,
      'men aldrig to steder i det samme lag');
  });

  it('lader dig selv bestemme, om man husker drømmen', () => {
    const laws = store.sqlite.prepare('select statement, hardness from law where world_id = ?')
      .all(worldId) as { statement: string; hardness: string }[];
    assert.ok(laws.some((l) => l.hardness === 'soft' && /husker drømmen/.test(l.statement)),
      'det er en lov, du sætter — ikke noget værktøjet gætter');
  });

  it('knytter limbo-passagen til stedet i biblen', () => {
    const place = store.db.select().from(entity).where(eq(entity.name, 'Kysten')).get()!;
    const anchor = store.db.select().from(textAnchor)
      .where(eq(textAnchor.targetId, place.id)).get();
    assert.equal(anchor?.targetKind, 'entity');
    assert.match(anchor?.excerpt ?? '', /Byen ved kysten/);
  });
});

/**
 * Prøvecasene skal have vægt.
 *
 * Et kapitel med én scene og én synsvinkel beviser næsten ingenting: en model
 * kan holde til det uden at kunne holde til en bog. Det, der her måles, er
 * ikke plottet, men de steder hvor tyndhed ville skjule en fejl — flere scener
 * i det samme kapitel, mere end ét hoved at fortælle fra, prosa på siden, og
 * en kronologi der ikke bare følger læserækkefølgen.
 */
describe('Prøvecasene har vægt nok til at bevise noget', () => {
  /**
   * `outOfOrder` er den ene egenskab, der ikke gælder alle.
   *
   * De tre film er valgt, fordi de bryder med kronologien inde i bogen. Havnen
   * er valgt af en anden grund: den er en serie, og hver af dens to bind
   * fortælles pænt fremad. Den afstand, den prøver, ligger mellem bindene --
   * læseren af «Tidevandet» har «Saltet» med sig -- og den prøves i
   * `series.test.ts`. At kræve et tilbageblik her ville være at skrive
   * historien om, så prøven kunne blive tilfreds.
   */
  const worlds = [
    { name: 'Memento', load: loadMemento, minScenes: 20, minChapters: 8, outOfOrder: true },
    { name: 'Predestination', load: loadPredestination, minScenes: 9, minChapters: 5, outOfOrder: true },
    { name: 'Inception', load: loadInception, minScenes: 9, minChapters: 4, outOfOrder: true },
    // Serien måles per bog. Den blev bygget efter de tre film og slap uden om
    // vægtprøven i starten -- og var derfor den tyndeste af dem alle sammen.
    {
      name: 'Havnen: Saltet',
      load: (store: Store) => {
        const loaded = loadHavnen(store);
        return { worldId: loaded.worldId, workId: loaded.firstWorkId };
      },
      minScenes: 9, minChapters: 5, outOfOrder: false,
    },
    {
      name: 'Havnen: Tidevandet',
      load: (store: Store) => {
        const loaded = loadHavnen(store);
        return { worldId: loaded.worldId, workId: loaded.secondWorkId };
      },
      minScenes: 7, minChapters: 4, outOfOrder: false,
    },
  ];

  for (const world of worlds) {
    describe(world.name, () => {
      const store = openStore(':memory:');
      const { worldId, workId } = world.load(store);
      const ctx = new Workbench(store).setActive({ worldId, workId });
      const chapters = store.db.select().from(chapter)
        .where(eq(chapter.workId, workId)).all().sort((a, b) => a.position - b.position);
      const scenes = chapters.flatMap((c) =>
        store.db.select().from(scene).where(eq(scene.chapterId, c.id)).all());

      it('har kapitler med mere end én scene i', () => {
        assert.ok(chapters.length >= world.minChapters,
          `${chapters.length} kapitler, forventede mindst ${world.minChapters}`);
        assert.ok(scenes.length >= world.minScenes,
          `${scenes.length} scener, forventede mindst ${world.minScenes}`);
        const withSeveral = chapters.filter((c) =>
          scenes.filter((sc) => sc.chapterId === c.id).length > 1);
        assert.ok(withSeveral.length >= 2,
          'mindst to kapitler skal rumme flere scener — ellers prøves nummereringen aldrig');
      });

      it('fortælles fra mere end ét sted', () => {
        // Enten flere personer, eller flere ben af den samme. Begge dele er en
        // synsvinkel, og begge dele skal give forskellige svar.
        const heads = new Set(scenes.map((sc) => `${sc.povEntityId}:${sc.povLegId ?? ''}`));
        assert.ok(heads.size >= 2, `kun ${heads.size} synsvinkel — så prøves den anden aldrig`);
      });

      it('beskriver alle personer, steder og ting', () => {
        const rows = store.db.select().from(entity).where(eq(entity.worldId, worldId)).all();
        assert.ok(rows.length > 0);
        for (const row of rows) {
          assert.ok((row.summary?.trim().length ?? 0) >= 60,
            `${row.name} har kun en tynd eller manglende beskrivelse`);
        }
      });

      it('hænger sammen med kronologien uden at følge den', () => {
        const links = store.db.select().from(sceneEvent)
          .where(eq(sceneEvent.branchId, ctx.branchId)).all()
          .filter((l) => scenes.some((sc) => sc.id === l.sceneId));
        assert.equal(
          scenes.filter((sc) => !links.some((l) => l.sceneId === sc.id)).length, 0,
          'hver scene skal hænge på et event, ellers kan den ikke placeres i tiden',
        );
        if (!world.outOfOrder) return;
        const ranks = scenes
          .map((sc) => links.find((l) => l.sceneId === sc.id))
          .map((l) => store.db.select().from(event).where(eq(event.id, l!.eventId)).get()!)
          .map((e) => e.solvedEarliest ?? e.earliest);
        assert.notDeepEqual(ranks, [...ranks].sort((a, b) => (a ?? 0) - (b ?? 0)),
          'bogen må ikke fortælles i den rækkefølge, tingene skete — så prøves de to akser ikke');
      });

      it('har læsbar prøveprosa i hver scene', () => {
        // Filtreret ned til bogens egne scener. En serie har flere bøger i den
        // samme gren, og uden det her tælles bind to med i bind ets regnskab.
        const written = store.db.select().from(sceneText)
          .where(eq(sceneText.branchId, ctx.branchId)).all()
          .filter((text) => text.isCurrent)
          .filter((text) => scenes.some((sc) => sc.id === text.sceneId));
        assert.equal(written.length, scenes.length,
          `${scenes.length - written.length} scener mangler prosa`);
        for (const text of written) {
          assert.ok((text.wordCount ?? 0) >= 30,
            `sceneteksten ${text.id} er for tynd (${text.wordCount ?? 0} ord)`);
        }
      });

      it('peger fra prosaen tilbage på bibelen', () => {
        // Fase 9 kunne sætte omtaler, men ingen prøvecase indeholdt en. Så stod
        // funktionen der usynligt: den, der åbnede appen, kunne ikke se, hvad
        // @-menuen egentlig laver, og havde intet at klikke på.
        const codes = store.db.select().from(sceneText)
          .where(eq(sceneText.branchId, ctx.branchId)).all()
          .filter((text) => text.isCurrent)
          .filter((text) => scenes.some((sc) => sc.id === text.sceneId))
          .flatMap((text) => mentionedCodes(text.doc));
        assert.ok(codes.length > 0, 'ingen omtale i prosaen — så kan @-menuen ikke ses i brug');
        for (const code of codes) {
          assert.ok(store.db.select().from(storyReference).where(and(
            eq(storyReference.branchId, ctx.branchId), eq(storyReference.code, code),
          )).get(), `omtalen ${code} peger på en kode, der ikke findes på grenen`);
        }
      });

      it('har mindst én plottråd med både setup og payoff', () => {
        const lines = store.db.select().from(thread).where(eq(thread.workId, workId)).all();
        assert.ok(lines.length > 0, 'prøvehistorien skal vise kontinuitetens plottråde');
        assert.ok(lines.some((line) => {
          const items = store.db.select().from(beat).where(eq(beat.threadId, line.id)).all();
          return items.some((item) => item.kind === 'setup')
            && items.some((item) => item.kind === 'payoff');
        }), 'mindst én tråd skal vise hele bevægelsen fra setup til payoff');
      });
    });
  }
});
