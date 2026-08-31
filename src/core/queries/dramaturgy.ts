import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  beat, belief, carrier, chapter, entity, eventFact, fact, factSlot, reveal, scene,
  sceneEvent, statement, thread,
} from '../../db/schema';
import { readingOrder } from './order';
import { whatReaderKnows } from './reader';
import type { Context } from '../workbench';

/**
 * How well does a reveal actually work?
 *
 * The rest of the engine asks whether something is *possible*. This asks
 * whether it is any *good*, which is a different kind of question and needs a
 * different kind of answer. There is deliberately no score. "7.4 out of 10"
 * would be a number the writer cannot argue with and cannot act on; what helps
 * is being shown the scenes that produced the reading and being left to judge.
 *
 * Eight axes, each computed from something already written down:
 *
 *   overraskelse      how late it lands, and how much was flagged first
 *   retfærdighed      were the clues on the page before the disclosure
 *   efterrationalisering  were they there *unflagged* -- the good kind
 *   timing            where it sits, and how much book is left after it
 *   konsekvens        does anything happen because of it
 *   vildledning       is there a believable wrong answer in the way
 *   forberedelse      distance between setup and payoff on the thread
 *   informationskontrol  who else knew, and were they the viewpoint
 *
 * Every axis stays silent when the model has nothing to go on. A reading
 * invented from missing data would be worse than no reading.
 */

export type Axis =
  | 'overraskelse' | 'retfaerdighed' | 'efterrationalisering' | 'timing'
  | 'konsekvens' | 'vildledning' | 'forberedelse' | 'informationskontrol';

/** How the reading lands. Never a number; the message carries the substance. */
export type Verdict = 'staerk' | 'tynd' | 'se_efter';

export interface ScenePoint {
  id: string;
  title: string;
  order: number;
  chapterPosition: number;
  chapterTitle: string;
  /** Carried on the point so the axes never have to look a scene up again. */
  povEntityId: string | null;
}

export interface Reading {
  axis: Axis;
  title: string;
  verdict: Verdict;
  message: string;
  /** The scenes that produced the reading. This is the argument, not decoration. */
  scenes: ScenePoint[];
}

export interface TwistReport {
  factId: string;
  summary: string;
  truth: string;
  /** Where the reader is finally told. Null when it is only ever hinted at. */
  disclosure: (ScenePoint & { strength: string }) | null;
  /** Everything the reader is given about it, in reading order. */
  beats: (ScenePoint & { strength: string; slotName: string | null })[];
  totalScenes: number;
  /** Set when the reader already had this from an earlier book in the series. */
  carriedIn: string | null;
  readings: Reading[];
  /** A sentence assembled from the readings above -- never a score. */
  shape: string;
}

const STRENGTH_RANK: Record<string, number> = {
  hinted: 0, implied: 1, stated: 2, confirmed: 3,
};
const DISCLOSED = new Set(['stated', 'confirmed']);

const AXIS_TITLE: Record<Axis, string> = {
  overraskelse: 'Overraskelse',
  retfaerdighed: 'Retfærdighed',
  efterrationalisering: 'Efterrationalisering',
  timing: 'Timing',
  konsekvens: 'Konsekvens',
  vildledning: 'Vildledning',
  forberedelse: 'Forberedelse og indfrielse',
  informationskontrol: 'Informationskontrol',
};

/**
 * Every scene of one book, in order: the axis all of this is measured on.
 *
 * Not `readingOrder` from `./order`, which orders whole books against each
 * other. This one measures inside a single volume, in scenes.
 */
function sceneAxis(store: Store, ctx: Context, workId: string): ScenePoint[] {
  const { db } = store;
  const chapters = db.select().from(chapter)
    .where(and(eq(chapter.workId, workId), eq(chapter.branchId, ctx.branchId))).all()
    .sort((a, b) => a.position - b.position);
  const out: ScenePoint[] = [];
  for (const ch of chapters) {
    const scenes = db.select().from(scene)
      .where(and(eq(scene.chapterId, ch.id), eq(scene.branchId, ctx.branchId))).all()
      .sort((a, b) => a.position - b.position);
    for (const sc of scenes) {
      out.push({
        id: sc.id,
        title: sc.title ?? ch.title,
        order: out.length + 1,
        chapterPosition: ch.position,
        chapterTitle: ch.title,
        povEntityId: sc.povEntityId,
      });
    }
  }
  return out;
}

