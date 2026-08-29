import { inTurn } from '../core/changelog';
import type { Store } from '../db/client';
import { SECONDS, parseInstant } from '../core/time/gregorian';
import {
  createEntity, createPlaceLink, recordPossession, recordPresence,
} from '../core/services/entities';
import { addParticipation, createEvent, linkEventFact } from '../core/services/events';
import { attachFactToCarrier, createFact, recordBelief, recordStatement } from '../core/services/knowledge';
import {
  createChapter, createReveal, createScene, linkSceneToEvent, saveSceneText,
} from '../core/services/narrative';
import { createWorld, createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { markdownOf, paragraphs } from './prose';

const DAY = SECONDS.DAY;
const HOUR = SECONDS.HOUR;
const MIN = SECONDS.MINUTE;

/**
 * Memento, as a test of the model rather than a retelling.
 *
 * Two things are being pressed on. The colour strand is told backwards, so
 * chapter order and chronology run in opposite directions -- if the two axes
 * were one field, this fixture could not be written down at all. And Leonard
 * cannot form new memories, so his beliefs expire while what is written on his
 * polaroids does not: the difference between what he remembers and what he
 * knows is the whole character, and it has to survive being modelled.
 *
 * It is also the fixture that carries *weight*. Ten chapters of two and three
 * scenes each, four strands of chronology spread over two years, and six people
 * who each know a different subset of the same six facts -- because a model
 * that holds one scene per chapter proves very little. Most of what is
 * interesting here only appears at that density: a chapter whose scenes jump
 * between strands, a reader who is ahead of the viewpoint, a lie that has to
 * not be reported as a mistake.
 *
 * One deliberate departure from the film: two scenes are told from Natalie.
 * Memento never leaves Leonard, but a fixture that never leaves one head never
 * exercises the second head, and the point of these three worlds is to press on
 * the machinery rather than to be faithful.
 */
export function loadMemento(store: Store): { worldId: string; workId: string } {
  const created = createWorld(store, {
    name: 'Memento',
    summary: 'Prøvecase: fortællerorden mod kronologi, og viden der forsvinder.',
  });
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: created.worldId, userId: created.userId });
  const realmId = created.realmId;
  let workId = '';

  // Fire strækninger af kronologi. Sammy-sporet ligger halvandet år før alt
  // andet, og det er meningen: tidslinjen skal kunne rumme både et tyndt og et
  // tæt sted uden at det ene bliver usynligt.
  const sammyEra = parseInstant('1998-06-04').earliest;
  const assault = parseInstant('1999-12-12T23:40').earliest;
  const bwStart = parseInstant('2000-03-01').earliest;
  const colourStart = parseInstant('2000-03-06T09:00').earliest;

  inTurn(store, {
    branchId: ctx.branchId,
    actor: { kind: 'system' },
    summary: 'Indlæs Memento',
  }, (s) => {
    workId = createWork(s, ctx, {
      title: 'Memento',
      summary: 'Farvesporet baglæns, Sammy Jankis-sporet forlæns, og natten imellem dem.',
    });

    // ---------------------------------------------------------------- personer
    const leonard = createEntity(s, ctx, {
      name: 'Leonard', kind: 'person',
      summary: 'Kan ikke danne nye erindringer. Husker alt før overfaldet.',
    });
    const teddy = createEntity(s, ctx, {
      name: 'Teddy', kind: 'person', summary: 'Siger han hjælper. Hedder John Edward Gammell.',
    });
    const natalie = createEntity(s, ctx, {
      name: 'Natalie', kind: 'person', summary: 'Bartender. Har sine egne grunde.',
    });
    const burt = createEntity(s, ctx, {
      name: 'Burt', kind: 'person', summary: 'Receptionist på motellet. Udlejer to værelser til den samme mand.',
    });
    const dodd = createEntity(s, ctx, { name: 'Dodd', kind: 'person' });
    const jimmy = createEntity(s, ctx, { name: 'Jimmy Grantz', kind: 'person' });
    const wife = createEntity(s, ctx, { name: 'Leonards kone', kind: 'person' });
    const sammy = createEntity(s, ctx, {
      name: 'Sammy Jankis', kind: 'person',
      summary: 'Forsikringssag. Om han findes, er hele spørgsmålet.',
    });

    // ------------------------------------------------------------------ steder
    const motel = createEntity(s, ctx, { name: 'Motellet', kind: 'place' });
    const bar = createEntity(s, ctx, { name: 'Baren', kind: 'place' });
    const natalieHome = createEntity(s, ctx, { name: 'Natalies hus', kind: 'place' });
    const derelict = createEntity(s, ctx, { name: 'Den forladte bygning', kind: 'place' });
    const parlour = createEntity(s, ctx, { name: 'Tatoveringsbutikken', kind: 'place' });
    const home = createEntity(s, ctx, { name: 'Leonards hus', kind: 'place' });
    const office = createEntity(s, ctx, { name: 'Forsikringskontoret', kind: 'place' });

    // Rejsetid er en hård grænse, og den kan kun løftes af en evne. Her er den
    // skrevet ned, så reglen har noget at regne på — og så farvesporets
    // køreplan bliver prøvet af hver gang prøverne kører.
    const route = (from: string, to: string, minutes: number) =>
      createPlaceLink(s, ctx, {
        realmId, fromPlaceId: from, toPlaceId: to, mode: 'i bil', travelMin: minutes * MIN,
      });
    route(motel, bar, 12);
    route(motel, natalieHome, 20);
    route(motel, derelict, 25);
    route(motel, parlour, 8);
    route(bar, natalieHome, 10);
    route(bar, derelict, 18);
    route(natalieHome, derelict, 15);

    // ------------------------------------------------------------------- fakta
    // Sandheden om Teddy er netop dét, filmen nægter at afgøre. "undecided" er
    // et fortællegreb, ikke sjusk, og motoren skal lade det være.
    const teddyFact = createFact(s, ctx, {
      predicate: 'kan_stoles_paa', summary: 'Teddy kan ikke stoles på', realmId,
      truth: 'undecided',
      slots: [{ name: 'person', valueKind: 'entity', value: { entityId: teddy } }],
    });
    const sammyFact = createFact(s, ctx, {
      predicate: 'sammy_findes', summary: 'Sammy Jankis er en anden end Leonard', realmId,
      truth: 'disputed',
      slots: [{ name: 'person', valueKind: 'entity', value: { entityId: sammy } }],
    });
    // To pladser, og de bliver udfyldt hver for sig. Leonard ved fra første
    // side, at nogen dræbte hende; hvem det var, er hele bogen.
    const murderFact = createFact(s, ctx, {
      predicate: 'draebte', summary: 'John G. dræbte Leonards kone', realmId,
      slots: [
        { name: 'offer', valueKind: 'entity', value: { entityId: wife } },
        { name: 'gerningsmand', valueKind: 'text', value: { text: 'John G.' } },
      ],
    });
    const teddyIsJohnG = createFact(s, ctx, {
      predicate: 'hedder', summary: 'Teddy hedder John Edward Gammell', realmId,
      slots: [{ name: 'person', valueKind: 'entity', value: { entityId: teddy } }],
    });
    // Natalie ved det. Leonard får det aldrig at vide. Afstanden mellem de to
    // er den dramatiske ironi, og den skal kunne læses af skrivebordet.
    const natalieUses = createFact(s, ctx, {
      predicate: 'bruger', summary: 'Natalie bruger Leonard mod Dodd', realmId,
      slots: [
        { name: 'bruger', valueKind: 'entity', value: { entityId: natalie } },
        { name: 'redskab', valueKind: 'entity', value: { entityId: leonard } },
      ],
    });
    const jimmyFact = createFact(s, ctx, {
      predicate: 'draebte', summary: 'Leonard dræbte Jimmy Grantz', realmId,
      slots: [{ name: 'offer', valueKind: 'entity', value: { entityId: jimmy } }],
    });

    // ------------------------------------------------------------ ting og skrift
    const polaroidTeddy = createEntity(s, ctx, { name: 'Polaroid af Teddy', kind: 'object' });
    const polaroidNatalie = createEntity(s, ctx, { name: 'Polaroid af Natalie', kind: 'object' });
    const tattoo = createEntity(s, ctx, {
      name: 'Tatoveringen på brystet', kind: 'object',
      summary: 'JOHN G. VOLDTOG OG DRÆBTE MIN KONE. Den kan ikke lægges fra sig.',
    });

    // ============================================================== kronologien
    // 1998: Sammy-sporet. Leonard er efterforsker og tror stadig på sin egen historie.
    const sammyStrand = [
      { title: 'Sagen lander på bordet', place: office, day: 0 },
      { title: 'Prøven med de elektriske genstande', place: office, day: 9 },
      { title: 'Sammys kone beder om insulinen', place: office, day: 41 },
    ].map((entry) => createEvent(s, ctx, {
      title: entry.title, realmId, placeId: entry.place,
      earliest: sammyEra + entry.day * DAY,
      latest: sammyEra + entry.day * DAY + 8 * HOUR,
      durationMin: HOUR, precision: 'day',
    }));

    // 1999: natten. Alt før denne husker han; intet efter.
    const theNight = createEvent(s, ctx, {
      title: 'Overfaldet', realmId, placeId: home,
      earliest: assault, latest: assault, durationMin: 20 * MIN, precision: 'minute',
    });

    // 2000, 1.–5. marts: det sort-hvide spor. Motelværelset og telefonen.
    const bwStrand = [1, 2, 3, 4, 5].map((n) => createEvent(s, ctx, {
      title: `Telefonsamtalen, aften ${n}`, realmId, placeId: motel,
      earliest: bwStart + (n - 1) * DAY + 21 * HOUR,
      latest: bwStart + (n - 1) * DAY + 23 * HOUR,
      durationMin: 40 * MIN, precision: 'hour',
    }));
    const tattooDay = createEvent(s, ctx, {
      title: 'Han får den sidste tatovering', realmId, placeId: parlour,
      earliest: bwStart + 4 * DAY + 14 * HOUR,
      latest: bwStart + 4 * DAY + 16 * HOUR,
      durationMin: HOUR, precision: 'hour',
    });

    // 2000, 6. marts: farvesporet. Fortælles baglæns, sker forlæns.
    const colour = [
      { title: 'Jimmy kommer til den forladte bygning', place: derelict, at: 0 },
      { title: 'Teddy dukker op i kælderen', place: derelict, at: 40 * MIN },
      { title: 'Han kører til motellet med Jimmys bil', place: motel, at: 2 * HOUR },
      { title: 'Natalie kommer forbi værelset', place: motel, at: 4 * HOUR },
      { title: 'Dodd bliver lukket inde i skabet', place: motel, at: 6 * HOUR },
      { title: 'Natalie tager ham med hjem', place: natalieHome, at: 8 * HOUR },
      { title: 'Han vågner hos Natalie', place: natalieHome, at: 14 * HOUR },
      { title: 'Han skriver på polaroiden af Teddy', place: bar, at: 17 * HOUR },
      { title: 'Teddy fortæller ham sandheden', place: bar, at: 18 * HOUR },
      { title: 'Han vælger at glemme det', place: bar, at: 18 * HOUR + 40 * MIN },
    ].map((entry) => createEvent(s, ctx, {
      title: entry.title, realmId, placeId: entry.place,
      earliest: colourStart + entry.at, latest: colourStart + entry.at + 10 * MIN,
      durationMin: 20 * MIN, precision: 'minute',
    }));

    // --------------------------------------------------------------- deltagere
    const be = (
      eventId: string, entityId: string,
      role: 'actor' | 'witness' | 'victim' | 'present_unaware' | 'mentioned' = 'actor',
    ) => addParticipation(s, ctx, { eventId, entityId, role });

    sammyStrand.forEach((id) => { be(id, leonard); be(id, sammy, 'witness'); });
    be(theNight, leonard, 'victim');
    be(theNight, wife, 'victim');
    bwStrand.forEach((id) => be(id, leonard));
    be(tattooDay, leonard);

    be(colour[0]!, leonard); be(colour[0]!, jimmy, 'victim');
    be(colour[1]!, leonard); be(colour[1]!, teddy, 'witness');
    be(colour[2]!, leonard);
    be(colour[3]!, leonard); be(colour[3]!, natalie);
    be(colour[4]!, leonard); be(colour[4]!, dodd, 'victim');
    be(colour[5]!, leonard); be(colour[5]!, natalie);
    be(colour[6]!, leonard); be(colour[6]!, natalie, 'witness');
    be(colour[7]!, leonard);
    be(colour[8]!, leonard); be(colour[8]!, teddy);
    be(colour[9]!, leonard); be(colour[9]!, teddy, 'present_unaware');

    // Burt ser ham komme og gå, men opdager aldrig noget. Rollen findes præcis
    // for det: til stede, uden at tage noget til sig.
    be(colour[2]!, burt, 'present_unaware');
    be(colour[4]!, burt, 'present_unaware');

    // ------------------------------------------------- hvad hvilke events viser
    sammyStrand.slice(1).forEach((id) =>
      linkEventFact(s, ctx, { eventId: id, factId: sammyFact.factId, exposes: 'evidences' }));
    // Natten viser, at nogen dræbte hende — ikke hvem. Den anden plads bliver
    // stående åben resten af bogen, og det er hele motoren i historien.
    linkEventFact(s, ctx, {
      eventId: theNight, factId: murderFact.factId, exposes: 'establishes',
      slotIds: [murderFact.slotIds.get('offer')!],
    });
    linkEventFact(s, ctx, { eventId: colour[0]!, factId: jimmyFact.factId, exposes: 'establishes' });
    linkEventFact(s, ctx, { eventId: colour[8]!, factId: teddyIsJohnG.factId, exposes: 'reveals' });
    linkEventFact(s, ctx, { eventId: colour[8]!, factId: teddyFact.factId, exposes: 'evidences' });

    // ------------------------------------------------------------------- viden
    // Alt før overfaldet husker han for altid.
    recordBelief(s, ctx, {
      entityId: leonard, factId: murderFact.factId, strength: 'knows',
      sincePersonal: assault, slotIds: murderFact.slotIds,
      binds: { offer: { entityId: wife } },
      note: 'Han ved, hun er død. Hvem der gjorde det, er den åbne plads.',
    });
    recordBelief(s, ctx, {
      entityId: leonard, factId: sammyFact.factId, strength: 'convinced',
      sincePersonal: sammyEra, slotIds: sammyFact.slotIds,
      binds: { person: { entityId: sammy } },
      note: 'Fra før skaden, så den holder. Om den er sand, er en anden sag.',
    });

    // Og alt efter holder et kvarter.
    recordBelief(s, ctx, {
      entityId: leonard, factId: teddyIsJohnG.factId, strength: 'knows',
      sincePersonal: colourStart + 18 * HOUR,
      untilPersonal: colourStart + 18 * HOUR + 15 * MIN,
      sourceEventId: colour[8], slotIds: teddyIsJohnG.slotIds,
      binds: { person: { entityId: teddy } },
      note: 'Erindringen holder et kvarter. Derefter er den væk.',
    });
    recordBelief(s, ctx, {
      entityId: leonard, factId: teddyFact.factId, strength: 'convinced',
      sincePersonal: colourStart + 17 * HOUR,
      untilPersonal: colourStart + 17 * HOUR + 15 * MIN,
      sourceEventId: colour[7], slotIds: teddyFact.slotIds,
      binds: { person: { entityId: teddy } },
    });
    // Han lærer aldrig, hvad Natalie er ude på. Det siger vi rent ud, så
    // motoren ikke regner sig frem til noget andet.
    recordBelief(s, ctx, {
      entityId: leonard, factId: natalieUses.factId, strength: 'unaware',
      sincePersonal: assault,
    });

    /**
     * Og det, han lærer ved at være til stede, glemmer han også.
     *
     * Udledt viden har ingen udløbsdato i modellen — den følger af, at man var
     * der, og det bliver man ved med at have været. For alle andre er det
     * rigtigt. For Leonard er det ikke, og det skal siges med en `unaware`, der
     * begynder et kvarter efter: den slår alt andet fra, også det udledte.
     *
     * At det tager to rækker at skrive «hun husker det i et kvarter» er værd at
     * lægge mærke til. Det er ikke forkert, men en person, der slet ikke danner
     * erindringer, burde kunne siges én gang.
     */
    recordBelief(s, ctx, {
      entityId: leonard, factId: jimmyFact.factId, strength: 'knows',
      sincePersonal: colourStart, untilPersonal: colourStart + 15 * MIN,
      sourceEventId: colour[0], slotIds: jimmyFact.slotIds,
      binds: { offer: { entityId: jimmy } },
    });
    recordBelief(s, ctx, {
      entityId: leonard, factId: jimmyFact.factId, strength: 'unaware',
      sincePersonal: colourStart + 15 * MIN,
      note: 'Et kvarter efter er det væk, også selv om han selv gjorde det.',
    });

    // De andre husker som mennesker gør.
    recordBelief(s, ctx, {
      entityId: natalie, factId: natalieUses.factId, strength: 'knows',
      sincePersonal: colourStart + 4 * HOUR, slotIds: natalieUses.slotIds,
      binds: { bruger: { entityId: natalie }, redskab: { entityId: leonard } },
    });
    recordBelief(s, ctx, {
      entityId: natalie, factId: teddyIsJohnG.factId, strength: 'unaware',
      sincePersonal: colourStart,
    });
    recordBelief(s, ctx, {
      entityId: teddy, factId: teddyIsJohnG.factId, strength: 'knows',
      sincePersonal: assault, slotIds: teddyIsJohnG.slotIds,
      binds: { person: { entityId: teddy } },
    });
    recordBelief(s, ctx, {
      entityId: teddy, factId: jimmyFact.factId, strength: 'knows',
      sincePersonal: colourStart + 40 * MIN, slotIds: jimmyFact.slotIds,
      binds: { offer: { entityId: jimmy } },
    });

    // --------------------------------------------------------------- det sagte
    // Leonard fortæller Sammy-historien i telefonen, og han mener den. En sand
    // udtalelse om noget, taleren faktisk ved, skal motoren tie om.
    bwStrand.forEach((eventId) => recordStatement(s, ctx, {
      speakerEntityId: leonard, factId: sammyFact.factId, truthful: true,
      eventId, slotIds: sammyFact.slotIds, binds: { person: { entityId: sammy } },
      note: 'Han fortæller det igen og igen, fordi han ikke kan huske at have fortalt det.',
    }));
    // Teddy lyver. En løgn er en handling, ikke en fejl, og reglen skal lade
    // den stå — det er derfor `truthful` findes.
    recordStatement(s, ctx, {
      speakerEntityId: teddy, factId: teddyIsJohnG.factId, truthful: false,
      eventId: colour[1], audienceEntityId: leonard,
      note: 'Han siger, han hedder Teddy. Det gør han ikke.',
    });
    recordStatement(s, ctx, {
      speakerEntityId: natalie, factId: natalieUses.factId, truthful: false,
      eventId: colour[3], audienceEntityId: leonard,
      note: 'Hun siger, hun vil hjælpe ham.',
    });

    // ---------------------------------------------------- skrift og besiddelse
    attachFactToCarrier(s, ctx, {
      objectEntityId: polaroidTeddy, factId: teddyFact.factId,
      slotIds: teddyFact.slotIds, binds: { person: { entityId: teddy } },
      writtenEventId: colour[7], note: 'Håndskrift på bagsiden: STOL IKKE PÅ HANS LØGNE',
    });
    attachFactToCarrier(s, ctx, {
      objectEntityId: polaroidNatalie, factId: natalieUses.factId, accurate: false,
      writtenEventId: colour[6], note: 'Bagsiden siger, hun hjælper ham af medfølelse. Det passer ikke.',
    });
    attachFactToCarrier(s, ctx, {
      objectEntityId: tattoo, factId: murderFact.factId,
      slotIds: murderFact.slotIds, binds: { offer: { entityId: wife } },
      writtenEventId: theNight, note: 'JOHN G. VOLDTOG OG DRÆBTE MIN KONE',
    });

    recordPossession(s, ctx, {
      holderEntityId: leonard, objectEntityId: tattoo, fromTime: assault,
      note: 'Den kan ikke lægges fra sig. Det er hele pointen med den.',
    });
    recordPossession(s, ctx, {
      holderEntityId: leonard, objectEntityId: polaroidTeddy,
      fromTime: colourStart + 17 * HOUR, toTime: colourStart + 30 * DAY,
    });
    recordPossession(s, ctx, {
      holderEntityId: leonard, objectEntityId: polaroidNatalie,
      fromTime: colourStart + 14 * HOUR, toTime: colourStart + 30 * DAY,
    });

    // Han bor på motellet hele det sort-hvide spor. Et ophold er ikke et krav
    // om, at han aldrig gik ud — det er derfor bilokationen tier om ærinderne.
    recordPresence(s, ctx, {
      entityId: leonard, placeId: motel, realmId,
      fromTime: bwStart, toTime: colourStart + 20 * HOUR,
    });

    // ============================================================== fortællingen
    interface SceneSpec {
      title: string;
      event: string;
      pov?: string;
      mode?: 'dramatised' | 'mentioned' | 'implied';
      reveals?: { factId: string; slotId?: string; strength: 'hinted' | 'implied' | 'stated' | 'confirmed' }[];
      prose?: string[];
    }

    /**
     * Ti kapitler, to og tre scener i hvert. Det sort-hvide spor går forlæns,
     * farvesporet baglæns, og de er flettet ind i hinanden — så et kapitel og
     * det næste kan ligge et halvt døgn fra hinanden i hver sin retning.
     */
    const book: { title: string; summary: string; scenes: SceneSpec[] }[] = [
      {
        title: 'S/H 1 — Værelset',
        summary: 'Han vågner et sted, han ikke kan huske at være kommet til.',
        scenes: [
          {
            title: 'Nogen har ringet', event: bwStrand[0]!,
            prose: [
              'Telefonen står på natbordet med røret ved siden af, og han kan ikke huske at have lagt det der.',
              'Han begynder forfra. Man begynder altid forfra: navnet, værelset, hvorfor man er her. Så begynder han at fortælle om Sammy Jankis, fordi det er den historie, han kan.',
            ],
          },
          { title: 'Sagen om Sammy', event: sammyStrand[0]!, mode: 'dramatised' },
        ],
      },
      {
        title: 'Farve 10 — Baren, til sidst',
        summary: 'Sidst i bogen. Først på dagen han vælger.',
        scenes: [
          { title: 'Teddy siger det hele', event: colour[8]!, reveals: [
            { factId: teddyIsJohnG.factId, slotId: teddyIsJohnG.slotIds.get('person'), strength: 'confirmed' },
            { factId: jimmyFact.factId, strength: 'stated' },
          ] },
          {
            title: 'Han vælger', event: colour[9]!,
            reveals: [{ factId: murderFact.factId, slotId: murderFact.slotIds.get('gerningsmand'), strength: 'implied' }],
            prose: [
              'Han lukker øjnene og tæller. Når han lukker dem længe nok, er der ingenting bag dem, og så kan han bestemme, hvad der skal stå.',
              'Han skriver det ned, som han gerne vil vågne op til.',
            ],
          },
        ],
      },
      {
        title: 'S/H 2 — Prøven',
        summary: 'Sammy kunne ikke lære det. Eller kunne han.',
        scenes: [
          { title: 'Endnu et opkald', event: bwStrand[1]! },
          { title: 'De elektriske genstande', event: sammyStrand[1]!,
            reveals: [{ factId: sammyFact.factId, strength: 'hinted' }] },
        ],
      },
      {
        title: 'Farve 9 — Polaroiden',
        summary: 'Han skriver noget ned, han om et kvarter kun har på papir.',
        scenes: [
          { title: 'Han skriver på bagsiden', event: colour[7]!,
            reveals: [{ factId: teddyFact.factId, strength: 'stated' }] },
        ],
      },
      {
        title: 'S/H 3 — Konen',
        summary: 'Fru Jankis stiller det spørgsmål, der ikke kan stilles.',
        scenes: [
          { title: 'Tredje aften', event: bwStrand[2]! },
          { title: 'Hun beder om insulinen', event: sammyStrand[2]!,
            reveals: [{ factId: sammyFact.factId, strength: 'implied' }] },
          { title: 'Natten, i glimt', event: theNight, mode: 'implied',
            reveals: [{ factId: murderFact.factId, slotId: murderFact.slotIds.get('offer'), strength: 'stated' }] },
        ],
      },
      {
        title: 'Farve 8 — Morgenen efter',
        summary: 'To scener i det samme hus, fortalt fra hver sin side.',
        scenes: [
          { title: 'Han vågner hos Natalie', event: colour[6]! },
          // Filmen forlader aldrig Leonard. Det gør vi her, netop for at prøve
          // det andet hoved af: samme hus, samme morgen, to helt andre svar.
          { title: 'Natalie ser på ham', event: colour[6]!, pov: natalie,
            reveals: [{ factId: natalieUses.factId, strength: 'hinted' }],
            prose: [
              'Han sover som en, der ikke har noget at være bange for. Hun ved godt hvorfor: han kan ikke huske nok til at være det.',
              'Hun lader være med at vække ham. Det er nemmere at bruge en mand, der begynder forfra.',
            ] },
        ],
      },
      {
        title: 'S/H 4 — Tatoveringen',
        summary: 'Det, der ikke kan lægges fra sig.',
        scenes: [
          { title: 'Fjerde aften', event: bwStrand[3]! },
          { title: 'Nålen', event: tattooDay },
        ],
      },
      {
        title: 'Farve 7 — Aftalen',
        summary: 'Hun tager ham med hjem, og han skriver ikke ned hvorfor.',
        scenes: [
          { title: 'Natalie henter ham', event: colour[5]! },
          { title: 'Hun får det, hun kom efter', event: colour[5]!, pov: natalie,
            reveals: [{ factId: natalieUses.factId, strength: 'stated' }] },
        ],
      },
      {
        title: 'S/H 5 — Sidste aften',
        summary: 'Han lægger på og kan ikke huske hvem han talte med.',
        scenes: [
          { title: 'Femte aften', event: bwStrand[4]! },
        ],
      },
      {
        title: 'Farve 1–6 — Dagen, baglæns',
        summary: 'Seks scener, der hver især begynder, hvor den forrige ikke sluttede.',
        scenes: [
          { title: 'Dodd i skabet', event: colour[4]! },
          { title: 'Natalie kommer forbi', event: colour[3]! },
          { title: 'Bilen på parkeringspladsen', event: colour[2]! },
          { title: 'Teddy i kælderen', event: colour[1]! },
          { title: 'Jimmy', event: colour[0]!,
            reveals: [{ factId: jimmyFact.factId, strength: 'confirmed' }] },
        ],
      },
    ];

    book.forEach((chapter, chapterIndex) => {
      const chapterId = createChapter(s, ctx, store, {
        workId, title: chapter.title, position: chapterIndex + 1, summary: chapter.summary,
      });
      chapter.scenes.forEach((spec, sceneIndex) => {
        const sceneId = createScene(s, ctx, store, {
          chapterId, title: spec.title, position: sceneIndex + 1,
          povEntityId: spec.pov ?? leonard,
          narrationPerson: 'third_limited', narrationTense: 'present', realmId,
        });
        linkSceneToEvent(s, ctx, {
          sceneId, eventId: spec.event, mode: spec.mode ?? 'dramatised',
        });
        for (const shown of spec.reveals ?? []) {
          createReveal(s, ctx, {
            factId: shown.factId, sceneId,
            slotId: shown.slotId, strength: shown.strength,
          });
        }
        if (spec.prose) {
          saveSceneText(s, ctx, store, {
            sceneId, doc: paragraphs(...spec.prose), markdown: markdownOf(...spec.prose),
          });
        }
      });
    });
  });

  bench.setActive({ worldId: created.worldId, workId });
  return { worldId: created.worldId, workId };
}
