import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { openStore } from '../db/client';
import { chapter, entity, reveal, scene } from '../db/schema';
import { bandView } from '../core/queries/band';
import { sceneDesk } from '../core/queries/desk';
import { knowledgeTrack } from '../core/queries/track';
import { lawsLifting } from '../core/laws/consult';
import { inTurn } from '../core/changelog';
import { createLaw } from '../core/services/laws';
import { solveTime } from '../core/solve';
import { Workbench } from '../core/workbench';
import { loadMemento, loadPredestination } from '../fixtures';

/**
 * Phase two is the writing desk and the band, and both are answers about the
 * gap between the two axes. These tests check the gap, not the layout.
 */

describe('Skrivebordet — hvad synsvinklen ved her', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadMemento(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId });
  solveTime(store, ctx);

  const chapters = store.db.select().from(chapter).where(eq(chapter.workId, workId)).all()
    .sort((a, b) => a.position - b.position);
  // Scener slås op på deres egen titel frem for på kapitlets, fordi et kapitel
  // nu rummer flere af dem. At bruge den første scene i kapitlet ville være at
  // prøve noget andet end det, prøven hedder.
  const sceneOf = (title: string) => {
    const all = chapters.flatMap((c) =>
      store.db.select().from(scene).where(eq(scene.chapterId, c.id)).all());
    const found = all.find((sc) => sc.title === title);
    assert.ok(found, `scenen «${title}» findes ikke i prøvecasen`);
    return found;
  };

  it('placerer scenen i tiden ud fra det, den dramatiserer', () => {
    const desk = sceneDesk(store, ctx, { sceneId: sceneOf('Teddy siger det hele').id });
    assert.equal(desk.moment.from, 'dramatised');
    assert.ok(desk.moment.at != null, 'scenen skal kunne dateres');
  });

  it('svarer for synsvinklen, ikke for fortælleren', () => {
    const desk = sceneDesk(store, ctx, { sceneId: sceneOf('Teddy siger det hele').id });
    assert.equal(desk.pov?.name, 'Leonard');
    assert.ok(desk.pov!.at != null, 'øjeblikket skal læses på hans eget ur');
  });

  it('læserens viden holdes adskilt fra personens', () => {
    // Twistet ligger i sidste kapitel. Før det har læseren intet fået.
    const early = sceneDesk(store, ctx, { sceneId: sceneOf('Nogen har ringet').id });
    assert.equal(early.readerKnows.length, 0, 'første scene giver læseren ingenting');

    const later = sceneDesk(store, ctx, { sceneId: sceneOf('Teddy siger det hele').id });
    assert.ok(later.readerKnows.length > 0, 'andet kapitel giver læseren twistet');
  });

  /**
   * Mementos inversion, læst af skrivebordet.
   *
   * Klokken sytten skriver han det på polaroiden, og der ved han det selv. Han
   * lærer det kort igen, da Teddy taler, men da han senere vælger, er også den
   * erindring løbet ud. Samme faktum, samme mand, to helt forskellige måder at
   * vide det på — og det er hele filmen.
   */
  it('skelner mellem det, han husker, og det, han bærer på sig', () => {
    const distrust = (sceneId: string) => {
      const desk = sceneDesk(store, ctx, { sceneId });
      return desk.pov!.knows.find((k) => k.summary.includes('Teddy kan ikke stoles på'));
    };

    const whenWriting = distrust(sceneOf('Han skriver på bagsiden').id);
    assert.equal(whenWriting?.source, 'derived', 'mens han skriver, husker han det selv');

    const afterTeddy = distrust(sceneOf('Han vælger').id);
    assert.equal(afterTeddy?.source, 'carried',
      'efter også den nye erindring er væk, er det polaroiden, der holder det');
  });

  it('går gennem bogen i læserækkefølge', () => {
    const first = sceneDesk(store, ctx, { sceneId: sceneOf('Nogen har ringet').id });
    assert.equal(first.previousSceneId, null, 'første scene har ingen forgænger');
    // Inden for kapitlet først, og så videre til det næste kapitel.
    assert.equal(first.nextSceneId, sceneOf('Sagen om Sammy').id);
    const second = sceneDesk(store, ctx, { sceneId: sceneOf('Sagen om Sammy').id });
    assert.equal(second.nextSceneId, sceneOf('Teddy siger det hele').id,
      'sidste scene i et kapitel fortsætter ind i det næste');
  });
});

