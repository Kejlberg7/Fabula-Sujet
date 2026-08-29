import { and, eq, inArray } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  chapter, entity, entityLeg, event, eventFact, fact, factSlot, participation,
  realm, reveal, scene, sceneEvent, sceneText, textAnchor,
} from '../../db/schema';
import type { Context } from '../workbench';
import { lawsLifting } from '../laws/consult';
import { personalTimeOf, whoKnewWhat, type KnowledgeItem } from './knowledge';
import { whatReaderKnows, type ReaderFact } from './reader';

/**
 * Everything the writing desk needs to keep one scene honest.
 *
 * The point of the desk is that the bible is not a second ledger you maintain
 * beside the manuscript: while you write the scene, the panel beside it answers
 * the only two questions that actually stop a draft -- what does the viewpoint
 * character know right now, and what does the reader know by now. The gap
 * between them is the irony; a crossing of them is a mistake.
 */

export interface Leak {
  kind: 'absent' | 'unknown_reveal' | 'unaware_of_own_scene';
  message: string;
  factId?: string;
  eventId?: string;
  /** A law may lift the rule. When one does, we say which, and do not warn. */
  lifted?: string;
}

export interface DeskScene {
  id: string;
  title: string | null;
  position: number;
  chapterId: string;
  chapterTitle: string;
  chapterPosition: number;
  narrationPerson: string | null;
  narrationTense: string | null;
  realmId: string | null;
  realmName: string | null;
  summary: string | null;
}

export interface DeskResult {
  scene: DeskScene;
  /** Neighbours in reading order, so the desk can be walked without leaving it. */
  previousSceneId: string | null;
  nextSceneId: string | null;
  prose: {
    textId: string | null;
    doc: unknown;
    markdown: string | null;
    wordCount: number | null;
    savedAt: number | null;
  };
  /**
   * When the scene is set, in world time -- read off the events it dramatises
   * rather than stored, so moving an event moves the scene with it. Null when
   * nothing it tells has been placed yet, and then the panel says so instead of
   * inventing a moment.
   */
  moment: { at: number | null; from: 'dramatised' | 'mentioned' | null };
  pov: {
    entityId: string;
    name: string;
    legId: string | null;
    legLabel: string | null;
    /** The moment on the viewpoint character's own clock. */
    at: number | null;
    knows: KnowledgeItem[];
  } | null;
  readerKnows: ReaderFact[];
  tells: {
    id: string;
    eventId: string;
    title: string;
    mode: string;
    from: number | null;
    povPresent: boolean;
  }[];
  reveals: {
    id: string;
    factId: string;
    summary: string;
    slotName: string | null;
    strength: string;
  }[];
  anchors: {
    id: string;
    markId: string;
    targetKind: string;
    targetId: string;
    targetLabel: string;
    excerpt: string | null;
  }[];
  leaks: Leak[];
  /**
   * What would have been reported, had a law not allowed it. Kept apart rather
   * than dropped: the engine must not warn about what an ability permits, but
   * seeing the law do its work is how you find out it says more than you meant.
   */
  lifted: Leak[];
}

/**
 * Naming a viewpoint is itself the writer saying "this scene is seen through
 * them", so an unset narration form does not switch the check off. Only saying
 * outright that the narrator is omniscient does.
 */
const isLimited = (narrationPerson: string | null) => narrationPerson !== 'third_omniscient';

