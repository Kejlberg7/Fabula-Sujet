import { eq } from 'drizzle-orm';
import {
  chapter, entityState, identity, possession, reveal, scene, sceneEvent, textAnchor,
} from '../../db/schema';
import { whatReaderKnows } from '../queries/reader';
import { fingerprint, sameLife, type Finding, type Rule, type Snapshot } from './kit';

/**
 * The prose, taken as evidence.
 *
 * Every other rule reads the model. These read the manuscript: a mention is the
 * writer pointing at something while writing, and that pointing can be held up
 * against what the bible says was true at that moment.
 *
 * What a mention does *not* say is that anybody is in the room. «Han tænkte på
 * Valdemar» names Valdemar and puts him nowhere. Presence, possession and
 * object state are checked only when the writer explicitly marks those claims;
 * a rule that inferred them from a mention would fire on the most ordinary
 * sentence in the book. A plain mention can still be checked for time, identity
 * and reader order.
 */

/** Naming a viewpoint binds the narration to it; only omniscience unbinds it. */
const isLimited = (narrationPerson: string | null) => narrationPerson !== 'third_omniscient';

interface SceneView {
  row: typeof scene.$inferSelect;
  workId: string;
  chapterTitle: string;
  chapterPosition: number;
  /**
   * The scene's present: the earliest thing it *dramatises*.
   *
   * Deliberately not the desk's rule, which falls back to a mentioned event.
   * That fallback is right for «what time is this scene about»; it is wrong for
   * «what was true while this was happening». A barkeep in 1970 telling the
   * story of a child left in 1945 would otherwise be judged against 1945, and
   * every name he has used since would look like it did not exist yet. A scene
   * that dramatises nothing has no present, and then these rules say nothing.
   */
  at: number | null;
  limited: boolean;
  anchors: typeof textAnchor.$inferSelect[];
  reveals: typeof reveal.$inferSelect[];
  linkedEvents: Set<string>;
  dramatisedEvents: string[];
}

/** One pass over the branch, shared by the three rules in this file. */
const views = new WeakMap<Snapshot, SceneView[]>();

function scenesOf(snap: Snapshot): SceneView[] {
  const cached = views.get(snap);
  if (cached) return cached;
  const { db } = snap.store;
  const branch = snap.ctx.branchId;

  const chapters = new Map(db.select().from(chapter)
    .where(eq(chapter.branchId, branch)).all().map((ch) => [ch.id, ch]));
  const anchorsByScene = new Map<string, typeof textAnchor.$inferSelect[]>();
  for (const row of db.select().from(textAnchor).where(eq(textAnchor.branchId, branch)).all()) {
    anchorsByScene.set(row.sceneId, [...(anchorsByScene.get(row.sceneId) ?? []), row]);
  }
  const revealsByScene = new Map<string, typeof reveal.$inferSelect[]>();
  for (const row of db.select().from(reveal).where(eq(reveal.branchId, branch)).all()) {
    revealsByScene.set(row.sceneId, [...(revealsByScene.get(row.sceneId) ?? []), row]);
  }
  const linksByScene = new Map<string, typeof sceneEvent.$inferSelect[]>();
  for (const row of db.select().from(sceneEvent).where(eq(sceneEvent.branchId, branch)).all()) {
    linksByScene.set(row.sceneId, [...(linksByScene.get(row.sceneId) ?? []), row]);
  }

  const startOf = (id: string): number | null => {
    const row = snap.events.get(id);
    return row ? row.solvedEarliest ?? row.earliest ?? null : null;
  };

  const built = db.select().from(scene).where(eq(scene.branchId, branch)).all()
    .flatMap((row) => {
      const ch = chapters.get(row.chapterId);
      if (!ch) return [];
      const links = linksByScene.get(row.id) ?? [];
      const dramatised = links.filter((l) => l.mode === 'dramatised')
        .map((l) => startOf(l.eventId)).filter((t): t is number => t != null);
      return [{
        row,
        workId: ch.workId,
        chapterTitle: ch.title,
        chapterPosition: ch.position,
        at: dramatised.length ? Math.min(...dramatised) : null,
        limited: row.povEntityId != null && isLimited(row.narrationPerson),
        anchors: anchorsByScene.get(row.id) ?? [],
        reveals: revealsByScene.get(row.id) ?? [],
        linkedEvents: new Set(links.map((l) => l.eventId)),
        dramatisedEvents: links.filter((link) => link.mode === 'dramatised').map((link) => link.eventId),
      }];
    });
  views.set(snap, built);
  return built;
}