describe('Skrivebordet — samme aften, to ben', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadPredestination(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId });
  solveTime(store, ctx);

  const sceneNamed = (title: string) => store.db.select().from(chapter)
    .where(eq(chapter.workId, workId)).all()
    .flatMap((c) => store.db.select().from(scene).where(eq(scene.chapterId, c.id)).all())
    .find((sc) => sc.title === title)!;

  const john = () => sceneDesk(store, ctx, { sceneId: sceneNamed('Jeg fortæller ham det hele').id });
  const barkeep = () =>
    sceneDesk(store, ctx, { sceneId: sceneNamed('Jeg har hørt den historie før').id });

  /**
   * De to scener fortæller det samme event om den samme person. Uden ben på
   * synsvinklen ville de få det samme svar — og det ville være forkert i begge.
   */
  it('svarer forskelligt for de to ben i samme rum', () => {
    assert.equal(john().pov?.legLabel, 'som John');
    assert.equal(barkeep().pov?.legLabel, 'som bartenderen');
    assert.notEqual(john().pov?.at, barkeep().pov?.at,
      'to aldre i det samme øjeblik af verdens tid');
  });

  it('lader kun det ben, der ved besked, vide besked', () => {
    const secret = (desk: ReturnType<typeof john>) =>
      desk.pov!.knows.some((k) => k.summary.includes('den samme'));
    assert.equal(secret(john()), false, 'John aner det ikke endnu');
    assert.equal(secret(barkeep()), true, 'bartenderen har levet det');
  });

  /**
   * Benet afgør, om synsvinklen var i rummet.
   *
   * Den rejsende deltager i afleveringen som bartenderen. En scene set gennem
   * John må derfor ikke tælle ham som til stede — det er den samme krop og et
   * helt andet menneske, og hele modellen står og falder med den forskel.
   */
  it('spørger om benet var til stede, ikke om personen', () => {
    const asJohn = sceneDesk(store, ctx, { sceneId: sceneNamed('Barnet, som det bliver fortalt').id });
    const dropOff = asJohn.tells.find((t) => t.title.includes('efterlades'))!;
    assert.equal(dropOff.povPresent, false, 'John har ikke levet den aften endnu');
    assert.deepEqual(asJohn.leaks, [], 'og så er der heller ikke noget at melde');

    const asBarkeep = sceneDesk(store, ctx, { sceneId: sceneNamed('Han lægger barnet fra sig').id });
    assert.equal(asBarkeep.tells[0]!.povPresent, true, 'bartenderen står selv på trappen');
  });

  it('lader et vink stå, og fanger kun den udtalte afsløring', () => {
    // Kapitel 1 antyder det for læseren, mens John intet ved. Det er
    // foregribelse, ikke en fejl, og skrivebordet skal tie om det.
    assert.deepEqual(john().leaks, [], 'et vink er ikke en lækage');
    // Kapitel 2 siger det rent ud — og dér ved synsvinklen det godt.
    assert.deepEqual(barkeep().leaks, []);
  });

  it('melder det, når læseren får noget udtalt, som synsvinklen ikke har', () => {
    // Samme afsløring, flyttet fra vink til bekræftelse i Johns scene.
    const johnScene = sceneNamed('Jeg fortæller ham det hele');
    const hint = store.db.select().from(reveal)
      .where(eq(reveal.sceneId, johnScene.id)).get()!;
    inTurn(store, { branchId: ctx.branchId, actor: { kind: 'user' } }, (s) => {
      s.update(reveal, hint.id, { strength: 'confirmed' });
    });

    const leaks = sceneDesk(store, ctx, { sceneId: johnScene.id }).leaks;
    assert.equal(leaks.length, 1);
    assert.equal(leaks[0]!.kind, 'unknown_reveal');
    assert.match(leaks[0]!.message, /Den rejsende ved det ikke/);
  });

  it('en evne kan løfte reglen, og så rapporteres den ikke', () => {
    const johnScene = sceneNamed('Jeg fortæller ham det hele');
    const before = sceneDesk(store, ctx, { sceneId: johnScene.id }).leaks.length;
    assert.ok(before > 0, 'der skal være noget at løfte');

    inTurn(store, { branchId: ctx.branchId, actor: { kind: 'user' } }, (s) => {
      createLaw(s, ctx, {
        kind: 'ability', hardness: 'hard', ruleCode: 'pov_leak',
        statement: 'Fortælleren i denne bog ved mere end den, der fortæller.',
      });
    });

    const after = sceneDesk(store, ctx, { sceneId: johnScene.id });
    assert.equal(after.leaks.length, 0, 'en evne slår reglen fra');
    assert.equal(after.lifted.length, before,
      'det, der ville være meldt, bliver stående som løftet af en lov');
  });

  it('en forbudslov løfter ingenting', () => {
    assert.equal(lawsLifting(store, ctx, { ruleCode: 'travel_time' }).length, 0);
  });
});

