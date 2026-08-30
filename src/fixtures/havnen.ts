import { inTurn } from '../core/changelog';
import type { Store } from '../db/client';
import { SECONDS, parseInstant } from '../core/time/gregorian';
import {
  createEntity, createPlaceLink, createRelationship, recordDisappearance,
  recordEntityState, recordMemoryPolicy, recordPossession, recordPresence,
} from '../core/services/entities';
import { addParticipation, createEvent, linkEventFact } from '../core/services/events';
import {
  attachFactToCarrier, createFact, recordBelief, recordStatement,
} from '../core/services/knowledge';
import { createLaw, createSource, linkSource } from '../core/services/laws';
import {
  createBeat, createChapter, createReveal, createScene, createTextAnchor, createThread,
  linkSceneToEvent, saveSceneText,
} from '../core/services/narrative';
import { createSuggestion } from '../core/services/suggestions';
import { createSeries, createWorld, createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { markdownOf, paragraphs, type Passage } from './prose';

/**
 * Et fast mærke-id i prøvecasen.
 *
 * Ude i programmet laver editoren et tilfældigt id, når forfatteren markerer en
 * passage. Her skal det være det samme hver gang, for margennoten længere nede
 * peger på det -- og en note, der peger på et mærke, der ikke findes, kan ikke
 * skrives ind, hvilket er præcis det, prøvecasen skal vise virker.
 */
const WEATHER_MARK = 'havnen-storm-1';

const DAY = SECONDS.DAY;
const HOUR = SECONDS.HOUR;
const MIN = SECONDS.MINUTE;

/**
 * Havnen, as a test of the shape a real project has.
 *
 * The three films each press on one exotic axis -- two timelines, personal
 * time, nested clocks. This one presses on the ordinary case, which turns out
 * to be the one least covered: **two books in one series in one world**, sixty
 * years apart, with an ensemble instead of a single head.
 *
 * That is the arrangement the writer asked about at the very beginning -- "der
 * er allerede en bogserie i verdenen, men vi vil måske lave endnu en, som går
 * et andet sted, en anden tid" -- and nothing until now has exercised it.
 *
 * It also carries the things a saga has and a film does not: people who are
 * born and die inside the story, relationships that turn, a man who
 * disappears, a witness whose memory is unreliable by disposition rather than
 * by injury, and a map with real distances that the schedule has to respect.
 *
 * Nothing here is borrowed. It is invented to be a test, and shaped to press
 * on the parts of the model that had never been asked a question.
 */
export function loadHavnen(store: Store): {
  worldId: string; seriesId: string; firstWorkId: string; secondWorkId: string;
} {
  const created = createWorld(store, {
    name: 'Havnen',
    summary: 'Prøvecase: én verden, én serie, to bøger med tres år imellem.',
  });
  const bench = new Workbench(store);
  const ctx = bench.setActive({ worldId: created.worldId, userId: created.userId });
  const realmId = created.realmId;

  let seriesId = '';
  let firstWorkId = '';
  let secondWorkId = '';

  const at = (text: string) => parseInstant(text).earliest;

  inTurn(store, {
    branchId: ctx.branchId, actor: { kind: 'system' }, summary: 'Indlæs Havnen',
  }, (s) => {
    seriesId = createSeries(s, ctx, {
      name: 'Krag',
      summary: 'To bøger om den samme havn, med tres år imellem.',
    });
    firstWorkId = createWork(s, ctx, {
      title: 'Saltet', seriesId, position: 1,
      summary: 'Efteråret 1893. Skibet går ned, og ingen siger hvorfor.',
    });
    secondWorkId = createWork(s, ctx, {
      title: 'Tidevandet', seriesId, position: 2,
      summary: 'Foråret 1952. Barnebarnet finder brevet.',
    });

    // ------------------------------------------------------------------ folk
    const ingeborg = createEntity(s, ctx, {
      name: 'Ingeborg Krag', kind: 'person',
      summary: 'Født 1870. Holder gården sammen, og tier om hvorfor hun kan.',
    });
    const mads = createEntity(s, ctx, {
      name: 'Mads Krag', kind: 'person',
      summary: 'Født 1866. Skipper på «Marie Krag» og gift med Ingeborg. Siger ja til '
        + 'en aftale, han fortryder samme nat, og går i vandet ved Fyret i 1901 — '
        + 'otte år efter det, han sagde ja til.',
    });
    const valdemar = createEntity(s, ctx, {
      name: 'Valdemar Sund', kind: 'person',
      summary: 'Født 1865. Reder, ejer det halve af havnen og lyver aldrig direkte. '
        + 'Han siger sandt om vejret ved søforhøret og lader resten stå ved siden af, '
        + 'og det er hele hans metode gennem begge bøger.',
    });
    const lind = createEntity(s, ctx, {
      name: 'Doktor Lind', kind: 'person',
      summary: 'Født 1858. Distriktslæge, til stede ved næsten alt hvad der sker, og '
        + 'med en hukommelse der slipper efter et halvt år. Han er prøven på, at '
        + 'det at have været til stede ikke er det samme som at vide det bagefter.',
    });
    const karen = createEntity(s, ctx, {
      name: 'Karen Krag', kind: 'person',
      summary: 'Født 1895. Vokser op som Mads Krags datter og er det ikke. Hun er '
        + 'broen mellem de to bøger: alt hvad bog et gemmer, går gennem hende for at '
        + 'nå frem til bog to, og hun siger ingenting nogen af stederne.',
    });
    const jens = createEntity(s, ctx, {
      name: 'Jens Krag', kind: 'person',
      summary: 'Født 1928. Karens søn, murer, og den der river panelet ned i 1952. '
        + 'Bog to er hans: han leder efter noget, læseren allerede fik at vide i '
        + 'bog et, og det er hele afstanden mellem de to bind.',
    });
    const ellen = createEntity(s, ctx, {
      name: 'Ellen Sund', kind: 'person',
      summary: 'Født 1930. Valdemars barnebarn og arving til den halve havn. Hun ved '
        + 'mindre om sin egen familie end den mand, der kommer og spørger, og opdager '
        + 'det midt i samtalen på kajen.',
    });

    // ----------------------------------------------------------------- steder
    const farm = createEntity(s, ctx, {
      name: 'Krag-gården', kind: 'place',
      summary: 'Fire tønder land oven for havnen, arvet og aldrig helt betalt. '
        + 'Det er her brevet ligger bag panelet i tres år.',
    });
    const harbour = createEntity(s, ctx, {
      name: 'Havnen', kind: 'place',
      summary: 'Bassin, pakhuse og en kran. Halvdelen står i familien Sunds navn, '
        + 'og hvem der ejer den anden halvdel, skifter gennem begge bøger.',
    });
    const sundvej = createEntity(s, ctx, {
      name: 'Sundvej 4', kind: 'place',
      summary: 'Valdemar Sunds hus ved indsejlingen. Kontor i stueetagen, '
        + 'og den stue hvor aftalen bliver indgået i september 1893.',
    });
    const town = createEntity(s, ctx, {
      name: 'Købstaden', kind: 'place',
      summary: 'Herredsretten, arkivet og avisen ligger her. Alt hvad der bliver '
        + 'sagt officielt om skibet, bliver sagt inden for de fire gader.',
    });
    const light = createEntity(s, ctx, {
      name: 'Fyret', kind: 'place',
      summary: 'Halvanden sømil ude. «Marie Krag» går ned her i 1893, og otte år '
        + 'senere driver Mads Krags båd ind under det med årerne på plads.',
    });

    // Et kort med rigtige afstande. Rejsetiden er en hård grænse, så
    // køreplanen nedenfor bliver prøvet af, hver gang gennemgangen kører.
    const route = (from: string, to: string, minutes: number, mode = 'til fods') =>
      createPlaceLink(s, ctx, {
        realmId, fromPlaceId: from, toPlaceId: to, mode, travelMin: minutes * MIN,
      });
    route(farm, harbour, 25);
    route(farm, sundvej, 40);
    route(harbour, sundvej, 15);
    route(harbour, light, 90, 'med båd');
    route(harbour, town, 3 * 60, 'med vogn');
    route(sundvej, town, 3 * 60, 'med vogn');

    // ------------------------------------------------------------------ fakta
    const scuttled = createFact(s, ctx, {
      predicate: 'saenket_med_vilje', summary: 'Marie Krag blev sænket med vilje', realmId,
      slots: [
        { name: 'skib', valueKind: 'text', value: { text: 'Marie Krag' } },
        { name: 'bagmand', valueKind: 'entity', value: { entityId: valdemar } },
      ],
    });
    const paternity = createFact(s, ctx, {
      predicate: 'er_far_til', summary: 'Valdemar er Karens far', realmId,
      slots: [
        { name: 'far', valueKind: 'entity', value: { entityId: valdemar } },
        { name: 'barn', valueKind: 'entity', value: { entityId: karen } },
      ],
    });
    const madsFate = createFact(s, ctx, {
      predicate: 'doede', summary: 'Mads gik i vandet ved Fyret', realmId,
      truth: 'disputed',
      slots: [{ name: 'sted', valueKind: 'entity', value: { entityId: light } }],
    });

    // ---------------------------------------------------------- liv og tilstand
    const born = [
      [ingeborg, '1870-04-02'], [mads, '1866-09-11'], [valdemar, '1865-01-20'],
      [lind, '1858-06-30'], [karen, '1895-03-08'], [jens, '1928-11-19'], [ellen, '1930-05-05'],
    ] as const;
    for (const [who, day] of born) {
      recordEntityState(s, store, ctx, {
        entityId: who, category: 'liv', value: 'i live', fromTime: at(day),
      });
    }
    // De, der når at dø inden for serien, får en slutdato. Reglen om liv og
    // alder har dermed noget at holde scenerne op imod.
    recordEntityState(s, store, ctx, {
      entityId: mads, category: 'liv', value: 'død', fromTime: at('1901-11-04'),
    });
    recordEntityState(s, store, ctx, {
      entityId: valdemar, category: 'liv', value: 'død', fromTime: at('1938-02-17'),
    });
    recordEntityState(s, store, ctx, {
      entityId: lind, category: 'liv', value: 'død', fromTime: at('1921-08-30'),
    });
    recordEntityState(s, store, ctx, {
      entityId: ingeborg, category: 'liv', value: 'død', fromTime: at('1944-01-12'),
    });

    // Relationer, der vender. Kategorien gør, at to tilstande i den samme
    // relation ikke kan gælde samtidig — og det er hele pointen med at have den.
    createRelationship(s, ctx, {
      fromEntityId: ingeborg, toEntityId: mads, kind: 'gift med', category: 'ægteskab',
      symmetric: true, fromTime: at('1892-06-18'), toTime: at('1901-11-04'),
    });
    createRelationship(s, ctx, {
      fromEntityId: ingeborg, toEntityId: valdemar, kind: 'forbundsfælle', category: 'forhold',
      fromTime: at('1893-01-01'), toTime: at('1893-10-14'),
    });
    createRelationship(s, ctx, {
      fromEntityId: ingeborg, toEntityId: valdemar, kind: 'fjende', category: 'forhold',
      fromTime: at('1893-10-14'),
    });
    createRelationship(s, ctx, {
      fromEntityId: valdemar, toEntityId: karen, kind: 'far til', category: 'slægt',
      fromTime: at('1895-03-08'),
    });
    createRelationship(s, ctx, {
      fromEntityId: karen, toEntityId: jens, kind: 'mor til', category: 'slægt',
      fromTime: at('1928-11-19'),
    });

    /**
     * Doktor Lind husker et døgn ad gangen.
     *
     * Ikke af en skade, som Leonard, men fordi han drikker. Det er den samme
     * mekanisme brugt til noget helt andet, og det er værd at prøve af: en
     * upålidelig vidne er en almindelig figur, og modellen skal kunne holde ham
     * uden at han behøver at være et særtilfælde.
     */
    recordMemoryPolicy(s, ctx, {
      entityId: lind, retentionSeconds: DAY,
      note: 'Han husker et døgn. Derefter står kun det, han selv har skrevet ned.',
    });

    // ------------------------------------------------------------- kronologien
    const meeting = createEvent(s, ctx, {
      title: 'Aftalen på Sundvej', realmId, placeId: sundvej,
      earliest: at('1893-09-02T19:00'), latest: at('1893-09-02T21:00'),
      durationMin: HOUR, precision: 'hour',
    });
    const sinking = createEvent(s, ctx, {
      title: 'Marie Krag går ned', realmId, placeId: light,
      earliest: at('1893-10-14T02:00'), latest: at('1893-10-14T04:00'),
      durationMin: 40 * MIN, precision: 'hour',
    });
    const inquest = createEvent(s, ctx, {
      title: 'Søforhøret i Købstaden', realmId, placeId: town,
      earliest: at('1893-11-20'), latest: at('1893-11-20') + 6 * HOUR,
      durationMin: 4 * HOUR, precision: 'day',
    });
    const confession = createEvent(s, ctx, {
      title: 'Ingeborg får det at vide', realmId, placeId: farm,
      earliest: at('1893-12-01T20:00'), latest: at('1893-12-01T22:00'),
      durationMin: HOUR, precision: 'hour',
    });
    const birth = createEvent(s, ctx, {
      title: 'Karen fødes', realmId, placeId: farm,
      earliest: at('1895-03-08'), latest: at('1895-03-08') + 12 * HOUR,
      durationMin: 6 * HOUR, precision: 'day',
    });
    const vanishing = createEvent(s, ctx, {
      title: 'Mads ror ud og kommer ikke tilbage', realmId, placeId: harbour,
      earliest: at('1901-11-04T05:00'), latest: at('1901-11-04T06:00'),
      durationMin: 30 * MIN, precision: 'hour',
    });

    const letter = createEvent(s, ctx, {
      title: 'Brevet findes bag panelet', realmId, placeId: farm,
      earliest: at('1952-03-19T10:00'), latest: at('1952-03-19T12:00'),
      durationMin: 30 * MIN, precision: 'hour',
    });
    const askingEllen = createEvent(s, ctx, {
      title: 'Jens spørger Ellen', realmId, placeId: harbour,
      earliest: at('1952-03-21T14:00'), latest: at('1952-03-21T16:00'),
      durationMin: HOUR, precision: 'hour',
    });
    const archive = createEvent(s, ctx, {
      title: 'Søforhørets protokol i Købstaden', realmId, placeId: town,
      earliest: at('1952-04-02T09:00'), latest: at('1952-04-02T15:00'),
      durationMin: 2 * HOUR, precision: 'hour',
    });
    const reckoning = createEvent(s, ctx, {
      title: 'Jens siger det højt', realmId, placeId: sundvej,
      earliest: at('1952-04-11T16:00'), latest: at('1952-04-11T18:00'),
      durationMin: HOUR, precision: 'hour',
    });

    // ---------------------------------------------------------------- hvem var
    const be = (
      eventId: string, entityId: string,
      role: 'actor' | 'witness' | 'victim' | 'present_unaware' | 'mentioned' = 'actor',
      absorbs?: boolean,
    ) => addParticipation(s, ctx, {
      eventId, entityId, role, ...(absorbs === undefined ? {} : { absorbsKnowledge: absorbs }),
    });

    be(meeting, valdemar); be(meeting, mads);
    be(sinking, mads, 'victim'); be(sinking, valdemar, 'mentioned');
    be(inquest, valdemar); be(inquest, lind, 'witness'); be(inquest, ingeborg, 'witness');
    be(confession, ingeborg, 'witness'); be(confession, valdemar);
    be(birth, ingeborg); be(birth, karen, 'victim', false); be(birth, lind, 'witness');
    be(vanishing, mads, 'victim'); be(vanishing, ingeborg, 'witness');

    be(letter, jens); be(archive, jens);
    be(askingEllen, jens); be(askingEllen, ellen);
    be(reckoning, jens); be(reckoning, ellen, 'witness');

    linkEventFact(s, ctx, { eventId: meeting, factId: scuttled.factId, exposes: 'establishes' });
    linkEventFact(s, ctx, {
      eventId: confession, factId: scuttled.factId, exposes: 'reveals',
      slotIds: [scuttled.slotIds.get('bagmand')!],
    });
    linkEventFact(s, ctx, { eventId: birth, factId: paternity.factId, exposes: 'establishes' });
    linkEventFact(s, ctx, { eventId: vanishing, factId: madsFate.factId, exposes: 'evidences' });
    linkEventFact(s, ctx, { eventId: archive, factId: scuttled.factId, exposes: 'evidences' });

    recordPresence(s, ctx, {
      entityId: ingeborg, placeId: farm, realmId,
      fromTime: at('1892-06-18'), toTime: at('1944-01-12'),
    });
    recordPresence(s, ctx, {
      entityId: jens, placeId: farm, realmId,
      fromTime: at('1952-03-01'), toTime: at('1952-05-01'),
    });

    recordDisappearance(s, ctx, {
      entityId: mads, disappearsEventId: vanishing,
      note: 'Båden findes ved Fyret. Han gør ikke.',
    });

    // ------------------------------------------------------------------- viden
    recordBelief(s, ctx, {
      entityId: valdemar, factId: scuttled.factId, strength: 'knows',
      sincePersonal: at('1893-09-02T19:00'), slotIds: scuttled.slotIds,
      binds: { skib: { text: 'Marie Krag' }, bagmand: { entityId: valdemar } },
    });
    recordBelief(s, ctx, {
      entityId: ingeborg, factId: scuttled.factId, strength: 'knows',
      sincePersonal: at('1893-12-01T20:00'), slotIds: scuttled.slotIds,
      binds: { skib: { text: 'Marie Krag' }, bagmand: { entityId: valdemar } },
      sourceEventId: confession,
      note: 'Hun ved det fra december 1893 og siger det aldrig til nogen.',
    });
    recordBelief(s, ctx, {
      entityId: valdemar, factId: paternity.factId, strength: 'knows',
      sincePersonal: at('1895-03-08'), slotIds: paternity.slotIds,
      binds: { far: { entityId: valdemar }, barn: { entityId: karen } },
    });
    recordBelief(s, ctx, {
      entityId: ingeborg, factId: paternity.factId, strength: 'knows',
      sincePersonal: at('1895-03-08'), slotIds: paternity.slotIds,
      binds: { far: { entityId: valdemar }, barn: { entityId: karen } },
    });
    recordBelief(s, ctx, {
      entityId: karen, factId: paternity.factId, strength: 'unaware',
      sincePersonal: at('1895-03-08'),
    });
    recordBelief(s, ctx, {
      entityId: jens, factId: scuttled.factId, strength: 'suspects',
      sincePersonal: at('1952-03-19T10:00'), sourceEventId: letter,
    });
    recordBelief(s, ctx, {
      entityId: jens, factId: paternity.factId, strength: 'unaware',
      sincePersonal: at('1928-11-19'),
    });

    // Valdemar lyver ved søforhøret. En løgn er en handling, ikke en fejl.
    recordStatement(s, ctx, {
      speakerEntityId: valdemar, factId: scuttled.factId, truthful: false,
      eventId: inquest, atTime: at('1893-11-20T11:00'),
      note: 'Han forklarer det med vejret.',
    });
    // Ingeborg siger sandt om noget, hun faktisk ved — men først i 1952, og
    // kun til sig selv, i det brev barnebarnet finder.
    const paper = createEntity(s, ctx, {
      name: 'Ingeborgs brev', kind: 'object',
      summary: 'Skrevet i 1901, samme efterår Mads forsvinder, og gemt bag panelet '
        + 'i stuen. Fundet af Jens i 1952. Det er den eneste bærer, der får noget '
        + 'fra bog et helt frem til bog to uden at gå gennem et menneske.',
    });
    attachFactToCarrier(s, ctx, {
      objectEntityId: paper, factId: scuttled.factId,
      slotIds: scuttled.slotIds,
      binds: { skib: { text: 'Marie Krag' }, bagmand: { entityId: valdemar } },
      note: 'Hun skriver det ned, fordi hun ikke tør sige det.',
    });
    recordPossession(s, ctx, {
      holderEntityId: ingeborg, objectEntityId: paper,
      fromTime: at('1901-11-10'), toTime: at('1944-01-12'),
    });
    recordPossession(s, ctx, {
      holderEntityId: jens, objectEntityId: paper, fromTime: at('1952-03-19T10:30'),
    });

    createLaw(s, ctx, {
      kind: 'prohibition', hardness: 'soft',
      statement: 'Et søforhør i 1893 kunne ikke tvinge en reder til at forklare sig. '
        + 'Alt hvad Valdemar siger dér, er frivilligt — og derfor er det, han ikke siger, '
        + 'lige så meget værd som det, han siger.',
    });

    // --------------------------------------------------------------- bog et
    interface SceneSpec {
      title: string;
      event: string;
      pov: string;
      mode?: 'dramatised' | 'mentioned' | 'implied';
      reveals?: { factId: string; slotId?: string; strength: 'hinted' | 'implied' | 'stated' | 'confirmed' }[];
      prose?: Passage[];
      /** Passager, der er knyttet til noget i biblen — og som en note kan hænges på. */
      anchors?: { markId: string; targetKind: 'event' | 'fact' | 'entity'; targetId: string; excerpt: string }[];
    }
    interface ChapterSpec { title: string; summary: string; scenes: SceneSpec[] }

    const write = (workId: string, chapters: ChapterSpec[]) => {
      const madeScenes = new Map<string, string>();
      chapters.forEach((chapterSpec, chapterIndex) => {
        const chapterId = createChapter(s, ctx, store, {
          workId, title: chapterSpec.title, position: chapterIndex + 1,
          summary: chapterSpec.summary,
        });
        chapterSpec.scenes.forEach((spec, sceneIndex) => {
          const sceneId = createScene(s, ctx, store, {
            chapterId, title: spec.title, position: sceneIndex + 1,
            povEntityId: spec.pov, narrationPerson: 'third_limited',
            narrationTense: 'past', realmId,
          });
          madeScenes.set(spec.title, sceneId);
          linkSceneToEvent(s, ctx, {
            sceneId, eventId: spec.event, mode: spec.mode ?? 'dramatised',
          });
          for (const shown of spec.reveals ?? []) {
            createReveal(s, ctx, {
              factId: shown.factId, sceneId, slotId: shown.slotId, strength: shown.strength,
            });
          }
          if (spec.prose) {
            saveSceneText(s, ctx, store, {
              sceneId, doc: paragraphs(...spec.prose), markdown: markdownOf(...spec.prose),
            });
          }
          for (const tie of spec.anchors ?? []) {
            createTextAnchor(s, ctx, {
              sceneId, markId: tie.markId, targetKind: tie.targetKind,
              targetId: tie.targetId, excerpt: tie.excerpt,
            });
          }
        });
      });
      return madeScenes;
    };

    const first = write(firstWorkId, [
      {
        title: 'Aftalen',
        summary: 'To mænd bliver enige om noget, den ene fortryder samme nat.',
        scenes: [
          {
            title: 'Sundvej, september', event: meeting, pov: mads,
            reveals: [{ factId: scuttled.factId, strength: 'hinted' }],
            prose: [
              'Valdemar skænkede op uden at spørge, og det var den slags høflighed, der ikke er høflighed.',
              'Mads sagde ja, fordi der ikke var noget at sige nej med. Bagefter gik han hjem ad den lange vej og var alligevel fremme for tidligt.',
            ],
          },
          {
            title: 'Ingeborg tæller ugerne', event: meeting, pov: ingeborg, mode: 'mentioned',
            prose: [
              'Hun talte dem om morgenen, mens gryden stod og varmede, og hun talte dem forfra, når hun kom til et tal, hun ikke kunne lide.',
              'Mads kom hjem tidligere end aftalt og satte sig uden at tage frakken af. Hun spurgte ikke. Der var en slags spørgsmål, man kun kunne stille én gang, og hun ville gemme det.',
            ],
          },
        ],
      },
      {
        title: 'Natten ved Fyret',
        summary: 'Skibet går ned. Ingen af dem, der ved hvorfor, er om bord.',
        scenes: [
          {
            title: 'Vandet står ind', event: sinking, pov: mads,
            prose: [
              {
                text: 'Der var ingen storm. Det var det, han nåede at tænke: at der ingen storm var, og at det derfor måtte være noget, nogen havde gjort.',
                mark: { id: WEATHER_MARK, kind: 'event', label: '«Marie Krag» går ned' },
              },
              'Vandet kom ikke over rælingen. Det kom nedefra, roligt og fra flere steder på én gang, og det var derfor, han vidste det, længe før nogen kunne have sagt det til ham.',
            ],
            anchors: [{
              markId: WEATHER_MARK, targetKind: 'event', targetId: sinking,
              excerpt: 'Der var ingen storm.',
            }],
          },
        ],
      },
      {
        title: 'Søforhøret',
        summary: 'Der bliver sagt sandt om vejret og løjet om alt andet.',
        scenes: [
          {
            title: 'Valdemar forklarer sig', event: inquest, pov: valdemar,
            reveals: [{ factId: scuttled.factId, strength: 'implied' }],
            prose: [
              'Han sagde sandheden om vejret, og han sagde den grundigt, for den kostede ham ingenting. Kulingen havde lagt sig ved firetiden. Det stod i journalen, og enhver kunne slå det op.',
              'Om alt det andet sagde han, at han ikke havde været om bord. Det var også sandt. Han havde regnet med, at de to sætninger ville stå ved siden af hinanden og se ens ud.',
            ],
          },
          {
            title: 'Lind kan ikke huske det', event: inquest, pov: lind,
            prose: [
              'Han havde set noget den nat, det var han sikker på. Han kunne huske, at han havde været sikker. Selve synet var væk, som et navn man har haft på tungen og siden opgivet.',
              'Retten spurgte igen, venligt, og han svarede det eneste, han kunne stå inde for: at han ikke vidste det. Bagefter blev han stående på trappen og ledte efter det, indtil det blev mørkt.',
            ],
          },
          {
            title: 'Ingeborg siger ingenting', event: inquest, pov: ingeborg,
            prose: [
              'Hun sad på den bageste bænk med hænderne i skødet og hørte Valdemar sige det, hun allerede vidste, på en måde, der gjorde det til noget andet.',
              'Der var et øjeblik, hvor hun kunne have rejst sig. Hun mærkede det komme og mærkede det gå igen, og bagefter kunne hun ikke afgøre, om det var frygt eller regnskab, der havde holdt hende nede.',
            ],
          },
        ],
      },
      {
        title: 'December',
        summary: 'Hun får det at vide, og vælger at bære det.',
        scenes: [
          {
            title: 'Han fortæller hende det', event: confession, pov: ingeborg,
            reveals: [{
              factId: scuttled.factId, slotId: scuttled.slotIds.get('bagmand'),
              strength: 'confirmed',
            }],
            prose: [
              'Han sagde det, som var det en oplysning om priser. Hun blev stående med hånden på bordkanten og mærkede træet.',
              'Da han var gået, satte hun kedlen over. Det var det eneste, hun kunne finde på at gøre, og hun gjorde det omhyggeligt.',
            ],
          },
          {
            title: 'Karen kommer til verden', event: birth, pov: ingeborg,
            reveals: [{ factId: paternity.factId, strength: 'hinted' }],
            prose: [
              'Barnet kom om natten og skreg med det samme, og jordemoderen sagde, at det var et godt tegn. Ingeborg lå og så på loftsbrættet og tænkte på, hvor lidt et godt tegn dækker.',
              'Om morgenen kom Valdemar med noget indsvøbt og blev stående i døren. Han sagde ikke andet end tillykke. Det var rigeligt, og de vidste det begge to.',
            ],
          },
        ],
      },
      {
        title: 'Årene',
        summary: 'Mads ror ud en morgen i november.',
        scenes: [
          {
            title: 'Båden ved Fyret', event: vanishing, pov: ingeborg,
            reveals: [{ factId: madsFate.factId, strength: 'stated' }],
            prose: [
              'Båden lå og drev ind under Fyret med årerne på plads, og det var det, ingen kunne forklare: at årerne lå, som om nogen havde lagt dem ordentligt fra sig.',
              'Hun gik derned, da de kom og hentede hende, og hun så på det længe. Så sagde hun, at det var hans båd, og gik hjem og gjorde det, der skulle gøres den dag.',
            ],
          },
        ],
      },
    ]);

    // --------------------------------------------------------------- bog to
    const second = write(secondWorkId, [
      {
        title: 'Panelet',
        summary: 'Barnebarnet river en væg ned og finder noget bag den.',
        scenes: [
          {
            title: 'Brevet', event: letter, pov: jens,
            reveals: [{ factId: scuttled.factId, strength: 'hinted' }],
            prose: [
              'Papiret var gulnet på den måde, papir bliver, når det har ligget mørkt. Håndskriften kendte han fra bagsiden af fotografier.',
              'Han læste det to gange og lagde det så fra sig, som om det kunne gå i stykker af at blive holdt.',
            ],
          },
          {
            title: 'Han spørger sin mor', event: letter, pov: karen, mode: 'implied',
            prose: [
              'Hun tørrede hænderne, før hun tog brevet, og hun tog det med begge hænder, som man tager imod noget, der er tungere end det ser ud.',
              'Så sagde hun, at hendes mor havde haft en pæn håndskrift, og gav det tilbage. Jens ventede på resten. Der kom ikke mere den aften, og han forstod for sent, at det var svaret.',
            ],
          },
        ],
      },
      {
        title: 'Ellen',
        summary: 'Den anden families barnebarn ved mindre end han troede.',
        scenes: [
          {
            title: 'På kajen', event: askingEllen, pov: jens,
            prose: [
              'Han havde forberedt sig på en, der ville lyve, og stod nu over for en, der ikke vidste noget. Det var værre, for der var ingen steder at lægge det.',
              'Hun spurgte, hvad han mente med sænket, og han hørte sin egen stemme forklare det alt for grundigt, som man gør, når man opdager, at man er den eneste i samtalen, der har noget at miste.',
            ],
          },
          {
            title: 'Ellen hører navnet', event: askingEllen, pov: ellen,
            reveals: [{ factId: scuttled.factId, strength: 'implied' }],
            prose: [
              'Navnet på skibet havde hun hørt hele sin barndom, men altid som noget, der var sket ude i vejret, og aldrig som noget, nogen havde besluttet.',
              'Hun blev stående, efter at han var gået, og kiggede ud over bassinet, hvor halvdelen af det hele stadig stod i familiens navn. Det var første gang, hun tænkte på, hvad den halvdel var betalt med.',
            ],
          },
        ],
      },
      {
        title: 'Protokollen',
        summary: 'Det, der blev sagt i 1893, står der endnu.',
        scenes: [
          {
            title: 'Arkivet', event: archive, pov: jens,
            reveals: [{
              factId: scuttled.factId, slotId: scuttled.slotIds.get('bagmand'),
              strength: 'stated',
            }],
            prose: [
              'Protokollen var indbundet i noget, der engang havde været blåt. Skriften var en skrivers, jævn og uden mening om noget, og netop derfor stod det, der stod, så tydeligt.',
              'Han læste Valdemars forklaring to gange og fandt ikke en eneste løgn i den. Det var det, der gjorde ham kold: at man kan sige sandt hele vejen igennem og alligevel få hele rummet til at tro noget forkert.',
            ],
          },
        ],
      },
      {
        title: 'Sundvej, tres år efter',
        summary: 'Han siger det højt til den eneste, der er tilbage at sige det til.',
        scenes: [
          {
            title: 'Jens siger det', event: reckoning, pov: jens,
            reveals: [{
              factId: scuttled.factId, slotId: scuttled.slotIds.get('bagmand'),
              strength: 'confirmed',
            }],
            prose: [
              'Huset var det samme. Det var det værste ved det: at et hus kan stå og se ud, som om der ikke er sket noget i det.',
              'Han sagde det midt i en sætning om noget andet, fordi han vidste, at han ikke kunne begynde på det med vilje. Bagefter var der meget stille, og stilheden var ikke overraskelse.',
            ],
          },
          {
            title: 'Ellen bliver stående', event: reckoning, pov: ellen,
            reveals: [{ factId: paternity.factId, strength: 'implied' }],
            prose: [
              'Hun kunne være gået. Hun regnede endda ud, hvor lang tid det ville tage at komme ud til bilen, og hun blev alligevel stående ved vinduet med ryggen til dem begge.',
              'Det var regnestykket om Karen, hun ikke kunne få til at gå op på den pæne måde. Årstallet passede, og ansigtet passede, og hun havde set det hver eneste jul uden at se det.',
            ],
          },
        ],
      },
    ]);

    /**
     * Plottråde, og den grænse de løber ind i.
     *
     * Tråden hører til én bog -- `thread.work_id` -- så et setup i «Saltet» og
     * en indfrielse i «Tidevandet» kan ikke skrives som én tråd. Det er en
     * rigtig begrænsning i modellen for en serie, og den står her med vilje:
     * hver bog får sin egen tråd, og afstanden mellem dem er noget, man kun kan
     * se ved at læse begge.
     */
    const thread1 = createThread(s, ctx, {
      workId: firstWorkId, name: 'Skibet',
      summary: 'Hvad der skete med Marie Krag, og hvem der betalte for det.',
    });
    createBeat(s, ctx, {
      threadId: thread1, kind: 'setup', sceneId: first.get('Sundvej, september'),
      summary: 'Aftalen bliver indgået.',
    });
    createBeat(s, ctx, {
      threadId: thread1, kind: 'complication', sceneId: first.get('Valdemar forklarer sig'),
      summary: 'Løgnen ved søforhøret.',
    });
    createBeat(s, ctx, {
      threadId: thread1, kind: 'payoff', sceneId: first.get('Han fortæller hende det'),
      summary: 'Ingeborg får det at vide.',
    });

    const thread2 = createThread(s, ctx, {
      workId: secondWorkId, name: 'Brevet',
      summary: 'Det, Ingeborg skrev ned, og det, det koster tres år efter.',
    });
    createBeat(s, ctx, {
      threadId: thread2, kind: 'setup', sceneId: second.get('Brevet'),
      summary: 'Brevet findes.',
    });
    createBeat(s, ctx, {
      threadId: thread2, kind: 'complication', sceneId: second.get('På kajen'),
      summary: 'Ellen ved ingenting.',
    });
    createBeat(s, ctx, {
      threadId: thread2, kind: 'payoff', sceneId: second.get('Jens siger det'),
      summary: 'Det bliver sagt højt.',
    });

    /**
     * Research, og den ene margennote den fører til.
     *
     * Kilderne gemmes og vises; ingen af dem bliver læst maskinelt. Den vigtige
     * er vejrarkivet: forfatteren har selv markeret det som en mulig modstrid
     * med scenen, og det er den markering -- ikke et opslag i filen --
     * gennemgangen melder på.
     */
    const sinkingScene = first.get('Vandet står ind');
    if (!sinkingScene) throw new Error('Prøvecasen mangler scenen «Vandet står ind».');

    const weather = createSource(s, ctx, {
      title: 'Vejrarkiv for Kattegat, november 1893',
      kind: 'article',
      url: 'https://eksempel.dk/vejrarkiv/1893-11',
      note: 'Afskrift fra havnefogedens journal. Kuling fra nordvest natten til den 14.',
    });
    linkSource(s, ctx, {
      sourceId: weather, targetKind: 'scene', targetId: sinkingScene,
      relation: 'conflicts',
      note: 'Scenen siger, at der ingen storm var. Arkivet siger kuling.',
      quote: 'Kuling af nordvest, aftagende mod morgenstunden.',
    });

    const protocol = createSource(s, ctx, {
      title: 'Søforhørsprotokol, Sundby herredsret',
      kind: 'pdf',
      filePath: 'research/soeforhoer-1893.pdf',
      note: 'Fotograferede sider. Læses af mennesker, ikke af programmet.',
    });
    linkSource(s, ctx, {
      sourceId: protocol, targetKind: 'event', targetId: inquest, relation: 'supports',
    });

    // Gemt og aldrig knyttet til noget. Hylden findes for at kunne vise den her.
    createSource(s, ctx, {
      title: 'Fotografi: kajen set fra nord, 1951',
      kind: 'image',
      filePath: 'research/kajen-1951.jpg',
      note: 'Fundet i avisarkivet. Ved endnu ikke, hvad den skal bruges til.',
    });

    createSuggestion(s, ctx, {
      sceneId: sinkingScene,
      markId: WEATHER_MARK,
      kind: 'research',
      sourceId: weather,
      message: 'Vejrarkivet noterer kuling den aften. Enten skal Mads tage fejl med vilje — '
        + 'og så skal det stå, at han tager fejl — eller også skal sætningen om vejret gå.',
      proposedText: 'Der var storm, og alligevel var det ikke stormen. Det var det, han nåede '
        + 'at tænke, mens vandet kom: at det måtte være noget, nogen havde gjort.',
    });
  });

  bench.setActive({ worldId: created.worldId, workId: firstWorkId });
  return { worldId: created.worldId, seriesId, firstWorkId, secondWorkId };
}