/** Danish for "a bit less than a third of the way in", without pretending to precision. */
function whereabouts(order: number, total: number): string {
  if (total <= 1) return 'i den eneste scene';
  const share = order / total;
  if (order === total) return 'i allersidste scene';
  if (order === 1) return 'i allerførste scene';
  if (share <= 0.25) return 'tidligt i bogen';
  if (share <= 0.55) return 'omkring midten';
  if (share <= 0.8) return 'i sidste tredjedel';
  return 'helt mod slutningen';
}

export function twistReadings(
  store: Store, ctx: Context, query: { workId: string },
): TwistReport[] {
  const { db } = store;
  const order = sceneAxis(store, ctx, query.workId);
  const pointOf = new Map(order.map((p) => [p.id, p]));
  const total = order.length;
  if (total === 0) return [];

  const reveals = db.select().from(reveal)
    .where(eq(reveal.branchId, ctx.branchId)).all()
    .filter((r) => pointOf.has(r.sceneId));
  if (reveals.length === 0) return [];

  const facts = new Map(db.select().from(fact)
    .where(eq(fact.branchId, ctx.branchId)).all().map((f) => [f.id, f]));
  const nameOf = (id: string | null | undefined) =>
    (id ? db.select().from(entity).where(eq(entity.id, id)).get()?.name : null) ?? 'nogen';

  // Which scenes put a given event on the page, so a clue can be located.
  const scenesOfEvent = new Map<string, string[]>();
  for (const link of db.select().from(sceneEvent)
    .where(eq(sceneEvent.branchId, ctx.branchId)).all()) {
    if (!pointOf.has(link.sceneId)) continue;
    const list = scenesOfEvent.get(link.eventId) ?? [];
    list.push(link.sceneId);
    scenesOfEvent.set(link.eventId, list);
  }

  const byFact = new Map<string, typeof reveals>();
  for (const r of reveals) {
    const list = byFact.get(r.factId) ?? [];
    list.push(r);
    byFact.set(r.factId, list);
  }

  const slotNames = new Map(db.select().from(factSlot)
    .where(eq(factSlot.branchId, ctx.branchId)).all().map((s) => [s.id, s.name]));

  /**
   * What the reader walks in already holding.
   *
   * In a series that is everything the earlier books told them. A fact they
   * have carried across a volume boundary cannot be a surprise here, however
   * the scenes are arranged, and reading it as one would be the single most
   * misleading thing this file could do.
   */
  const carried = new Map(
    whatReaderKnows(store, ctx, { workId: query.workId, throughChapterPosition: 0 })
      .map((f) => [f.factId, f.fromEarlierWork]),
  );

  const reports: TwistReport[] = [];
  for (const [factId, rows] of byFact) {
    const known = facts.get(factId);
    if (!known) continue;

    const beats = rows
      .map((r) => ({
        ...pointOf.get(r.sceneId)!,
        strength: r.strength,
        slotName: r.slotId ? slotNames.get(r.slotId) ?? null : null,
      }))
      .sort((a, b) => a.order - b.order);

    const disclosureRow = beats.find((b) => DISCLOSED.has(b.strength)) ?? null;
    const disclosure = disclosureRow
      ? { ...disclosureRow, strength: disclosureRow.strength }
      : null;
    const cutoff = disclosure?.order ?? total + 1;

    /**
     * Clues the reader was actually given before being told.
     *
     * Two kinds, and the difference is the whole craft of it: a *flagged* clue
     * is a hint the book presents as a hint, while an *unflagged* one is a
     * scene that shows the thing without pointing at it. The second kind is
     * what makes a twist feel inevitable afterwards.
     */
    const flagged = beats.filter((b) => b.order < cutoff && !DISCLOSED.has(b.strength));
    const exposingEvents = db.select().from(eventFact)
      .where(and(eq(eventFact.factId, factId), eq(eventFact.branchId, ctx.branchId))).all();
    const unflagged: ScenePoint[] = [];
    for (const item of exposingEvents) {
      for (const sceneId of scenesOfEvent.get(item.eventId) ?? []) {
        const point = pointOf.get(sceneId)!;
        if (point.order >= cutoff) continue;
        if (beats.some((b) => b.id === sceneId)) continue;
        if (unflagged.some((p) => p.id === sceneId)) continue;
        unflagged.push(point);
      }
    }
    unflagged.sort((a, b) => a.order - b.order);

    const readings: Reading[] = [];
    const add = (
      axis: Axis, verdict: Verdict, message: string, scenes: ScenePoint[] = [],
    ) => readings.push({ axis, title: AXIS_TITLE[axis], verdict, message, scenes });

    // ------------------------------------------------------------ overraskelse
    const carriedIn = carried.get(factId) ?? null;
    if (carriedIn) {
      add('overraskelse', 'staerk',
        `Læseren har det med fra «${carriedIn}». Det, der sker her, er ikke en afsløring for `
        + 'læseren, men afstanden mellem det, læseren ved, og det personerne ved — '
        + 'og den afstand er hele grebet i en efterfølger.',
        disclosure ? [disclosure] : []);
    } else if (disclosure) {
      const flaggedCount = flagged.length;
      add(
        'overraskelse',
        flaggedCount >= 3 ? 'se_efter' : 'staerk',
        `Sagt rent ud ${whereabouts(disclosure.order, total)} — scene ${disclosure.order} af ${total}`
        + (flaggedCount === 0
          ? ', uden at bogen har peget på det først.'
          : ` efter ${flaggedCount} ${flaggedCount === 1 ? 'vink' : 'vink'}.`)
        + (flaggedCount >= 3
          ? ' Så mange varsler gør det svært for læseren ikke at være nået frem selv.'
          : ''),
        [disclosure, ...flagged],
      );
    } else {
      add('overraskelse', 'se_efter',
        'Læseren får det aldrig sagt rent ud — kun antydet. Er det med vilje, er det en åben slutning; '
        + 'er det ikke, mangler afsløringen.',
        beats);
    }

    // ----------------------------------------------------------- retfærdighed
    if (disclosure && !carriedIn) {
      const clues = [...flagged, ...unflagged].sort((a, b) => a.order - b.order);
      if (clues.length === 0) {
        add('retfaerdighed', 'tynd',
          'Der står intet om det nogen steder, før det bliver sagt. Læseren kunne ikke have gættet det, '
          + 'og et twist uden spor føles som snyd frem for som en pointe.',
          [disclosure]);
      } else {
        add('retfaerdighed', 'staerk',
          `${clues.length} ${clues.length === 1 ? 'scene bærer' : 'scener bærer'} sporet, før det bliver sagt — `
          + `første gang i scene ${clues[0]!.order}.`,
          clues);
      }
    }

    // ------------------------------------------------- efterrationalisering
    if (carriedIn) {
      // Intet at efterrationalisere: læseren vidste det, før bogen begyndte.
    } else if (disclosure && unflagged.length > 0) {
      add('efterrationalisering', 'staerk',
        `${unflagged.length} ${unflagged.length === 1 ? 'scene viser' : 'scener viser'} det, uden at bogen `
        + 'gør opmærksom på det. Det er dem, læseren vender tilbage til bagefter.',
        unflagged);
    } else if (disclosure && flagged.length > 0) {
      add('efterrationalisering', 'se_efter',
        'Alle spor er markeret som vink. Der er ikke noget, læseren selv kan opdage bagefter — '
        + 'overvej at lade en scene vise det uden at pege på det.',
        flagged);
    }

    // ------------------------------------------------------------------ timing
    if (disclosure) {
      const after = total - disclosure.order;
      add('timing', after === 0 ? 'se_efter' : 'staerk',
        after === 0
          ? 'Afsløringen er sidste scene. Der er ingen plads tilbage til at vise, hvad den gør ved nogen — '
            + 'hvilket kan være meningen, men det er et valg.'
          : `Der er ${after} ${after === 1 ? 'scene' : 'scener'} tilbage efter afsløringen til at følge den op.`,
        [disclosure]);
    }

    // -------------------------------------------------------------- konsekvens
    if (disclosure) {
      const laterBeats = db.select().from(beat)
        .where(eq(beat.branchId, ctx.branchId)).all()
        .filter((b) => b.kind === 'payoff' && b.sceneId && pointOf.has(b.sceneId))
        .map((b) => pointOf.get(b.sceneId!)!)
        .filter((p) => p.order >= disclosure.order);
      const laterKnowers = db.select().from(belief)
        .where(and(eq(belief.factId, factId), eq(belief.branchId, ctx.branchId))).all()
        .filter((b) => b.strength !== 'unaware').length;
      if (laterBeats.length > 0) {
        add('konsekvens', 'staerk',
          `${laterBeats.length} ${laterBeats.length === 1 ? 'indfrielse ligger' : 'indfrielser ligger'} `
          + 'fra afsløringen og frem.', laterBeats);
      } else if (total - disclosure.order > 0) {
        add('konsekvens', 'se_efter',
          `Der sker ${total - disclosure.order} ${total - disclosure.order === 1 ? 'scene' : 'scener'} `
          + 'efter afsløringen, men ingen af dem er registreret som en indfrielse. '
          + `${laterKnowers} ${laterKnowers === 1 ? 'person ved' : 'personer ved'} det — ændrer det noget for dem?`,
          []);
      }
    }

    // ------------------------------------------------------------- vildledning
    const lies = db.select().from(statement)
      .where(and(eq(statement.factId, factId), eq(statement.branchId, ctx.branchId))).all()
      .filter((s) => s.truthful === false);
    const mistaken = db.select().from(belief)
      .where(and(eq(belief.factId, factId), eq(belief.branchId, ctx.branchId))).all()
      .filter((b) => b.strength === 'mistaken' || b.strength === 'denies');
    const falseWriting = db.select().from(carrier)
      .where(and(eq(carrier.factId, factId), eq(carrier.branchId, ctx.branchId))).all()
      .filter((c) => !c.accurate);
    const misdirection = lies.length + mistaken.length + falseWriting.length;
    if (misdirection > 0) {
      const who = [
        ...lies.map((s) => `${nameOf(s.speakerEntityId)} lyver om det`),
        ...mistaken.map((b) => `${nameOf(b.entityId)} tror noget andet`),
        ...falseWriting.map(() => 'noget skrevet er forkert'),
      ];
      add('vildledning', 'staerk',
        `Der står en troværdig forkert forklaring i vejen: ${[...new Set(who)].join('; ')}.`, []);
    } else if (disclosure) {
      add('vildledning', 'tynd',
        'Ingen lyver om det, og ingen tror noget forkert. Læseren har intet at blive ført på afveje af, '
        + 'så der er ikke rigtig noget at tage fejl af.', []);
    }

    // ------------------------------------------------------------ forberedelse
    const books = readingOrder(store, ctx);
    const threads = db.select().from(thread)
      .where(eq(thread.branchId, ctx.branchId)).all()
      .filter((row) => books.covers(row, query.workId));
    const allBeats = db.select().from(beat)
      .where(eq(beat.branchId, ctx.branchId)).all()
      .filter((b) => threads.some((t) => t.id === b.threadId))
      .filter((b) => b.sceneId && pointOf.has(b.sceneId));
    /**
     * Only threads that actually touch this reveal.
     *
     * Measuring against every thread in the book made each fact report the same
     * span -- the longest one in the manuscript -- as if it were its own
     * preparation. A thread counts here when one of its beats sits in a scene
     * that gives the reader something about this fact.
     */
    const revealScenes = new Set(beats.map((b) => b.id));
    const relatedThreads = new Set(
      allBeats.filter((b) => revealScenes.has(b.sceneId!)).map((b) => b.threadId),
    );
    const relatedBeats = allBeats.filter((b) => relatedThreads.has(b.threadId));
    const setups = relatedBeats.filter((b) => b.kind === 'setup')
      .map((b) => pointOf.get(b.sceneId!)!);
    const payoffs = relatedBeats.filter((b) => b.kind === 'payoff')
      .map((b) => pointOf.get(b.sceneId!)!);
    if (setups.length > 0 && payoffs.length > 0) {
      const gap = Math.max(...payoffs.map((p) => p.order)) - Math.min(...setups.map((p) => p.order));
      add('forberedelse', gap <= 1 ? 'se_efter' : 'staerk',
        gap <= 1
          ? 'Setup og indfrielse ligger lige ved siden af hinanden. Der er ikke tid til, at læseren når at glemme det.'
          : `Der går ${gap} scener fra det første setup til den sidste indfrielse.`,
        [...setups, ...payoffs].sort((a, b) => a.order - b.order));
    }

    // ------------------------------------------------------ informationskontrol
    if (disclosure) {
      const knowers = db.select().from(belief)
        .where(and(eq(belief.factId, factId), eq(belief.branchId, ctx.branchId))).all()
        .filter((b) => b.strength !== 'unaware');
      const povEarly: ScenePoint[] = [];
      for (const holder of knowers) {
        // Synsvinklen står allerede på punktet. Et opslag her ville koste én
        // forespørgsel per scene per vidende per faktum — på en bog i rigtig
        // længde bliver det til tusinder for én sideindlæsning.
        for (const point of order) {
          if (point.order >= disclosure.order) continue;
          if (point.povEntityId === holder.entityId && !povEarly.some((p) => p.id === point.id)) {
            povEarly.push(point);
          }
        }
      }
      povEarly.sort((a, b) => a.order - b.order);
      /**
       * Held from the first page, or picked up along the way?
       *
       * A viewpoint who has known it since before the book began is the
       * premise -- Leonard knows his wife is dead on page one -- and calling
       * that a leak in nine separate scenes would be noise. What is worth a
       * second look is the narrow case: a viewpoint who knows it in a scene or
       * two before the reader does, which is usually somewhere it slipped.
       */
      if (povEarly.length > 0) {
        const fromTheStart = povEarly[0]!.order === 1;
        const span = disclosure.order - 1;
        const whoKnows = [...new Set(knowers.map((k) => nameOf(k.entityId)))].join(', ');
        add('informationskontrol',
          fromTheStart || povEarly.length > span / 2 ? 'staerk' : 'se_efter',
          fromTheStart || povEarly.length > span / 2
            ? `${whoKnows} ved det hele vejen, mens læseren ikke gør — `
              + `${povEarly.length} af de ${span} scener før afsløringen fortælles derfra. `
              + 'Det er tilbageholdt information, og det bærer spændingen.'
            : `${povEarly.length} ${povEarly.length === 1 ? 'scene fortælles' : 'scener fortælles'} fra `
              + `${whoKnows}, der allerede ved det, før læseren får det. Dramatisk ironi, hvis du vil det — `
              + 'og en utæthed, hvis du ikke gør.',
          povEarly);
      }
    }

    /**
     * A sentence made of the readings above, so the list has a headline.
     * It says nothing the readings do not already say.
     */
    const worries = readings.filter((r) => r.verdict !== 'staerk');
    const shape = carriedIn
      ? `Læseren har det med fra «${carriedIn}»${
          worries.length === 0 ? '.' : ` — ${worries.length} ting at se efter.`}`
      : disclosure
      ? `${whereabouts(disclosure.order, total)}${
          readings.some((r) => r.axis === 'retfaerdighed' && r.verdict === 'staerk')
            ? ', og forberedt' : ', men uforberedt'}${
          worries.length === 0 ? '.' : ` — ${worries.length} ${worries.length === 1 ? 'ting' : 'ting'} at se efter.`}`
      : 'Aldrig sagt rent ud.';

    reports.push({
      factId,
      summary: known.summary,
      truth: known.truth,
      disclosure,
      beats,
      totalScenes: total,
      carriedIn,
      readings,
      shape: shape.charAt(0).toUpperCase() + shape.slice(1),
    });
  }

  // The latest disclosure first: that is usually the one carrying the book.
  return reports.sort((a, b) => (b.disclosure?.order ?? 0) - (a.disclosure?.order ?? 0));
}

