import { inTurn } from '../core/changelog';
import type { Store } from '../db/client';
import { SECONDS, parseInstant } from '../core/time/gregorian';
import { createEntity, recordPresence } from '../core/services/entities';
import { addParticipation, createEvent, linkEventFact } from '../core/services/events';
import { createFact, recordBelief, recordStatement } from '../core/services/knowledge';
import { createLaw } from '../core/services/laws';
import {
  createChapter, createReveal, createScene, linkSceneToEvent, saveSceneText,
} from '../core/services/narrative';
import { createRealm, createWorld, createWork, defaultTimeSystemOf } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { updateRow } from '../core/services/generic';
import { markdownOf, paragraphs } from './prose';

const INCEPTION_PROSE: Record<string, string[]> = {
  'Yusuf ved rattet': [
    'Yusuf holdt begge hænder på rattet, mens varevognen gled mellem bilerne. Bag ham lå seks sovende kroppe spændt fast til sæderne og arbejdede gennem hver sit lange ur.',
    'Broen kom nærmere. Han regnede på sekunderne frem for afstanden; faldet skulle begynde på det øjeblik, alle lagene var klar til at høre det.',
  ],
  'De kommer ind': [
    'Arthur åbnede øjnene til regn, der ikke fandtes ovenpå. Fischer sad mellem dem og troede stadig, at frygten var hans egen reaktion på en virkelig kidnapning.',
    'Arthur gennemgik rollerne én gang til. Hver løgn skulle pege mod den næste, og ingen måtte se sømmen mellem Fischers forsvar og Ariadnes bygninger.',
  ],
  'Yusuf indrømmer det': [
    'Tyngden i drømmen ændrede sig, før Arthur mærkede varevognen dreje. Han spurgte Yusuf om bedøvelsen, og pausen gav svaret før ordene gjorde.',
    'Døden ville ikke vække dem. Den ville sende dem længere ned til et sted uden fælles ur. Arthur så på de sovende omkring sig og begyndte at omregne planen.',
  ],
  'De venter': [
    'Ariadne betragtede elevatorens tal skifte uden at kabinen bevægede sig. Cobb havde sagt, at arkitekten kontrollerede rummet, men hans minder havde allerede deres egne etager.',
    'De ventede på sparket ovenfra. Hvert sekund trak sig langt nok ud til, at hun kunne forestille sig alt det, der kunne nå at gå galt nedenunder.',
  ],
  'Op ad bjerget': [
    'Eames førte dem gennem sneen med Fischers vagter bagved. Fæstningen lå højere, end Ariadnes tegning havde lovet, som om målets forsvar havde gjort bjerget stejlere.',
    'Han skiftede ansigt for at komme forbi den første post og skiftede tilbage i læ af muren. I denne verden var identitet et redskab, men kuglerne var stadig konkrete nok.',
  ],
  'Han går i land': [
    'Cobb vågnede med ansigtet i det lave vand. Byen ved kysten var bygget af år, han havde forsøgt at kalde uvirkelige, og hvert tomt vindue kendte hans navn.',
    'Han gik mod huset uden at se sig tilbage. Ovenfor faldt varevognen stadig; hernede havde han tid nok til at blive gammel med sin skyld igen.',
  ],
  'Han lader hende blive': [
    'Mal ventede ved det dækkede bord, sådan som hans erindring altid placerede hende. Hun tilbød et liv, der kunne fortsætte, hvis han bare holdt op med at kalde det en drøm.',
    'Cobb fortalte hende endelig, at hun var en projektion. Ordene gjorde hende ikke mindre virkelig, men de gjorde det muligt for ham at gå uden at bede hende følge med.',
  ],
  'Sparket når ned': [
    'Ariadne hørte musikken som en tone gennem dybt vand. Bygningerne omkring kysten bøjede sig, mens de øvre lags korte fald blev til en hel verdens sammenbrud.',
    'Hun greb Fischer og sprang. På vejen op passerede de uger, timer og sekunder i den modsatte rækkefølge, indtil varevognens vand lukkede sig omkring dem.',
  ],
};

const MIN = SECONDS.MINUTE;