export function sceneDesk(store: Store, ctx: Context, query: { sceneId: string }): DeskResult {
  const { db } = store;
  const sc = db.select().from(scene).where(eq(scene.id, query.sceneId)).get();
  if (!sc) throw new Error('Scenen findes ikke.');
  const ch = db.select().from(chapter).where(eq(chapter.id, sc.chapterId)).get();
  if (!ch) throw new Error('Scenen hænger ikke på et kapitel.');

  const nameOf = (id: string | null): string | null =>
    id ? db.select().from(entity).where(eq(entity.id, id)).get()?.name ?? null : null;
  const factSummary = (id: string): string =>
    db.select().from(fact).where(eq(fact.id, id)).get()?.summary ?? '(ukendt faktum)';

  // Reading order across the whole book, so "next" crosses a chapter boundary.
  const siblings = db.select().from(chapter)
    .where(and(eq(chapter.workId, ch.workId), eq(chapter.branchId, ctx.branchId))).all()
    .sort((a, b) => a.position - b.position);
  const reading = siblings.flatMap((c) =>
    db.select().from(scene).where(eq(scene.chapterId, c.id)).all()
      .sort((a, b) => a.position - b.position));
  const here = reading.findIndex((s) => s.id === sc.id);

  const links = db.select().from(sceneEvent)
    .where(and(eq(sceneEvent.sceneId, sc.id), eq(sceneEvent.branchId, ctx.branchId))).all();
  const events = new Map(
    links.map((l) => [l.eventId, db.select().from(event).where(eq(event.id, l.eventId)).get()]),
  );
  const startOf = (id: string): number | null => {
    const e = events.get(id);
    return e ? e.solvedEarliest ?? e.earliest ?? null : null;
  };

  /**
   * The scene's moment is the earliest thing it dramatises. Dramatised beats
   * mentioned on purpose: a scene set on Tuesday that mentions last summer is
   * still a Tuesday scene, and dating it to last summer would make every
   * knowledge answer wrong.
   */
  const timesFor = (mode: string) => links
    .filter((l) => l.mode === mode)
    .map((l) => startOf(l.eventId))
    .filter((t): t is number => t != null);
  const dramatised = timesFor('dramatised');
  const mentioned = timesFor('mentioned');
  const moment: DeskResult['moment'] = dramatised.length
    ? { at: Math.min(...dramatised), from: 'dramatised' }
    : mentioned.length
      ? { at: Math.min(...mentioned), from: 'mentioned' }
      : { at: null, from: null };

  /**
   * Who was in the room -- and, for someone with more than one leg, which self.
   *
   * Keying this on the person alone was wrong, and wrong in exactly the place
   * the model exists to get right: the traveller takes part in the drop-off as
   * the barkeep, so a scene seen through his younger self counted him as
   * present at something he has not lived yet. A leg is a different person for
   * every purpose but the name.
   */
  const participants = links.flatMap((l) =>
    db.select().from(participation)
      .where(and(eq(participation.eventId, l.eventId), eq(participation.branchId, ctx.branchId)))
      .all());

  const legCountOf = (entityId: string) => db.select().from(entityLeg)
    .where(and(eq(entityLeg.entityId, entityId), eq(entityLeg.branchId, ctx.branchId)))
    .all().length;

  const wasPresent = (eventId: string, entityId: string, legId: string | null): boolean =>
    participants.some((p) => {
      if (p.eventId !== eventId || p.entityId !== entityId) return false;
      if (p.legId && legId) return p.legId === legId;
      // With a leg missing on one side we can only be sure when there is
      // nothing to confuse it with. Anything else, we do not guess.
      return legCountOf(entityId) <= 1;
    });

  let pov: DeskResult['pov'] = null;
  if (sc.povEntityId) {
    const who = db.select().from(entity).where(eq(entity.id, sc.povEntityId)).get();
    if (who) {
      const clock = moment.at == null
        ? { at: null as number | null, legId: sc.povLegId ?? null }
        : personalTimeOf(store, ctx, {
            entityId: who.id, worldTime: moment.at, legId: sc.povLegId,
          });
      const answer = whoKnewWhat(store, ctx, {
        entityId: who.id,
        ...(clock.at == null ? {} : { at: clock.at }),
        ...(clock.legId ? { legId: clock.legId } : {}),
      });
      const legRow = answer.legId
        ? db.select().from(entityLeg).where(eq(entityLeg.id, answer.legId)).get()
        : undefined;
      pov = {
        entityId: who.id,
        name: who.name,
        legId: answer.legId,
        legLabel: legRow ? legRow.label ?? `ben ${legRow.ordinal}` : null,
        at: clock.at,
        knows: answer.items,
      };
    }
  }

  const revealRows = db.select().from(reveal)
    .where(and(eq(reveal.sceneId, sc.id), eq(reveal.branchId, ctx.branchId))).all();

  const knownFacts = new Set((pov?.knows ?? []).map((k) => k.factId));
  const leaks: Leak[] = [];

  /**
   * The check runs only where it means something. An omniscient narrator is
   * allowed to know more than anyone in the room, so warning about it would be
   * warning about the writer's own choice -- and a law may lift the rule
   * outright, which is asked before anything is reported, not after.
   */
  const limited = sc.povEntityId != null && isLimited(sc.narrationPerson);
  if (limited && pov) {
    const lifted = lawsLifting(store, ctx, {
      ruleCode: 'pov_leak',
      entityId: pov.entityId,
      entityKind: 'person',
      realmId: sc.realmId,
      workId: ch.workId,
      at: moment.at,
    });
    const exemption = lifted[0]?.statement;

    for (const l of links) {
      if (l.mode !== 'dramatised') continue;
      if (wasPresent(l.eventId, pov.entityId, pov.legId)) continue;
      leaks.push({
        kind: 'absent',
        eventId: l.eventId,
        message: `${pov.name} er ikke med i «${events.get(l.eventId)?.title ?? l.eventId}», men scenen dramatiserer den.`,
        ...(exemption ? { lifted: exemption } : {}),
      });
    }

    for (const r of revealRows) {
      if (knownFacts.has(r.factId)) continue;
      /**
       * A hint the viewpoint character does not have is not a mistake -- it is
       * foreshadowing, and limited narration does it constantly. Only an
       * outright disclosure is worth stopping for. Warning about every hint
       * would bury the one warning that matters, and a panel that cries wolf
       * gets switched off inside a week.
       */
      if (r.strength === 'hinted' || r.strength === 'implied') continue;
      leaks.push({
        kind: 'unknown_reveal',
        factId: r.factId,
        message: `Læseren får «${factSummary(r.factId)}» her, men ${pov.name} ved det ikke${
          pov.at == null ? '' : ' på dette tidspunkt'}.`,
        ...(exemption ? { lifted: exemption } : {}),
      });
    }

    /**
     * The viewpoint is in the room and the room shows something -- and the model
     * says they did not take it in. That is Leonard exactly: present, absorbing
     * nothing, and the scene has to be written from inside that.
     */
    for (const l of links) {
      const exposed = db.select().from(eventFact)
        .where(and(eq(eventFact.eventId, l.eventId), eq(eventFact.branchId, ctx.branchId))).all();
      for (const item of exposed) {
        if (knownFacts.has(item.factId)) continue;
        if (revealRows.some((r) => r.factId === item.factId)) continue;
        if (!wasPresent(l.eventId, pov.entityId, pov.legId)) continue;
        leaks.push({
          kind: 'unaware_of_own_scene',
          factId: item.factId,
          eventId: l.eventId,
          message: `Scenen viser «${factSummary(item.factId)}», og ${pov.name} er til stede — men tager det ikke til sig.`,
          ...(exemption ? { lifted: exemption } : {}),
        });
      }
    }
  }

  const current = db.select().from(sceneText)
    .where(and(eq(sceneText.sceneId, sc.id), eq(sceneText.isCurrent, true))).all()
    .filter((t) => t.branchId === ctx.branchId)[0];

  const anchorRows = db.select().from(textAnchor)
    .where(and(eq(textAnchor.sceneId, sc.id), eq(textAnchor.branchId, ctx.branchId))).all();

  const labelFor = (kind: string, id: string): string => {
    switch (kind) {
      case 'event': return db.select().from(event).where(eq(event.id, id)).get()?.title ?? id;
      case 'fact': return factSummary(id);
      case 'entity': return nameOf(id) ?? id;
      case 'reveal': {
        const r = db.select().from(reveal).where(eq(reveal.id, id)).get();
        return r ? `afsløring: ${factSummary(r.factId)}` : id;
      }
      default: return id;
    }
  };

  const slotNames = revealRows.length
    ? new Map(db.select().from(factSlot)
        .where(inArray(factSlot.factId, [...new Set(revealRows.map((r) => r.factId))])).all()
        .map((s) => [s.id, s.name]))
    : new Map<string, string>();

  return {
    scene: {
      id: sc.id, title: sc.title, position: sc.position,
      chapterId: ch.id, chapterTitle: ch.title, chapterPosition: ch.position,
      narrationPerson: sc.narrationPerson, narrationTense: sc.narrationTense,
      realmId: sc.realmId,
      realmName: sc.realmId
        ? db.select().from(realm).where(eq(realm.id, sc.realmId)).get()?.name ?? null
        : null,
      summary: sc.summary,
    },
    previousSceneId: here > 0 ? reading[here - 1]!.id : null,
    nextSceneId: here >= 0 && here < reading.length - 1 ? reading[here + 1]!.id : null,
    prose: {
      textId: current?.id ?? null,
      doc: current?.doc ?? null,
      markdown: current?.markdown ?? null,
      wordCount: current?.wordCount ?? null,
      savedAt: current?.createdAt?.getTime() ?? null,
    },
    moment,
    pov,
    readerKnows: whatReaderKnows(store, ctx, {
      workId: ch.workId, throughChapterPosition: ch.position,
    }),
    tells: links.map((l) => ({
      id: l.id, eventId: l.eventId,
      title: events.get(l.eventId)?.title ?? '(ukendt)',
      mode: l.mode, from: startOf(l.eventId),
      povPresent: pov ? wasPresent(l.eventId, pov.entityId, pov.legId) : false,
    })).sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity)),
    reveals: revealRows.map((r) => ({
      id: r.id, factId: r.factId, summary: factSummary(r.factId),
      slotName: r.slotId ? slotNames.get(r.slotId) ?? null : null,
      strength: r.strength,
    })),
    anchors: anchorRows.map((a) => ({
      id: a.id, markId: a.markId, targetKind: a.targetKind, targetId: a.targetId,
      targetLabel: labelFor(a.targetKind, a.targetId), excerpt: a.excerpt,
    })),
    leaks: leaks.filter((l) => !l.lifted),
    lifted: leaks.filter((l) => l.lifted),
  };
}
