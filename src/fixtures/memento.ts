import { inTurn } from '../core/changelog';
import { eq, sql } from 'drizzle-orm';
import type { Store } from '../db/client';
import { change, chapter, reveal, scene } from '../db/schema';
import { createBranchFromHistory, moveReveal, moveScene } from '../core/branches';
import { SECONDS, parseInstant } from '../core/time/gregorian';
import {
  createEntity, createIdentity, createPlaceLink, createRelationship, recordDisappearance,
  recordEntityState, recordPossession, recordPresence, recordMemoryPolicy,
} from '../core/services/entities';
import { addParticipation, createEvent, linkEventFact } from '../core/services/events';
import { attachFactToCarrier, createFact, recordBelief, recordStatement } from '../core/services/knowledge';
import {
  createBeat, createChapter, createReveal, createScene, createThread, linkSceneToEvent,
  createTextAnchor, saveSceneText,
} from '../core/services/narrative';
import { createSource, linkSource } from '../core/services/laws';
import { createWorld, createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { markdownOf, paragraphs, type Passage } from './prose';
import { placeMentions } from './mentions';

const DAY = SECONDS.DAY;
const HOUR = SECONDS.HOUR;
const MIN = SECONDS.MINUTE;

const MEMENTO_PROSE: Record<string, string[]> = {
  'Sagen om Sammy': [
    'Mappen er tyndere, end Leonard havde ventet. Ingen scanning viser en skade, og alligevel kan Sammy ikke huske den mand, der lige har forladt rummet.',
    'Leonard skriver ordet psykisk i margen og understreger det. Han tror endnu, at en forklaring bliver sandere af at stå i den rigtige rubrik.',
  ],
  'Teddy siger det hele': [
    'Teddy taler hurtigt nu, som om sandheden kun kan nå at eksistere, mens Leonard stadig ser på ham. Jimmy var ikke begyndelsen, siger han. Jimmy var endnu en afslutning.',
    'Leonard ser ned på fotografierne. Han kan høre ordene, men ikke finde et sted i sit system, hvor de må blive liggende.',
  ],
  'Endnu et opkald': [
    'Stemmen i telefonen lader ham fortsætte, og derfor gør han det. Sammy kunne huske, hvordan man gav en indsprøjtning, men ikke at han lige havde gjort det.',
    'Leonard ser på sin håndskrift ved siden af telefonen. Der står, at han selv har ringet op. Det føles som en besked fra en fremmed.',
  ],
  'De elektriske genstande': [
    'Sammy rækker efter den forkerte klods igen. Strømmen får hånden til at springe tilbage, men næste runde begynder uden frygt i hans ansigt.',
    'Leonard noterer resultatet. Kroppen lærer ingenting, tænker han, og ser ikke den lille tøven før Sammys fingre rører bordet.',
  ],
  'Han skriver på bagsiden': [
    'Teddy står med ryggen til, mens billedet langsomt bliver tydeligt. Leonard vender det om og holder pennen over den blanke flade.',
    'Mistanken er stadig varm og præcis. Han skriver den ned, før den bliver til den samme tåge som alt andet: Stol ikke på hans løgne.',
  ],
  'Tredje aften': [
    'På den tredje aften fortæller Leonard om fru Jankis. Hun ville ikke acceptere lægernes svar, fordi et svar uden håb ikke lød videnskabeligt nok.',
    'Telefonen knitrer. Han forestiller sig den ukendte lytter nikke og fortsætter, selv om han ikke længere ved, hvem samtalen skulle hjælpe.',
  ],
  'Hun beder om insulinen': [
    'Fru Jankis stiller uret på bordet og beder Sammy om hendes insulin. Da han kommer tilbage, smiler hun og spørger igen med nøjagtig samme stemme.',
    'Leonard ser hendes blik følge kanylen. Det er ikke en prøve af Sammy alene; hun prøver også, hvor længe hendes eget håb kan holde.',
  ],
  'Natten, i glimt': [
    'Et badeværelsesvindue står åbent. En hånd, et flisegulv og hendes ansigt kommer uden rækkefølge, belyst som fotografier af et lyn.',
    'Leonard forsøger at fastholde manden bag sig, men erindringen stopper dér, hvor hans nye liv begynder. Resten er smerte og den sætning, han senere får skrevet på brystet.',
  ],
  'Han vågner hos Natalie': [
    'Loftet er ukendt, men fotografiet på natbordet viser kvinden i køkkenet. Under hendes ansigt står der, at hun hjælper ham.',
    'Leonard læser ordene to gange, før han går ud til hende. Tillid er ikke en følelse længere. Det er noget, han kan holde mellem fingrene.',
  ],
  'Fjerde aften': [
    'Leonard lægger skjorten til side og læser sin egen krop højt for stemmen i telefonen. Fakta ét til fem står mørke og sikre under lampen.',
    'Han spørger, om et menneske kan lyve for sig selv med permanent blæk. Ingen svarer med det samme, og pausen føles vigtig nok til at skrive ned.',
  ],
  'Nålen': [
    'Nålen bevæger sig langsomt gennem den sidste linje. Leonard følger bogstaverne i spejlet, mens smerterne gør dette minut nemt at holde fast i.',
    'Da tatovøren tørrer blodet væk, er mistanken blevet til hud. Om lidt vil Leonard ikke huske beslutningen, kun adlyde resultatet.',
  ],
  'Natalie henter ham': [
    'Natalie viser sit fotografi, før hun siger sit navn. Hun lader Leonard læse sin egen korte beskrivelse og venter på, at papiret gør hende troværdig.',
    'Hun siger, at han er i fare, og at hun kan hjælpe. Han følger med, fordi hendes historie passer ind i de tomme felter, han allerede bærer rundt på.',
  ],
  'Hun får det, hun kom efter': [
    'Natalie ser ham lægge fotografierne i den samme rækkefølge, som han gjorde en time tidligere. Denne gang sørger hun for, at Dodd ligger øverst.',
    'Hun giver ham en adresse og en grund til at være vred. Da han spørger, hvem der har skrevet noten, peger hun bare på hans egen hånd.',
  ],
  'Femte aften': [
    'Den sidste telefonsamtale slutter uden et farvel. Leonard holder røret mod øret, indtil klartonen bliver det eneste sikre i værelset.',
    'Han finder en besked om, at Teddy kommer. Før han kan beslutte, om det er godt eller dårligt, banker det på døren.',
  ],
  'Dodd i skabet': [
    'Skabsdøren hopper i karmen, hver gang Dodd kaster sig mod den. Leonard læser sedlen i sin hånd igen: Manden vil dræbe Natalie.',
    'Burt ser ind fra gangen og vælger ikke at spørge. Leonard leder efter næste instruktion, mens problemet bag døren allerede er begyndt at ændre betydning.',
  ],
  'Natalie kommer forbi': [
    'Natalie træder ind på værelset, ser den ukendte bilnøgle og forstår mere, end hun viser. Hun spørger, hvor Jimmy er, uden at bruge hans navn.',
    'Leonard fortæller hende det, han stadig kan holde fast i. Mens han taler, ser hun på hans lommer og beslutter, hvilken sandhed han skal vågne med næste gang.',
  ],
  'Bilen på parkeringspladsen': [
    'Bilen er dyrere end noget, Leonard ville have lejet, men nøglen passer. I handskerummet ligger et registreringsbevis med et navn, han ikke kender.',
    'Burt vinker fra receptionen og spørger ikke, hvorfor gæsten har skiftet bil. Leonard skriver nummerpladen ned, før spørgsmålet kan forsvinde.',
  ],
  'Teddy i kælderen': [
    'Teddy finder ham ved siden af kroppen og siger, at de skal væk. Leonard ved ikke, hvorfor stemmen lyder bekendt, men polaroidet i lommen har samme ansigt.',
    'Han tager Jimmys jakke og bilnøgler. Teddy protesterer, og det er nok til, at Leonard beslutter at beholde begge dele.',
  ],
  Jimmy: [
    'Jimmy kommer ind med hænderne synlige og kalder Leonard et navn, kun folk fra motellet burde kende. Et øjeblik åbner der sig en anden mulig historie.',
    'Leonard lukker den igen. Han har tatoveringen, noterne og et mål foran sig; tilsammen vejer de mere end den tvivl, han snart alligevel mister.',
  ],
};

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
  let earlyNameRevealId = '';
  const sceneIds = new Map<string, string>();

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
      summary: 'Tidligere forsikringsefterforsker, som ikke kan danne nye varige erindringer og derfor gør noter, fotos og tatoveringer til sit ydre sind.',
    });
    const teddy = createEntity(s, ctx, {
      name: 'Teddy', kind: 'person', summary: 'Politibetjent under navnet Teddy, som både hjælper Leonard, bruger hans tilstand og forsøger at fortælle ham en sandhed, han ikke ønsker.',
    });
    const natalie = createEntity(s, ctx, {
      name: 'Natalie', kind: 'person', summary: 'Bartender og Jimmys kæreste, som hurtigt forstår Leonards begrænsning og bruger hans system til at få løst sit eget problem med Dodd.',
    });
    const burt = createEntity(s, ctx, {
      name: 'Burt', kind: 'person', summary: 'Pragmatisk receptionist på motellet, der udlejer to værelser til den samme glemsomme gæst og accepterer systemets mærkelige logik.',
    });
    const dodd = createEntity(s, ctx, {
      name: 'Dodd', kind: 'person',
      summary: 'Voldelig håndlanger på jagt efter pengene og bilen, Natalie har mistet.',
    });
    const jimmy = createEntity(s, ctx, {
      name: 'Jimmy Grantz', kind: 'person',
      summary: 'Narkohandler og Natalies kæreste; bliver det mål, Leonard tror afslutter jagten.',
    });
    const wife = createEntity(s, ctx, {
      name: 'Leonards kone', kind: 'person',
      summary: 'Leonards sidste sikre erindring og den fraværende person, hele hans system kredser om.',
    });
    const sammy = createEntity(s, ctx, {
      name: 'Sammy Jankis', kind: 'person',
      summary: 'En tidligere forsikringssag om hukommelsestab, som Leonard bruger som forklaring og advarsel; hvor meget af historien der egentlig er hans egen, er omstridt.',
    });

    createIdentity(s, ctx, {
      entityId: teddy, name: 'Teddy', validFrom: assault,
      note: 'Navnet Leonard møder ham under.',
    });
    createIdentity(s, ctx, {
      entityId: teddy, name: 'John Edward Gammell', validFrom: assault,
      note: 'Det navn, der til sidst bliver knyttet til ham.',
    });

    // ------------------------------------------------------------------ steder
    const motel = createEntity(s, ctx, {
      name: 'Motellet', kind: 'place',
      summary: 'Et anonymt værelse, der fungerer som base, arkiv og fælde for en mand uden nye minder.',
    });
    const bar = createEntity(s, ctx, {
      name: 'Baren', kind: 'place',
      summary: 'Natalies arbejdsplads og stedet, hvor dagens sandhed bliver fortalt og straks valgt fra.',
    });
    const natalieHome = createEntity(s, ctx, {
      name: 'Natalies hus', kind: 'place',
      summary: 'Et privat rum fyldt med spor efter Jimmy, hvor Natalie kan styre, hvad Leonard ser.',
    });
    const derelict = createEntity(s, ctx, {
      name: 'Den forladte bygning', kind: 'place',
      summary: 'En tom industribygning uden vidner, udvalgt som endestation for Leonard og Jimmy.',
    });
    const parlour = createEntity(s, ctx, {
      name: 'Tatoveringsbutikken', kind: 'place',
      summary: 'Et sterilt arbejdsrum, hvor midlertidige mistanker bliver skrevet permanent på huden.',
    });
    const home = createEntity(s, ctx, {
      name: 'Leonards hus', kind: 'place',
      summary: 'Hjemmet før skaden; stedet for overfaldet og grænsen mellem gammel og ny hukommelse.',
    });
    const office = createEntity(s, ctx, {
      name: 'Forsikringskontoret', kind: 'place',
      summary: 'Leonards tidligere arbejdsplads, hvor Sammy-sagen bliver ordnet i mapper og forklaringer.',
    });

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
    const polaroidTeddy = createEntity(s, ctx, {
      name: 'Polaroid af Teddy', kind: 'object',
      summary: 'Et øjebliksbillede, hvis håndskrevne advarsel overlever den mistanke, der skabte den.',
    });
    const polaroidNatalie = createEntity(s, ctx, {
      name: 'Polaroid af Natalie', kind: 'object',
      summary: 'Leonards ydre hukommelse om Natalie, reduceret til et ansigt og få valgte ord.',
    });
    const tattoo = createEntity(s, ctx, {
      name: 'Tatoveringen på brystet', kind: 'object',
      summary: 'Den centrale anklage skrevet permanent på Leonards krop; i modsætning til en note kan den hverken mistes, gemmes væk eller uden videre rettes.',
    });

    recordEntityState(s, store, ctx, {
      entityId: tattoo, category: 'tekst', value: 'ufuldstændig',
      fromTime: assault, toTime: bwStart + 4 * DAY + 14 * HOUR,
    });
    recordEntityState(s, store, ctx, {
      entityId: tattoo, category: 'tekst', value: 'færdig',
      fromTime: bwStart + 4 * DAY + 14 * HOUR,
    });
    recordEntityState(s, store, ctx, {
      entityId: polaroidTeddy, category: 'bagside', value: 'blank',
      fromTime: colourStart, toTime: colourStart + 17 * HOUR,
    });
    recordEntityState(s, store, ctx, {
      entityId: polaroidTeddy, category: 'bagside', value: 'advarsel skrevet',
      fromTime: colourStart + 17 * HOUR,
    });

    createRelationship(s, ctx, {
      fromEntityId: natalie, toEntityId: jimmy, kind: 'kærester', category: 'forhold',
      fromTime: assault, toTime: colourStart + 20 * MIN,
    });
    createRelationship(s, ctx, {
      fromEntityId: leonard, toEntityId: teddy, kind: 'samarbejder', category: 'alliance',
      fromTime: assault, toTime: colourStart + 18 * HOUR,
    });
    createRelationship(s, ctx, {
      fromEntityId: leonard, toEntityId: teddy, kind: 'fjender', category: 'alliance',
      fromTime: colourStart + 18 * HOUR,
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

    recordDisappearance(s, ctx, {
      entityId: jimmy, disappearsEventId: colour[0]!,
      note: 'Jimmy kommer ikke tilbage efter mødet i den forladte bygning.',
    });

    const research = createSource(s, ctx, {
      title: 'Prøvenotat om anterograd amnesi', kind: 'note',
      note: 'Fixture-kilde: gemt og vist som researchmetadata; indholdet bliver ikke maskinlæst.',
    });
    linkSource(s, ctx, {
      sourceId: research, targetKind: 'entity', targetId: leonard, relation: 'context',
      note: 'Baggrund for hukommelsesreglen.',
    });

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
    linkEventFact(s, ctx, { eventId: colour[7]!, factId: teddyFact.factId, exposes: 'evidences' });
    linkEventFact(s, ctx, { eventId: colour[8]!, factId: teddyIsJohnG.factId, exposes: 'reveals' });
    linkEventFact(s, ctx, { eventId: colour[8]!, factId: teddyFact.factId, exposes: 'evidences' });
    linkEventFact(s, ctx, { eventId: colour[8]!, factId: jimmyFact.factId, exposes: 'reveals' });

    // ------------------------------------------------------------------- viden
    recordMemoryPolicy(s, ctx, {
      entityId: leonard, fromPersonal: assault, retentionSeconds: 15 * MIN,
      note: 'Efter overfaldet kan Leonard ikke fastholde nye oplevelser længere end et kvarter.',
    });

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

    // Han lærer aldrig, hvad Natalie er ude på. Det siger vi rent ud, så
    // motoren ikke regner sig frem til noget andet.
    recordBelief(s, ctx, {
      entityId: leonard, factId: natalieUses.factId, strength: 'unaware',
      sincePersonal: assault,
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
      speakerEntityId: teddy, factId: jimmyFact.factId, truthful: true,
      eventId: colour[8], audienceEntityId: leonard,
      slotIds: jimmyFact.slotIds, binds: { offer: { entityId: jimmy } },
      note: 'Teddy fortæller ham, at han allerede har dræbt den mand, han leder efter.',
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
      prose?: Passage[];
      anchors?: {
        markId: string;
        targetKind: 'event' | 'fact' | 'entity' | 'identity' | 'reveal' | 'scene' | 'thread';
        targetId: string;
        excerpt: string;
      }[];
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
          {
            title: 'Han skriver på bagsiden', event: colour[7]!,
            reveals: [{ factId: teddyFact.factId, strength: 'stated' }],
            prose: [
              'Teddy står med ryggen til, mens billedet langsomt bliver tydeligt. Leonard vender det om og holder pennen over den blanke flade.',
              {
                text: 'Mistanken er stadig varm og præcis. Han skriver den ned, før den bliver til den samme tåge som alt andet: Stol ikke på hans løgne.',
                mark: {
                  id: 'memento-polaroid-teddy', kind: 'entity', label: 'Polaroid af Teddy',
                },
              },
            ],
            anchors: [{
              markId: 'memento-polaroid-teddy', targetKind: 'entity',
              targetId: polaroidTeddy,
              excerpt: 'Stol ikke på hans løgne.',
            }],
          },
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
        sceneIds.set(spec.title, sceneId);
        linkSceneToEvent(s, ctx, {
          sceneId, eventId: spec.event, mode: spec.mode ?? 'dramatised',
        });
        for (const shown of spec.reveals ?? []) {
          const revealId = createReveal(s, ctx, {
            factId: shown.factId, sceneId,
            slotId: shown.slotId, strength: shown.strength,
          });
          if (spec.title === 'Teddy siger det hele' && shown.factId === teddyIsJohnG.factId) {
            earlyNameRevealId = revealId;
          }
        }
        const prose = spec.prose ?? MEMENTO_PROSE[spec.title];
        if (!prose) throw new Error(`Memento mangler prøveprosa til «${spec.title}».`);
        saveSceneText(s, ctx, store, {
          sceneId, doc: paragraphs(...prose), markdown: markdownOf(...prose),
        });
        for (const tie of spec.anchors ?? []) {
          createTextAnchor(s, ctx, {
            sceneId, markId: tie.markId, targetKind: tie.targetKind,
            targetId: tie.targetId, excerpt: tie.excerpt,
          });
        }
      });
    });

    const teddyThread = createThread(s, ctx, {
      workId, name: 'Hvem er Teddy?',
      summary: 'Mistanken på fotografiet bliver til afsløringen af hans navn og rolle.',
    });
    createBeat(s, ctx, {
      threadId: teddyThread, kind: 'setup', sceneId: sceneIds.get('Nogen har ringet'),
      summary: 'En ukendt hjælper styrer samtalen og ved mere end Leonard.',
    });
    createBeat(s, ctx, {
      threadId: teddyThread, kind: 'payoff', sceneId: sceneIds.get('Teddy siger det hele'),
      summary: 'Teddy afslører sit navn og den jagt, Leonard selv holder i live.',
    });

    const sammyThread = createThread(s, ctx, {
      workId, name: 'Sammy Jankis',
      summary: 'Forsikringssagen spejler det, Leonard nægter at se om sig selv.',
    });
    createBeat(s, ctx, {
      threadId: sammyThread, kind: 'setup', sceneId: sceneIds.get('Sagen om Sammy'),
      summary: 'Sammy præsenteres som den anden mand med samme problem.',
    });
    createBeat(s, ctx, {
      threadId: sammyThread, kind: 'complication', sceneId: sceneIds.get('De elektriske genstande'),
      summary: 'Prøven antyder, at kroppen måske lærer mere end Leonard påstår.',
    });
    createBeat(s, ctx, {
      threadId: sammyThread, kind: 'payoff', sceneId: sceneIds.get('Natten, i glimt'),
      summary: 'Sammys fortælling og Leonards eget tab glider sammen.',
    });
  });

  // Omtalerne sættes efter indlæsningen, fordi arbejdsreferencerne først findes,
  // når turen er lukket. De ligger før grenen nedenfor, så varianten arver dem.
  placeMentions(store, ctx, [
    { scene: 'Natalie kommer forbi', phrase: 'Natalie', kind: 'entity', name: 'Natalie' },
    { scene: 'Han vågner hos Natalie', phrase: 'fotografiet på natbordet', kind: 'entity',
      name: 'Polaroid af Natalie' },
    { scene: 'Nålen', phrase: 'den sidste linje', kind: 'entity', name: 'Tatoveringen på brystet' },
    { scene: 'Natten, i glimt', phrase: 'Et badeværelsesvindue', kind: 'entity',
      name: 'Leonards hus' },
  ]);

  // One visible alternative makes phase 6 testable immediately. It is a real
  // branch, not special fixture UI: Teddy's name is hinted in the opening and
  // his confession is moved to the front. The main branch remains the film-like
  // arrangement and is selected again before returning.
  const forkSeq = store.db.select({ max: sql<number>`max(${change.seq})` }).from(change)
    .where(eq(change.branchId, ctx.branchId)).get()!.max;
  const variant = createBranchFromHistory(store, {
    sourceBranchId: ctx.branchId,
    sourceWorkId: workId,
    name: 'Teddy afsløres tidligere',
    changeSeq: forkSeq,
    actor: { kind: 'system' },
  });
  const variantCtx = { ...ctx, branchId: variant.branchId, workId: variant.workId };
  const copiedScene = (sourceId: string) => store.db.select().from(scene)
    .where(eq(scene.originId, sourceId)).all().find((item) => item.branchId === variant.branchId)!;
  const opening = copiedScene(sceneIds.get('Nogen har ringet')!);
  const confession = copiedScene(sceneIds.get('Teddy siger det hele')!);
  const openingChapter = store.db.select().from(chapter)
    .where(eq(chapter.id, opening.chapterId)).get()!;
  const nameReveal = store.db.select().from(reveal)
    .where(eq(reveal.originId, earlyNameRevealId)).all()
    .find((item) => item.branchId === variant.branchId)!;
  inTurn(store, {
    branchId: variant.branchId,
    actor: { kind: 'system' },
    summary: 'Prøv Teddy-afsløringen tidligere',
  }, (session) => {
    moveScene(session, store, variantCtx, {
      sceneId: confession.id, targetChapterId: openingChapter.id, toIndex: 0,
    });
    moveReveal(session, store, variantCtx, {
      revealId: nameReveal.id, sceneId: opening.id, strength: 'hinted',
    });
  });

  bench.setActive({ worldId: created.worldId, branchId: ctx.branchId, workId });
  return { worldId: created.worldId, workId };
}