/**
 * Inception, as a test of nested realms.
 *
 * Four layers, each running twenty times faster than the one above it, pinned
 * to each other so their clocks can actually be compared. Ten minutes in the
 * van is over eight weeks at the bottom, and the model has to be able to say
 * both numbers about the same stretch of time without either being wrong.
 *
 * It also carries the two laws the film needs and every dream story needs
 * differently: what happens to a body upstairs, and whether you remember the
 * dream when you wake. Neither is something the tool should guess.
 *
 * The narrative side is what makes the ratios visible. Four chapters, one per
 * layer, each with two or three scenes -- so a single chapter of the book covers
 * eight weeks at the bottom and ten minutes at the top, and the chapter view has
 * to show both numbers about the same stretch without either being wrong.
 *
 * Loaded: the four layers, their ratios, their entrances and exits, the team,
 * and what each of them knows about why they are down there.
 */
export function loadInception(store: Store): { worldId: string; workId: string; realmIds: string[] } {
  const created = createWorld(store, {
    name: 'Inception',
    summary: 'Prøvecase: lag inden i lag, med hvert sit ur.',
  });
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: created.worldId, userId: created.userId });
  const reality = created.realmId;
  const epoch = parseInstant('2010-07-16T12:00').earliest;
  let workId = '';
  const realmIds: string[] = [reality];

  inTurn(store, {
    branchId: ctx.branchId,
    actor: { kind: 'system' },
    summary: 'Indlæs Inception',
  }, (s) => {
    workId = createWork(s, ctx, { title: 'Inception' });
    const timeSystemId = defaultTimeSystemOf(store, ctx);

    const cobb = createEntity(s, ctx, {
      name: 'Cobb', kind: 'person', summary: 'Holdets leder og erfarne drømmeindbrudstyv; hans ønske om at komme hjem kolliderer med skyldfølelsen, der gør Mal til en farlig projektion.',
    });
    const arthur = createEntity(s, ctx, {
      name: 'Arthur', kind: 'person', summary: 'Planlæggeren, der holder styr på lag, spark og flugtveje, men må arbejde uden den afgørende viden Cobb har skjult om Mal.',
    });
    const ariadne = createEntity(s, ctx, {
      name: 'Ariadne', kind: 'person', summary: 'Arkitekten bag drømmeverdenens rum og holdets mest nysgerrige medlem; hun opdager, at den største trussel ikke kommer fra Fischer, men fra Cobb.',
    });
    const eames = createEntity(s, ctx, {
      name: 'Eames', kind: 'person',
      summary: 'Forfalsker identiteter i drømme og improviserer dér, hvor resten af planen bliver for stiv.',
    });
    const yusuf = createEntity(s, ctx, {
      name: 'Yusuf', kind: 'person',
      summary: 'Kemikeren bag den dybe bedøvelse og chaufføren, der skal holde det øverste ur i gang.',
    });
    const saito = createEntity(s, ctx, {
      name: 'Saito', kind: 'person',
      summary: 'Betaler for missionen, deltager i den og bærer den politiske magt, Cobb håber at købe.',
    });
    const fischer = createEntity(s, ctx, {
      name: 'Fischer', kind: 'person', summary: 'Arving og missionens mål, som tror han forsvarer sig mod kidnapning, mens holdet forsøger at få en fremmed idé til at føles som hans egen.',
    });
    const mal = createEntity(s, ctx, {
      name: 'Mal', kind: 'person', summary: 'Cobbs afdøde hustru, som kun findes i hans sind, men dér har vilje, stemme og adgang til alle de verdener, han prøver at kontrollere.',
    });
    const totem = createEntity(s, ctx, {
      name: 'Toppen', kind: 'object', summary: 'Cobbs lille snurretop og private virkelighedsprøve: standser den, er verden virkelig; fortsætter den, kan også selve testen være en del af drømmen.',
    });
    const van = createEntity(s, ctx, {
      name: 'Varevognen', kind: 'place',
      summary: 'Missionens fysiske anker; ti minutters fald her skal synkronisere uger i lagene nedenunder.',
    });
    const hotel = createEntity(s, ctx, {
      name: 'Hotellet', kind: 'place',
      summary: 'Første drømmelag, hvor korridorer, tyngdekraft og sikkerhedsvagter følger Fischers sind.',
    });
    const fortress = createEntity(s, ctx, {
      name: 'Snefæstningen', kind: 'place',
      summary: 'Et militariseret andet lag, der gør Fischers følelsesmæssige forsvar til konkret arkitektur.',
    });
    const limbo = createEntity(s, ctx, {
      name: 'Kysten', kind: 'place',
      summary: 'Det dybeste uformede lag, hvor år kan gå, og Cobbs minder har bygget en forladt by.',
    });

    // Hvert lag er tyve gange hurtigere end det over, og fæstnet til det på det
    // øjeblik, man går ind. Uden holdepunktet siger forholdet kun hvor hurtigt
    // laget løber, ikke hvornår det begyndte.
    let parent = reality;
    const places = [van, hotel, fortress, limbo];
    const names = ['Regnvejret i varevognen', 'Hotellet', 'Snefæstningen', 'Kysten'];
    for (let level = 1; level <= 3; level += 1) {
      const id = createRealm(s, ctx, {
        name: `Drøm, lag ${level}`, kind: 'dream', parentRealmId: parent,
        timeSystemId, timeRatio: 20, parentEpoch: epoch, localEpoch: epoch,
        summary: `${names[level]} — tyve gange hurtigere end laget over.`,
      });
      realmIds.push(id);
      parent = id;
    }

    // Én sammenhængende strækning, set fra fire ure på én gang.
    const entry = createEvent(s, ctx, {
      title: 'Man falder i søvn', realmId: reality, placeId: van,
      earliest: epoch, latest: epoch, precision: 'minute',
    });
    const exit = createEvent(s, ctx, {
      title: 'Sparket', realmId: reality, placeId: van,
      earliest: epoch + 10 * MIN, latest: epoch + 10 * MIN, precision: 'minute',
    });
    const team = [cobb, arthur, ariadne, eames, saito, fischer];
    for (const who of [...team, yusuf]) {
      addParticipation(s, ctx, { eventId: entry, entityId: who, role: 'actor' });
    }
    for (const who of [...team, yusuf]) {
      addParticipation(s, ctx, { eventId: exit, entityId: who, role: 'actor' });
    }

    /**
     * Tre begivenheder i hvert lag, målt på lagets eget ur.
     *
     * Det er dét, forholdet er til for. De samme ti minutter i varevognen er en
     * time i første lag, en uge i andet og over otte uger på kysten -- og hvert
     * tal er rigtigt i sit eget lag. En model med ét ur kan ikke skrive det ned.
     */
    const insideByLevel: string[][] = [];
    realmIds.slice(1).forEach((realmId, index) => {
      const level = index + 1;
      const localSpan = 10 * MIN * 20 ** level;
      const beats = ['Ankomsten', 'Arbejdet', 'Ventetiden på sparket'];
      const made = beats.map((beat, beatIndex) => {
        const id = createEvent(s, ctx, {
          title: `${beat} i lag ${level}`, realmId, placeId: places[level],
          earliest: epoch + Math.round((localSpan / 3) * beatIndex),
          latest: epoch + Math.round((localSpan / 3) * beatIndex) + Math.round(localSpan / 12),
          durationMin: Math.round(localSpan / 4), precision: 'minute',
        });
        for (const who of team) {
          addParticipation(s, ctx, { eventId: id, entityId: who, role: 'actor' });
        }
        return id;
      });
      insideByLevel.push(made);
      recordPresence(s, ctx, {
        entityId: cobb, placeId: places[level]!, realmId,
        fromTime: epoch, toTime: epoch + localSpan,
      });
      updateRow(s, store, {
        table: 'realm', id: realmId,
        patch: { entryEventId: entry, exitEventId: exit },
      });
    });

    // Kroppen sover i laget over, mens personen arbejder i laget under. Det er
    // ikke bilokation, og reglen skal vide det.
    recordPresence(s, ctx, {
      entityId: cobb, placeId: van, realmId: reality, fromTime: epoch, toTime: epoch + 10 * MIN,
    });
    recordPresence(s, ctx, {
      entityId: ariadne, placeId: van, realmId: reality, fromTime: epoch, toTime: epoch + 10 * MIN,
    });

    // -------------------------------------------------------------------- fakta
    const dreamDeath = createFact(s, ctx, {
      predicate: 'kan_ikke_doe', summary: 'Man vågner af at dø i en drøm', realmId: realmIds[1]!,
      slots: [{ name: 'lag', valueKind: 'text', value: { text: 'drøm' } }],
    });
    // Sandt i drømmen, meningsløst i virkeligheden. Et faktum hører til i et lag,
    // og det er derfor det står på faktummet og ikke på verdenen.
    const malFact = createFact(s, ctx, {
      predicate: 'er_projektion', summary: 'Mal er Cobbs egen projektion', realmId: realmIds[1]!,
      slots: [{ name: 'person', valueKind: 'entity', value: { entityId: mal } }],
    });
    const sedationFact = createFact(s, ctx, {
      predicate: 'bedoevelsen_er_for_kraftig',
      summary: 'Bedøvelsen er så kraftig, at døden fører til limbo', realmId: realmIds[1]!,
      slots: [{ name: 'ansvarlig', valueKind: 'entity', value: { entityId: yusuf } }],
    });

    linkEventFact(s, ctx, {
      eventId: insideByLevel[0]![1]!, factId: sedationFact.factId, exposes: 'reveals',
    });
    linkEventFact(s, ctx, {
      eventId: insideByLevel[1]![1]!, factId: malFact.factId, exposes: 'evidences',
    });

    // -------------------------------------------------------------------- viden
    // Cobb ved det fra begyndelsen og siger det ikke. Ariadne regner det ud
    // undervejs. Arthur får det aldrig at vide, og Fischer slet ikke.
    recordBelief(s, ctx, {
      entityId: cobb, factId: malFact.factId, strength: 'knows', sincePersonal: epoch,
      slotIds: malFact.slotIds, binds: { person: { entityId: mal } },
    });
    recordBelief(s, ctx, {
      entityId: ariadne, factId: malFact.factId, strength: 'suspects', sincePersonal: epoch,
    });
    recordBelief(s, ctx, {
      entityId: arthur, factId: malFact.factId, strength: 'unaware', sincePersonal: epoch,
    });
    recordBelief(s, ctx, {
      entityId: fischer, factId: malFact.factId, strength: 'unaware', sincePersonal: epoch,
    });
    recordBelief(s, ctx, {
      entityId: yusuf, factId: sedationFact.factId, strength: 'knows', sincePersonal: epoch,
      slotIds: sedationFact.slotIds, binds: { ansvarlig: { entityId: yusuf } },
    });
    for (const who of [cobb, arthur, eames, saito]) {
      recordBelief(s, ctx, {
        entityId: who, factId: dreamDeath.factId, strength: 'knows', sincePersonal: epoch,
        slotIds: dreamDeath.slotIds, binds: { lag: { text: 'drøm' } },
      });
    }

    // Yusuf siger det, han faktisk ved. Cobb fortier det, han ved. Det første er
    // ikke en fejl; det andet er en løgn, og en løgn er en handling.
    recordStatement(s, ctx, {
      speakerEntityId: yusuf, factId: sedationFact.factId, truthful: true,
      eventId: insideByLevel[0]![1]!, atTime: epoch + 200 * MIN,
      slotIds: sedationFact.slotIds, binds: { ansvarlig: { entityId: yusuf } },
    });
    recordStatement(s, ctx, {
      speakerEntityId: cobb, factId: malFact.factId, truthful: false,
      eventId: entry, audienceEntityId: arthur, atTime: epoch,
      note: 'Han siger, han har styr på det.',
    });

    createLaw(s, ctx, {
      kind: 'ability', hardness: 'hard', ruleCode: 'bilocation',
      scopeKind: 'world',
      statement: 'Kroppen bliver i laget over, mens personen handler i laget under. '
        + 'Samme person i to lag på samme tid er ikke bilokation.',
    });
    createLaw(s, ctx, {
      kind: 'prohibition', hardness: 'soft',
      statement: 'Man husker drømmen, når man vågner — i denne verden. '
        + 'I de fleste andre historier gør man ikke, og så skal denne lov skiftes ud.',
    });

    // -------------------------------------------------------------- fortællingen
    interface SceneSpec {
      title: string;
      event: string;
      pov: string;
      realm: string;
      reveals?: { factId: string; slotId?: string; strength: 'hinted' | 'implied' | 'stated' | 'confirmed' }[];
      prose?: string[];
    }

    const book: { title: string; summary: string; scenes: SceneSpec[] }[] = [
      {
        title: 'Varevognen',
        summary: 'Ti minutter, oppe hvor uret går langsomst.',
        scenes: [
          {
            title: 'De falder i søvn', event: entry, pov: cobb, realm: reality,
            prose: [
              'Regnen rammer taget i en takt, han ikke kan holde styr på, og så holder han op med at prøve.',
              'Han tæller dem: seks stole, seks slanger, seks mennesker der ikke ved, hvad de har sagt ja til.',
            ],
          },
          { title: 'Yusuf ved rattet', event: exit, pov: cobb, realm: reality },
        ],
      },
      {
        title: 'Hotellet',
        summary: 'Første lag. En time hernede for hvert tredje minut deroppe.',
        scenes: [
          { title: 'De kommer ind', event: insideByLevel[0]![0]!, pov: arthur, realm: realmIds[1]! },
          {
            title: 'Yusuf indrømmer det', event: insideByLevel[0]![1]!, pov: arthur,
            realm: realmIds[1]!,
            reveals: [{
              factId: sedationFact.factId,
              slotId: sedationFact.slotIds.get('ansvarlig'), strength: 'stated',
            }],
          },
          { title: 'De venter', event: insideByLevel[0]![2]!, pov: ariadne, realm: realmIds[1]! },
        ],
      },
      {
        title: 'Snefæstningen',
        summary: 'Andet lag. En uge hernede for de samme ti minutter.',
        scenes: [
          { title: 'Op ad bjerget', event: insideByLevel[1]![0]!, pov: eames, realm: realmIds[2]! },
          {
            title: 'Ariadne ser hende', event: insideByLevel[1]![1]!, pov: ariadne,
            realm: realmIds[2]!,
            reveals: [{ factId: malFact.factId, strength: 'implied' }],
            prose: [
              'Hun står i den anden ende af gangen, og ingen andre kigger op.',
              'Ariadne forstår det, før hun har ord til det: hun er ikke kommet ind udefra. Hun har været her hele tiden, fordi han har taget hende med.',
            ],
          },
        ],
      },
      {
        title: 'Kysten',
        summary: 'Tredje lag. Otte uger, mens sparket falder.',
        scenes: [
          { title: 'Han går i land', event: insideByLevel[2]![0]!, pov: cobb, realm: realmIds[3]! },
          {
            title: 'Han lader hende blive', event: insideByLevel[2]![1]!, pov: cobb,
            realm: realmIds[3]!,
            reveals: [{
              factId: malFact.factId,
              slotId: malFact.slotIds.get('person'), strength: 'confirmed',
            }],
          },
          { title: 'Sparket når ned', event: insideByLevel[2]![2]!, pov: ariadne, realm: realmIds[3]! },
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
          povEntityId: spec.pov, narrationPerson: 'third_limited',
          narrationTense: 'past', realmId: spec.realm,
        });
        linkSceneToEvent(s, ctx, { sceneId, eventId: spec.event, mode: 'dramatised' });
        for (const shown of spec.reveals ?? []) {
          createReveal(s, ctx, {
            factId: shown.factId, sceneId, slotId: shown.slotId, strength: shown.strength,
          });
        }
        const prose = spec.prose ?? INCEPTION_PROSE[spec.title];
        if (!prose) throw new Error(`Inception mangler prøveprosa til «${spec.title}».`);
        saveSceneText(s, ctx, store, {
          sceneId, doc: paragraphs(...prose), markdown: markdownOf(...prose),
        });
      });
    });
  });

  bench.setActive({ worldId: created.worldId, workId });
  return { worldId: created.worldId, workId, realmIds };
}