const where = (view: SceneView) =>
  `«${view.row.title ?? view.chapterTitle}»`;

/**
 * A bound narration cannot point at something that has not happened.
 *
 * The scene is on a Tuesday and the passage is marked as being about a
 * shipwreck the following spring. An omniscient narrator may do that all day;
 * a narration tied to one head may not, unless the viewpoint has reason to
 * expect it -- and then it is that expectation the bible is missing, not the
 * mark.
 *
 * Only certainty is reported: the event's *earliest* possible moment has to be
 * later than the scene's. An event that could be placed before it is an event
 * the writer has not dated yet, and that is not a mistake.
 */
export const mentionAheadOfTime: Rule = {
  code: 'mention_ahead_of_time',
  title: 'Omtale før sin tid',
  run: (snap) => {
    const findings: Finding[] = [];
    for (const view of scenesOf(snap)) {
      if (!view.limited || view.at == null) continue;
      for (const anchor of view.anchors) {
        if (anchor.targetKind !== 'event') continue;
        // Er eventet knyttet til scenen, er det POV-reglens sag, ikke denne.
        if (view.linkedEvents.has(anchor.targetId)) continue;
        const happened = snap.events.get(anchor.targetId);
        const earliest = happened?.solvedEarliest ?? happened?.earliest;
        if (happened == null || earliest == null || earliest <= view.at) continue;

        const lifted = snap.lifted({
          ruleCode: 'mention_ahead_of_time',
          entityId: view.row.povEntityId, realmId: view.row.realmId, at: view.at,
        });
        findings.push({
          ruleCode: 'mention_ahead_of_time', severity: 'note',
          message:
            `${where(view)} peger i prosaen på «${happened.title}», som tidligst sker senere. `
            + `Scenen er bunden til ${snap.name(view.row.povEntityId)}, så enten varsler `
            + 'fortælleren noget, synsvinklen ikke kan kende, eller også er det noget, den '
            + 'venter sig — og så mangler bibelen forventningen, ikke mærket.',
          subjects: {
            rows: [view.row.id, anchor.id], events: [happened.id],
            entities: view.row.povEntityId ? [view.row.povEntityId] : [],
          },
          fingerprint: fingerprint('mention_ahead_of_time', view.row.id, anchor.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

/**
 * A name has a stretch of time in which it is that person's name.
 *
 * The model already refuses to let somebody *appear* under an alias outside its
 * window. This is the same claim made by the prose instead: the passage calls
 * him Teddy, and at that moment nobody was called Teddy yet.
 */
export const mentionNameNotYet: Rule = {
  code: 'mention_name_not_yet',
  title: 'Navn uden for sin tid',
  run: (snap) => {
    const aliases = new Map(snap.store.db.select().from(identity)
      .where(eq(identity.branchId, snap.ctx.branchId)).all().map((row) => [row.id, row]));
    const findings: Finding[] = [];
    for (const view of scenesOf(snap)) {
      if (view.at == null) continue;
      for (const anchor of view.anchors) {
        if (anchor.targetKind !== 'identity') continue;
        const alias = aliases.get(anchor.targetId);
        if (!alias) continue;
        const early = alias.validFrom != null && view.at < alias.validFrom;
        const late = alias.validTo != null && view.at > alias.validTo;
        if (!early && !late) continue;

        const lifted = snap.lifted({
          ruleCode: 'mention_name_not_yet',
          entityId: alias.entityId, realmId: view.row.realmId, at: view.at,
        });
        findings.push({
          ruleCode: 'mention_name_not_yet', severity: 'warning',
          message:
            `${where(view)} bruger navnet «${alias.name}» om ${snap.name(alias.entityId)}, `
            + (early
              ? 'før identiteten er taget i brug.'
              : 'efter identiteten er ophørt.')
            + ' Enten er scenen sat forkert, eller også skal navnets gyldighed flyttes.',
          subjects: {
            rows: [view.row.id, anchor.id, alias.id], entities: [alias.entityId],
          },
          fingerprint: fingerprint('mention_name_not_yet', view.row.id, anchor.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

/**
 * The reader has not been told, and the prose is pointing at it anyway.
 *
 * A mention of a fact in a chapter before the reader gets it is not wrong --
 * that is what a hint is. But a hint that nobody has written down as a reveal
 * is invisible to every other reckoning in the program: the reveal order, what
 * the reader knows, the grip. So the finding is not «you gave it away», it is
 * «this is either a hint that should be recorded, or a disclosure standing too
 * early», and both of those are the writer's call.
 */
export const mentionReaderAhead: Rule = {
  code: 'mention_reader_ahead',
  title: 'Omtale før læseren ved det',
  run: (snap) => {
    const findings: Finding[] = [];
    const known = new Map<string, Map<string, number>>();
    /** Which chapter first hands each fact to the reader, up to this point. */
    const readerAt = (workId: string, through: number) => {
      const key = `${workId}:${through}`;
      const seen = known.get(key);
      if (seen) return seen;
      const built = new Map(whatReaderKnows(snap.store, snap.ctx, {
        workId, throughChapterPosition: through,
      }).map((item) => [item.factId, item.firstChapter]));
      known.set(key, built);
      return built;
    };
    const revealedIn = new Map<string, number>();
    for (const view of scenesOf(snap)) {
      for (const row of view.reveals) {
        const at = revealedIn.get(row.factId);
        if (at == null || view.chapterPosition < at) {
          revealedIn.set(row.factId, view.chapterPosition);
        }
      }
    }

    for (const view of scenesOf(snap)) {
      const here = readerAt(view.workId, view.chapterPosition);
      for (const anchor of view.anchors) {
        if (anchor.targetKind !== 'fact') continue;
        // Står afsløringen i scenen, er den skrevet ned, og så er alt i orden.
        if (view.reveals.some((r) => r.factId === anchor.targetId)) continue;
        if (here.has(anchor.targetId)) continue;
        const summary = snap.facts.get(anchor.targetId)?.summary;
        if (!summary) continue;

        const later = revealedIn.get(anchor.targetId);
        const lifted = snap.lifted({
          ruleCode: 'mention_reader_ahead',
          entityId: view.row.povEntityId, realmId: view.row.realmId, at: view.at,
        });
        findings.push({
          ruleCode: 'mention_reader_ahead', severity: 'note',
          message:
            `${where(view)} peger i prosaen på «${summary}», `
            + (later == null
              ? 'som læseren aldrig får at vide.'
              : `som læseren først får i kapitel ${later}.`)
            + ' Er passagen en antydning, mangler den at stå som en afsløring; '
            + 'er den mere end det, står den for tidligt.',
          subjects: {
            rows: [view.row.id, anchor.id], facts: [anchor.targetId],
          },
          fingerprint: fingerprint('mention_reader_ahead', view.row.id, anchor.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

/** A person explicitly shown in a scene cannot be elsewhere at that same instant. */
export const depictedPersonElsewhere: Rule = {
  code: 'depicted_person_elsewhere',
  title: 'Person vist et andet sted',
  run: (snap) => {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const view of scenesOf(snap)) {
      if (view.dramatisedEvents.length === 0) continue;
      const pictured = view.anchors.filter((anchor) =>
        anchor.use === 'depicted' && anchor.targetKind === 'entity'
        && snap.entities.get(anchor.targetId)?.kind === 'person');
      for (const anchor of pictured) {
        for (const sceneEventId of view.dramatisedEvents) {
          const sceneEvent = snap.events.get(sceneEventId);
          const start = sceneEvent?.solvedEarliest ?? sceneEvent?.earliest;
          const latest = sceneEvent?.solvedLatest ?? sceneEvent?.latest ?? start;
          if (!sceneEvent?.placeId || start == null || latest !== start) continue;
          const sceneEnd = start + (sceneEvent.durationMin ?? 0);
          for (const occupation of snap.occupations) {
            if (occupation.entityId !== anchor.targetId || occupation.placeId === sceneEvent.placeId
              || !occupation.exclusive || occupation.sourceKind !== 'event'
              || view.dramatisedEvents.includes(occupation.eventId ?? '')
              || occupation.latest !== occupation.earliest
              || !sameLife(snap, occupation, {
                entityId: anchor.targetId, legId: occupation.legId,
                placeId: sceneEvent.placeId, realmId: sceneEvent.realmId, earliest: start, latest: start,
                duration: sceneEvent.durationMin ?? 0, label: '', exclusive: true,
                sourceKind: 'event', sourceId: sceneEventId,
              })) continue;
            const otherEnd = occupation.earliest + occupation.duration;
            const overlaps = sceneEnd === start
              ? occupation.earliest <= start && otherEnd >= start
              : Math.max(start, occupation.earliest) < Math.min(sceneEnd, otherEnd)
                || (occupation.duration === 0 && occupation.earliest >= start && occupation.earliest <= sceneEnd);
            if (!overlaps) continue;
            const key = fingerprint('depicted_person_elsewhere', view.row.id, anchor.id, occupation.sourceId);
            if (seen.has(key)) continue;
            seen.add(key);
            const lifted = snap.lifted({
              ruleCode: 'depicted_person_elsewhere', entityId: anchor.targetId,
              realmId: sceneEvent.realmId, at: start,
            });
            findings.push({
              ruleCode: 'depicted_person_elsewhere', severity: 'error',
              message: `${snap.name(anchor.targetId)} er vist i «${view.row.title ?? view.chapterTitle}» ved ${snap.name(sceneEvent.placeId)}, men ${occupation.label} placerer personen samtidig ved ${snap.name(occupation.placeId)}.`,
              subjects: {
                rows: [view.row.id, anchor.id, occupation.sourceId],
                entities: [anchor.targetId], places: [sceneEvent.placeId, occupation.placeId],
                events: [sceneEventId, occupation.eventId].filter((id): id is string => !!id),
              },
              fingerprint: key,
              ...(lifted ? { lifted } : {}),
            });
          }
        }
      }
    }
    return findings;
  },
};

/** An explicit textual claim about who holds an object, or what state it is in. */
export const depictedObjectClaimConflict: Rule = {
  code: 'prose_object_claim',
  title: 'Genstandspåstand i prosaen',
  run: (snap) => {
    const findings: Finding[] = [];
    const states = snap.store.db.select().from(entityState)
      .where(eq(entityState.branchId, snap.ctx.branchId)).all();
    for (const view of scenesOf(snap)) {
      const anchors = view.anchors.filter((anchor) =>
        anchor.targetKind === 'entity' && (anchor.use === 'held' || anchor.use === 'state'));
      for (const anchor of anchors) {
        for (const eventId of view.dramatisedEvents) {
          const happening = snap.events.get(eventId);
          const at = happening?.solvedEarliest ?? happening?.earliest;
          const latest = happening?.solvedLatest ?? happening?.latest ?? at;
          if (at == null || latest !== at) continue;

          if (anchor.use === 'held' && anchor.relatedEntityId) {
            for (const claim of snap.possessions) {
              if (claim.objectEntityId !== anchor.targetId || claim.holderEntityId === anchor.relatedEntityId) continue;
              if (claim.fromTime != null && claim.fromTime > at) continue;
              if (claim.toTime != null && claim.toTime <= at) continue;
              const key = fingerprint('prose_object_claim', 'held', view.row.id, anchor.id, claim.id);
              const lifted = snap.lifted({ ruleCode: 'prose_object_claim', entityId: anchor.targetId, at });
              findings.push({
                ruleCode: 'prose_object_claim', severity: 'warning',
                message: `I «${view.row.title ?? view.chapterTitle}» står der, at ${snap.name(anchor.relatedEntityId)} holder ${snap.name(anchor.targetId)}, men bibelen placerer genstanden hos ${snap.name(claim.holderEntityId)} på samme præcise tidspunkt.`,
                subjects: { rows: [view.row.id, anchor.id, claim.id], entities: [anchor.targetId, anchor.relatedEntityId, claim.holderEntityId], events: [eventId] },
                fingerprint: key, ...(lifted ? { lifted } : {}),
              });
            }
          }

          if (anchor.use === 'state' && anchor.stateCategory && anchor.stateValue) {
            for (const state of states) {
              if (state.entityId !== anchor.targetId || state.category !== anchor.stateCategory
                || state.value === anchor.stateValue) continue;
              if (state.fromTime != null && state.fromTime > at) continue;
              if (state.toTime != null && state.toTime <= at) continue;
              const key = fingerprint('prose_object_claim', 'state', view.row.id, anchor.id, state.id);
              const lifted = snap.lifted({ ruleCode: 'prose_object_claim', entityId: anchor.targetId, at });
              findings.push({
                ruleCode: 'prose_object_claim', severity: 'warning',
                message: `I «${view.row.title ?? view.chapterTitle}» beskrives ${snap.name(anchor.targetId)} som «${anchor.stateValue}», men bibelen siger «${state.value}» i tilstanden ${state.category} på samme præcise tidspunkt.`,
                subjects: { rows: [view.row.id, anchor.id, state.id], entities: [anchor.targetId], events: [eventId] },
                fingerprint: key, ...(lifted ? { lifted } : {}),
              });
            }
          }
        }
      }
    }
    return findings;
  },
};

export const mentionRules: Rule[] = [
  mentionAheadOfTime, mentionNameNotYet, mentionReaderAhead,
  depictedPersonElsewhere, depictedObjectClaimConflict,
];