export interface TwistShift {
  factId: string;
  summary: string;
  /** Reading position on each side. Null when the branch never says it outright. */
  here: number | null;
  there: number | null;
  hereShape: string;
  thereShape: string;
  /** Axes whose verdict differs, with both readings so the change can be read. */
  moved: { axis: Axis; title: string; here: string; there: string }[];
}

/**
 * The same reveals, read on two branches.
 *
 * This is what phase 6 was for. "The twist in chapter 8" against "the twist in
 * chapter 12" is not a question anyone can answer in the abstract -- but with
 * both arrangements written down, the axes that move between them are exactly
 * the argument for choosing one.
 *
 * Facts are matched through `origin_id`, so a copied fact on a branch is
 * recognised as the same claim rather than a new one.
 */
export function compareTwists(
  store: Store,
  input: {
    here: Context; hereWorkId: string;
    there: Context; thereWorkId: string;
    lineage: (table: 'fact', id: string) => string;
  },
): TwistShift[] {
  const here = twistReadings(store, input.here, { workId: input.hereWorkId });
  const there = twistReadings(store, input.there, { workId: input.thereWorkId });
  const byRoot = new Map(there.map((r) => [input.lineage('fact', r.factId), r]));

  const shifts: TwistShift[] = [];
  for (const mine of here) {
    const other = byRoot.get(input.lineage('fact', mine.factId));
    if (!other) continue;
    const moved: TwistShift['moved'] = [];
    const axes = new Set<Axis>([
      ...mine.readings.map((r) => r.axis), ...other.readings.map((r) => r.axis),
    ]);
    for (const axis of axes) {
      const a = mine.readings.find((r) => r.axis === axis);
      const b = other.readings.find((r) => r.axis === axis);
      if (a?.verdict === b?.verdict && a?.message === b?.message) continue;
      moved.push({
        axis,
        title: AXIS_TITLE[axis],
        here: a?.message ?? 'ingen aflæsning',
        there: b?.message ?? 'ingen aflæsning',
      });
    }
    if (moved.length === 0 && mine.disclosure?.order === other.disclosure?.order) continue;
    shifts.push({
      factId: mine.factId,
      summary: mine.summary,
      here: mine.disclosure?.order ?? null,
      there: other.disclosure?.order ?? null,
      hereShape: mine.shape,
      thereShape: other.shape,
      moved,
    });
  }
  return shifts;
}