describe('Båndet — de to akser mod hinanden', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadMemento(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId });
  solveTime(store, ctx);

  const band = bandView(store, ctx, { workId });

  it('ser Mementos flettede struktur som spring bagud', () => {
    assert.ok(band.stats.backwards >= 4,
      `filmen springer bagud igen og igen, fik ${band.stats.backwards}`);
  });

  it('holder de to rækkefølger adskilt', () => {
    const readingOrder = band.scenes.map((s) => s.order);
    assert.deepEqual(readingOrder, [...readingOrder].sort((a, b) => a - b));
    const chronological = band.events.map((e) => e.from);
    assert.deepEqual(chronological, [...chronological].sort((a, b) => a - b));
  });

  it('tæller det, der er lagt ind men ikke fortalt', () => {
    assert.equal(band.stats.told + band.stats.untold, band.events.length);
  });

  it('giver hver tråd en scene og et event, der findes', () => {
    for (const r of band.ribbons) {
      assert.ok(band.scenes.some((s) => s.sceneId === r.sceneId));
      assert.ok(band.events.some((e) => e.eventId === r.eventId));
    }
  });
});

describe('Videnskurven — hvor viden ændrer sig', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadMemento(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId });
  solveTime(store, ctx);

  const leonard = store.db.select().from(entity).all()
    .find((e) => e.name === 'Leonard')!;

  it('stopper kun der, hvor noget faktisk sker', () => {
    const track = knowledgeTrack(store, ctx, { entityId: leonard.id });
    assert.ok(track.stops.length > 0);
    const times = track.stops.map((s) => s.at);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'stoppene er i rækkefølge');
  });

  it('viser at erindringen løber ud, og at polaroiden overtager', () => {
    const track = knowledgeTrack(store, ctx, { entityId: leonard.id });
    assert.ok(track.stops.some((s) => s.gained.length > 0), 'han lærer noget');
    // Antallet falder ikke, når hukommelsen svigter: han bærer det stadig på
    // sig. Det, der ændrer sig, er måden han ved det på — og det skal kurven
    // kunne se, ellers løber den fladt gennem filmens vigtigste øjeblik.
    const handover = track.stops.find((s) =>
      s.changed.some((c) => c.from === 'derived' && c.to === 'carried'));
    assert.ok(handover, 'erindringen giver slip, og skriften tager over');
  });

  it('lader polaroiden holde det, hukommelsen taber — indtil den er væk', () => {
    const track = knowledgeTrack(store, ctx, { entityId: leonard.id });
    const handovers = track.stops.filter((s) =>
      s.changed.some((c) => c.from === 'derived' && c.to === 'carried'));
    assert.ok(handovers.length >= 2,
      'han kan lære samme faktum igen og glemme det igen, mens skriften består');

    // Og da han mister den, er det først dér, han for alvor ikke ved det.
    const last = track.stops.at(-1)!;
    assert.match(last.why, /mister/);
    assert.ok(last.lost.length > 0, 'uden polaroiden er det endelig væk');
  });
});

describe('Videnskurven — flere ben', () => {
  const store = openStore(':memory:');
  const { worldId, workId } = loadPredestination(store);
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId, workId });
  solveTime(store, ctx);

  const traveller = () => store.db.select().from(entity).all()
    .find((e) => e.kind === 'person')!;

  it('svarer for ét ben ad gangen', () => {
    const track = knowledgeTrack(store, ctx, { entityId: traveller().id });
    assert.equal(track.legs.length, 4, 'fire ben af det samme liv');
    assert.ok(track.legId != null, 'et svar skal sige, hvilket ben det gælder');
  });

  it('kender hemmeligheden på det sidste ben og ikke på det første', () => {
    const knows = (ordinal: number) => {
      const t = knowledgeTrack(store, ctx, { entityId: traveller().id });
      const leg = t.legs.find((l) => l.ordinal === ordinal)!;
      const stops = knowledgeTrack(store, ctx, { entityId: traveller().id, legId: leg.id }).stops;
      return stops.at(-1)?.total ?? 0;
    };
    assert.equal(knows(1), 0, 'som Jane ved hun ingenting — det er hele pointen');
    assert.ok(knows(3) > 0, 'som bartenderen ved han det hele');
  });
});
