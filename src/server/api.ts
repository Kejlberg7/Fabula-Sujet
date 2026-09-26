import { and, desc, eq, sql } from 'drizzle-orm';
import type { Store } from '../db/client';
import {
  beat, belief, branch, carrier, change, chapter, disappearance, entity, entityLeg, entityState,
  event, eventFact, fact, identity, law, memoryPolicy, participation, possession, presence,
  placeLink, realm, relationship, scene, sceneEvent, sceneText, series, statement, temporalLink,
  textAnchor, thread, work, world,
} from '../db/schema';
import {
  history, markCheckpoint, redoLast, rollbackTo, undoLast, type Actor,
} from '../core/changelog';
import {
  attachBytes, attachFile, checkAttachments, detachFile, orphanFiles,
} from '../core/attachments';
import { bandView } from '../core/queries/band';
import { compareTwists, twistReadings } from '../core/queries/dramaturgy';
import { readBindings } from '../core/queries/bindings';
import { manuscriptPacket } from '../core/queries/manuscript';
import { readingOrder, type ThreadScope } from '../core/queries/order';
import { seriesOverview } from '../core/queries/series';
import { proseGaps } from '../core/queries/proseGaps';
import { sourceShelf } from '../core/queries/sources';
import { knowledgeTrack } from '../core/queries/track';
import { whoKnewWhat } from '../core/queries/knowledge';
import { whoWasWhere, worldline } from '../core/queries/presence';
import { whatReaderKnows } from '../core/queries/reader';
import { referenceBacklinks, referenceCatalog } from '../core/queries/references';
import { find } from '../core/queries/search';
import { deleteRow, updateRow } from '../core/services/generic';
import {
  createEntity, createIdentity, createRelationship, recordDisappearance, recordEntityState,
  recordPossession, recordPresence, createPlaceLink,
} from '../core/services/entities';
import { addParticipation, addTemporalLink, createEvent, linkEventFact } from '../core/services/events';
import {
  createBeat, createChapter, createReveal, createScene, createTextAnchor, createThread,
  linkSceneToEvent, saveSceneText,
} from '../core/services/narrative';
import { createLaw, createSource, linkSource } from '../core/services/laws';
import { attachFactToCarrier, createFact, recordBelief, recordStatement } from '../core/services/knowledge';
import { openFindings, review } from '../core/review';
import { RULES } from '../core/rules';
import { dismissFinding, revokeDismissal } from '../core/services/findings';
import {
  finishReviewRun, reviewRuns, scenesInScope, startReviewRun, type ScopeKind,
} from '../core/services/reviews';
import {
  applySuggestion, createSuggestion, decideSuggestion, suggestionsFor,
} from '../core/services/suggestions';
import { backupBundle, backupJson, inspectBackup, restoreBackup } from '../core/export/backup';
import { toDocx } from '../core/export/docx';
import { toMarkdown } from '../core/export/markdown';
import { readingEdition, type AppendixPart } from '../core/export/reading';
import { solveTime } from '../core/solve';
import { formatInstant, formatSpan } from '../core/time/gregorian';
import { Workbench } from '../core/workbench';
import {
  branchWorkspace, compareBranches, createBranchFromHistory, lineageRoot, moveChapter, moveReveal, moveScene, setBranchArchived, setDefaultBranch, transferBranchDifference, workInBranch,
} from '../core/branches';

/**
 * The read and write surface the interface talks to.
 *
 * It sits on the same core the MCP tools use, so the two cannot drift: anything
 * the writer can say out loud, they can also click, and the other way round.
 *
 * Deliberately a plain object of typed functions rather than tRPC. There is one
 * consumer, one process and no need for batching, middleware or subscriptions --
 * `typeof createApi` gives end-to-end types on its own, and that is the whole
 * benefit tRPC would have bought here.
 */

const actor: Actor = { kind: 'user' };

/** A title is a title; a file name has to survive a file system. */
const fileName = (title: string) =>
  title.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 80) || 'bog';

export interface TimelineLane {
  id: string;
  name: string;
  kind: 'person' | 'place';
  itemCount: number;
}

export interface TimelineItem {
  id: string;
  laneId: string;
  kind: 'event' | 'presence';
  title: string;
  /** When it starts. The two differ when the time is vague, and that shows. */
  from: number;
  fromLatest: number;
  /** When it ends. */
  to: number;
  toLatest: number;
  certain: boolean;
  realmId: string;
  realmName: string;
  detail: string | null;
}

export function createApi(store: Store) {
  const bench = new Workbench(store);
  const { db } = store;

  const ctx = () => bench.context();
  const nameOf = (id: string | null): string | null =>
    id ? db.select().from(entity).where(eq(entity.id, id)).get()?.name ?? null : null;

  /** Story-time bounds of an event, preferring what the solver worked out. */
  const boundsOf = (e: typeof event.$inferSelect) => {
    const from = e.solvedEarliest ?? e.earliest;
    const fromLatest = e.solvedLatest ?? e.latest ?? from;
    const duration = e.durationMin ?? 0;
    return {
      from, fromLatest,
      to: from == null ? null : from + duration,
      toLatest: fromLatest == null ? null : fromLatest + (e.durationMax ?? duration),
    };
  };

  return {
    /**
     * A cheap heartbeat: what are we looking at, and has anything been written.
     *
     * The interface and the MCP surface share one context and one database, so
     * Claude can switch book or add a scene while the screen is open. Polling
     * this keeps the screen honest -- without it you sit looking at a page that
     * quietly stopped being true.
     */
    'pulse': () => {
      const current = bench.peek();
      const last = db.select({ seq: sql<number | null>`max(${change.seq})` }).from(change).get();
      return {
        worldId: current?.worldId ?? null,
        workId: current?.workId ?? null,
        branchId: current?.branchId ?? null,
        lastSeq: last?.seq ?? 0,
      };
    },

    /** Where we are, and everything you could switch to. */
    'context.get': () => {
      const current = bench.peek();
      const worlds = db.select().from(world).all()
        .map((w) => ({ id: w.id, name: w.name, summary: w.summary }));
      if (!current) return { active: null, worlds, works: [], branches: [], realms: [] };
      return {
        active: {
          ...current,
          worldName: bench.worldName(current.worldId),
          workTitle: current.workId
            ? db.select().from(work).where(eq(work.id, current.workId)).get()?.title ?? null
            : null,
          branchName: db.select().from(branch).where(eq(branch.id, current.branchId)).get()?.name ?? null,
        },
        worlds,
        works: db.select().from(work).where(eq(work.worldId, current.worldId)).all()
          .filter((w) => w.branchId === current.branchId)
          .map((w) => ({
            id: w.id, title: w.title, summary: w.summary, seriesId: w.seriesId,
            seriesName: w.seriesId
              ? db.select().from(series).where(eq(series.id, w.seriesId)).get()?.name ?? null
              : null,
          })),
        branches: db.select().from(branch).where(eq(branch.worldId, current.worldId)).all()
          .map((b) => ({
            id: b.id, name: b.name, isDefault: b.isDefault,
            archived: b.archivedAt != null, parentBranchId: b.parentBranchId,
            forkChangeSeq: b.forkChangeSeq,
          })),
        realms: db.select().from(realm).where(eq(realm.branchId, current.branchId)).all()
          .map((r) => ({
            id: r.id, name: r.name, kind: r.kind,
            parentRealmId: r.parentRealmId, timeRatio: r.timeRatioNum / r.timeRatioDen,
          })),
      };
    },

    'context.set': (input: { worldId: string; workId?: string | null; branchId?: string }) =>
      bench.setActive({
        worldId: input.worldId,
        workId: input.workId ?? undefined,
        branchId: input.branchId,
      }),

    /** The index: everything in the world, by kind, ready to scan. */
    'list.entities': (input: { kind?: string }) => {
      const c = ctx();
      return db.select().from(entity).where(eq(entity.branchId, c.branchId)).all()
        .filter((e) => !input.kind || e.kind === input.kind)
        .map((e) => ({
          id: e.id, name: e.name, kind: e.kind, summary: e.summary,
          legCount: db.select().from(entityLeg).where(eq(entityLeg.entityId, e.id)).all().length,
          appearances: db.select().from(participation)
            .where(eq(participation.entityId, e.id)).all().length,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'da'));
    },

    'list.events': () => {
      const c = ctx();
      return db.select().from(event).where(eq(event.branchId, c.branchId)).all()
        .map((e) => {
          const b = boundsOf(e);
          return {
            id: e.id, title: e.title, summary: e.summary,
            realmName: db.select().from(realm).where(eq(realm.id, e.realmId)).get()?.name ?? '',
            placeName: nameOf(e.placeId),
            from: b.from, fromLatest: b.fromLatest,
            certain: b.from != null && b.from === b.fromLatest,
            placed: b.from != null,
            when: b.from == null
              ? 'ikke placeret'
              : b.from === b.fromLatest
                ? formatInstant(b.from, e.precision === 'unknown' ? 'day' : e.precision)
                : `${formatInstant(b.from, 'day')} – ${formatInstant(b.fromLatest!, 'day')}`,
            participants: db.select().from(participation)
              .where(eq(participation.eventId, e.id)).all().length,
          };
        })
        .sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity));
    },

    'list.facts': () => {
      const c = ctx();
      return db.select().from(fact).where(eq(fact.branchId, c.branchId)).all()
        .map((f) => ({
          id: f.id, summary: f.summary, predicate: f.predicate, truth: f.truth,
          realmName: db.select().from(realm).where(eq(realm.id, f.realmId)).get()?.name ?? '',
          binds: readBindings(store, 'truth', f.id),
          believers: db.select().from(belief).where(eq(belief.factId, f.id)).all().length,
          beliefs: db.select().from(belief).where(eq(belief.factId, f.id)).all().map((b) => ({
            id: b.id, person: nameOf(b.entityId) ?? '(ukendt)', strength: b.strength, note: b.note,
          })),
          statements: db.select().from(statement).where(eq(statement.factId, f.id)).all().map((s) => ({
            id: s.id, speaker: nameOf(s.speakerEntityId) ?? '(ukendt)', truthful: s.truthful,
            audience: nameOf(s.audienceEntityId), note: s.note,
          })),
          carriers: db.select().from(carrier).where(eq(carrier.factId, f.id)).all().map((c) => ({
            id: c.id, object: nameOf(c.objectEntityId) ?? '(ukendt genstand)', accurate: c.accurate, note: c.note,
          })),
        }))
        .sort((a, b) => a.summary.localeCompare(b.summary, 'da'));
    },

    'list.laws': () => {
      const c = ctx();
      return db.select().from(law).where(eq(law.branchId, c.branchId)).all()
        .map((l) => ({
          id: l.id, kind: l.kind, hardness: l.hardness, ruleCode: l.ruleCode,
          statement: l.statement, scopeKind: l.scopeKind, enabled: l.enabled,
          subject: l.subjectEntityId ? nameOf(l.subjectEntityId) : l.subjectExpression,
        }));
    },

    'reference.list': () => referenceCatalog(store, ctx()),

    'reference.backlinks': (input: { targetKind: string; targetId: string }) =>
      referenceBacklinks(store, ctx(), input),

    /**
     * The deep continuity ledger in one read: state through time rather than
     * isolated facts. Sources are metadata only; this route never opens a file.
     */
    'continuity.get': () => {
      const c = ctx();
      const allEntities = db.select().from(entity).where(eq(entity.branchId, c.branchId)).all();
      const entityNames = new Map(allEntities.map((row) => [row.id, row.name]));
      const eventNames = new Map(db.select().from(event).where(eq(event.branchId, c.branchId)).all()
        .map((row) => [row.id, row.title]));
      const scenes = db.select().from(scene).where(eq(scene.branchId, c.branchId)).all();
      const sceneNames = new Map(scenes.map((row) => [row.id, row.title ?? '(uden titel)']));
      const states = db.select().from(entityState).where(eq(entityState.branchId, c.branchId)).all();
      const held = db.select().from(possession).where(eq(possession.branchId, c.branchId)).all();
      const identities = db.select().from(identity).where(eq(identity.branchId, c.branchId)).all();
      const relations = db.select().from(relationship).where(eq(relationship.branchId, c.branchId)).all();
      const absences = db.select().from(disappearance)
        .where(eq(disappearance.branchId, c.branchId)).all();
      const order = readingOrder(store, c);
      const lines = db.select().from(thread).where(eq(thread.branchId, c.branchId)).all()
        .filter((row) => !c.workId || order.covers(row, c.workId));
      // A thread reaching past its own volume needs to say which book each
      // beat sits in; otherwise «Brevet findes» and «Jens siger det» read as
      // two scenes in the same book.
      const workTitles = new Map(order.works.map((row) => [row.id, row.title] as const));
      const workOfChapter = new Map(db.select().from(chapter)
        .where(eq(chapter.branchId, c.branchId)).all()
        .map((row) => [row.id, row.workId] as const));
      const bookOfScene = new Map(scenes.map((row) =>
        [row.id, workTitles.get(workOfChapter.get(row.chapterId) ?? '') ?? null] as const));
      const shelf = sourceShelf(store, c);

      const when = (from: number | null, to: number | null) => {
        if (from == null && to == null) return 'hele tiden';
        if (from != null && to != null) return `${formatInstant(from, 'day')} – ${formatInstant(to, 'day')}`;
        return from != null ? `fra ${formatInstant(from, 'day')}` : `til ${formatInstant(to!, 'day')}`;
      };

      return {
        stats: {
          states: states.length, possessions: held.length, relationships: relations.length,
          identities: identities.length, disappearances: absences.length,
          threads: lines.length, sources: shelf.length,
        },
        objects: allEntities.filter((row) => row.kind === 'object').map((row) => ({
          id: row.id, name: row.name, summary: row.summary,
          states: states.filter((item) => item.entityId === row.id).map((item) => ({
            ...item, when: when(item.fromTime, item.toTime),
          })),
          possessions: held.filter((item) => item.objectEntityId === row.id).map((item) => ({
            ...item, holderName: entityNames.get(item.holderEntityId) ?? '(ukendt)',
            when: when(item.fromTime, item.toTime),
          })),
        })),
        relationships: relations.map((row) => ({
          ...row,
          fromName: entityNames.get(row.fromEntityId) ?? '(ukendt)',
          toName: entityNames.get(row.toEntityId) ?? '(ukendt)',
          when: when(row.fromTime, row.toTime),
        })),
        presences: db.select().from(presence).where(eq(presence.branchId, c.branchId)).all().map((row) => ({
          ...row,
          personName: entityNames.get(row.entityId) ?? '(ukendt person)',
          placeName: entityNames.get(row.placeId) ?? '(ukendt sted)',
          realmName: db.select().from(realm).where(eq(realm.id, row.realmId)).get()?.name ?? '(ukendt lag)',
          when: when(row.fromTime, row.toTime),
        })),
        placeLinks: db.select().from(placeLink).where(eq(placeLink.branchId, c.branchId)).all().map((row) => ({
          ...row,
          fromName: entityNames.get(row.fromPlaceId) ?? '(ukendt sted)',
          toName: entityNames.get(row.toPlaceId) ?? '(ukendt sted)',
          realmName: db.select().from(realm).where(eq(realm.id, row.realmId)).get()?.name ?? '(ukendt lag)',
        })),
        identities: identities.map((row) => ({
          ...row, entityName: entityNames.get(row.entityId) ?? '(ukendt)',
          when: when(row.validFrom, row.validTo),
        })),
        disappearances: absences.map((row) => ({
          ...row,
          entityName: entityNames.get(row.entityId) ?? '(ukendt)',
          disappearsEvent: eventNames.get(row.disappearsEventId) ?? '(ukendt)',
          returnsEvent: row.returnsEventId ? eventNames.get(row.returnsEventId) ?? '(ukendt)' : null,
        })),
        threads: lines.map((line) => ({
          ...line,
          beats: db.select().from(beat).where(eq(beat.threadId, line.id)).all()
            .filter((item) => item.branchId === c.branchId)
            // Reading order first: a series thread's beats live in two books,
            // and a manual position only ever ordered them inside one.
            .sort((a, b) =>
              ((a.sceneId ? order.sceneRank(a.sceneId) : null) ?? Infinity)
              - ((b.sceneId ? order.sceneRank(b.sceneId) : null) ?? Infinity)
              || (a.position ?? Infinity) - (b.position ?? Infinity))
            .map((item) => ({
              ...item, sceneName: item.sceneId ? sceneNames.get(item.sceneId) ?? '(ukendt)' : null,
              workTitle: item.sceneId ? bookOfScene.get(item.sceneId) ?? null : null,
            })),
        })),
        // Hylden er den samme her og i gennemgangspakken. Da den fandtes to
        // steder, kunne de to steder svare forskelligt på, hvad en henvisning
        // peger på — og et opslag, der siger et id, er ikke et svar.
        sources: shelf,
      };
    },

    'list.chapters': (input: { workId?: string }) => {
      const c = ctx();
      const workId = input.workId ?? c.workId;
      if (!workId) return [];
      return db.select().from(chapter).where(eq(chapter.workId, workId)).all()
        .sort((a, b) => a.position - b.position)
        .map((ch) => ({
          id: ch.id, title: ch.title, position: ch.position, summary: ch.summary,
          scenes: db.select().from(scene).where(eq(scene.chapterId, ch.id)).all()
            .sort((a, b) => a.position - b.position)
            .map((s) => ({
              id: s.id, title: s.title, position: s.position,
              pov: nameOf(s.povEntityId),
              events: db.select().from(sceneEvent).where(eq(sceneEvent.sceneId, s.id)).all()
                .map((se) => {
                  const ev = db.select().from(event).where(eq(event.id, se.eventId)).get();
                  return {
                    id: se.eventId, title: ev?.title ?? '(ukendt)',
                    mode: se.mode, from: ev ? boundsOf(ev).from : null,
                  };
                }),
            })),
        }));
    },

    'entity.get': (input: { id: string }) => {
      const c = ctx();
      const row = db.select().from(entity).where(eq(entity.id, input.id)).get();
      if (!row) throw new Error('Findes ikke.');
      const knowledge = row.kind === 'person'
        ? whoKnewWhat(store, c, { entityId: row.id })
        : null;
      return {
        ...row,
        legs: worldline(store, c, row.id).map((l) => ({
          ...l,
          worldFrom: l.worldStart == null ? null : formatInstant(l.worldStart, 'day'),
          worldTo: l.worldEnd == null ? null : formatInstant(l.worldEnd, 'day'),
        })),
        presences: whoWasWhere(store, c, { entityId: row.id }),
        participations: db.select().from(participation)
          .where(eq(participation.entityId, row.id)).all()
          .map((p) => {
            const ev = db.select().from(event).where(eq(event.id, p.eventId)).get();
            return {
              id: p.id, role: p.role, eventId: p.eventId,
              eventTitle: ev?.title ?? '(ukendt)',
              from: ev ? boundsOf(ev).from : null,
            };
          })
          .sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity)),
        knows: knowledge?.items ?? [],
        /**
         * Which moment -- and, for someone with more than one leg, which stretch
         * of whose life -- the knowledge above is the answer for. Saying "she
         * knows nothing" without saying which self is asking would be a lie.
         */
        knownAt: knowledge?.at ?? null,
        knownLeg: knowledge?.legId
          ? worldline(store, c, row.id).find((l) => l.id === knowledge.legId) ?? null
          : null,
        memoryPolicies: row.kind === 'person'
          ? db.select().from(memoryPolicy)
              .where(and(eq(memoryPolicy.entityId, row.id), eq(memoryPolicy.branchId, c.branchId)))
              .all()
              .sort((a, b) => (a.fromPersonal ?? -Infinity) - (b.fromPersonal ?? -Infinity))
          : [],
      };
    },

    'event.get': (input: { id: string }) => {
      const c = ctx();
      const row = db.select().from(event).where(eq(event.id, input.id)).get();
      if (!row) throw new Error('Findes ikke.');
      const b = boundsOf(row);
      return {
        ...row,
        bounds: b,
        realmName: db.select().from(realm).where(eq(realm.id, row.realmId)).get()?.name ?? '',
        placeName: nameOf(row.placeId),
        duration: row.durationMin == null ? null : formatSpan(row.durationMin),
        participants: db.select().from(participation)
          .where(eq(participation.eventId, row.id)).all()
          .map((p) => ({
            id: p.id, role: p.role, entityId: p.entityId,
            name: nameOf(p.entityId) ?? '(ukendt)',
            absorbs: p.absorbsKnowledge,
          })),
        exposes: db.select().from(eventFact)
          .where(eq(eventFact.eventId, row.id)).all()
          .map((ef) => ({
            id: ef.id, factId: ef.factId, exposes: ef.exposes,
            summary: db.select().from(fact).where(eq(fact.id, ef.factId)).get()?.summary ?? '',
          })),
        links: db.select().from(temporalLink).where(eq(temporalLink.branchId, c.branchId)).all()
          .filter((l) => l.fromEventId === row.id || l.toEventId === row.id)
          .map((l) => ({
            id: l.id, kind: l.kind, axis: l.axis,
            offset: l.offsetMin == null ? null : formatSpan(l.offsetMin),
            otherId: l.fromEventId === row.id ? l.toEventId : l.fromEventId,
            otherTitle: db.select().from(event)
              .where(eq(event.id, l.fromEventId === row.id ? l.toEventId : l.fromEventId))
              .get()?.title ?? '(ukendt)',
            outgoing: l.fromEventId === row.id,
          })),
        scenes: db.select().from(sceneEvent).where(eq(sceneEvent.eventId, row.id)).all()
          .map((se) => {
            const sc = db.select().from(scene).where(eq(scene.id, se.sceneId)).get();
            const ch = sc ? db.select().from(chapter).where(eq(chapter.id, sc.chapterId)).get() : undefined;
            return {
              sceneId: se.sceneId, mode: se.mode,
              sceneTitle: sc?.title ?? '(uden titel)',
              chapterTitle: ch?.title ?? '',
              chapterPosition: ch?.position ?? 0,
            };
          })
          .sort((a, b) => a.chapterPosition - b.chapterPosition),
      };
    },

    /**
     * The chronology, in lanes.
     *
     * Vague events are drawn as the range they could occupy rather than snapped
     * to a point. That is the one thing the picture must not lie about: half of
     * what a writer knows is "sometime that spring", and a timeline that renders
     * it as a firm Tuesday is worse than no timeline.
     */
    'timeline.get': (input: { by?: 'person' | 'place'; realmId?: string }) => {
      const c = ctx();
      const by = input.by ?? 'person';
      const events = db.select().from(event).where(eq(event.branchId, c.branchId)).all()
        .filter((e) => !input.realmId || e.realmId === input.realmId);
      const realmName = (id: string) =>
        db.select().from(realm).where(eq(realm.id, id)).get()?.name ?? '';

      const lanes = new Map<string, TimelineLane>();
      const items: TimelineItem[] = [];
      const addLane = (id: string, name: string, kind: 'person' | 'place') => {
        if (!lanes.has(id)) lanes.set(id, { id, name, kind, itemCount: 0 });
        lanes.get(id)!.itemCount += 1;
      };

      for (const e of events) {
        const b = boundsOf(e);
        if (b.from == null) continue;
        const base = {
          kind: 'event' as const, title: e.title,
          from: b.from, fromLatest: b.fromLatest ?? b.from,
          to: b.to ?? b.from, toLatest: b.toLatest ?? b.fromLatest ?? b.from,
          certain: b.from === b.fromLatest,
          realmId: e.realmId, realmName: realmName(e.realmId),
        };
        if (by === 'person') {
          const parts = db.select().from(participation).where(eq(participation.eventId, e.id)).all();
          for (const p of parts) {
            const name = nameOf(p.entityId);
            if (!name) continue;
            addLane(p.entityId, name, 'person');
            items.push({ ...base, id: `${e.id}:${p.id}`, laneId: p.entityId, detail: p.role });
          }
        } else if (e.placeId) {
          const name = nameOf(e.placeId);
          if (!name) continue;
          addLane(e.placeId, name, 'place');
          items.push({ ...base, id: e.id, laneId: e.placeId, detail: null });
        }
      }

      if (by === 'person') {
        for (const p of db.select().from(presence).where(eq(presence.branchId, c.branchId)).all()) {
          if (input.realmId && p.realmId !== input.realmId) continue;
          if (p.fromTime == null) continue;
          const name = nameOf(p.entityId);
          const where = nameOf(p.placeId);
          if (!name) continue;
          addLane(p.entityId, name, 'person');
          items.push({
            id: p.id, laneId: p.entityId, kind: 'presence',
            title: where ?? 'et sted',
            from: p.fromTime, fromLatest: p.fromTime,
            to: p.toTime ?? p.fromTime, toLatest: p.toTime ?? p.fromTime,
            certain: true, realmId: p.realmId, realmName: realmName(p.realmId),
            detail: null,
          });
        }
      }

      const all = items.flatMap((i) => [i.from, i.toLatest]);
      return {
        lanes: [...lanes.values()].sort((a, b) => b.itemCount - a.itemCount),
        items,
        span: all.length
          ? { from: Math.min(...all), to: Math.max(...all) }
          : { from: null, to: null },
      };
    },

    'reader.knows': (input: { throughChapter: number; workId?: string }) => {
      const c = ctx();
      const workId = input.workId ?? c.workId;
      if (!workId) return [];
      return whatReaderKnows(store, c, { workId, throughChapterPosition: input.throughChapter });
    },

    'knows.get': (input: { entityId: string; at?: number }) =>
      whoKnewWhat(store, ctx(), { entityId: input.entityId, at: input.at }),

    'search': (input: { q: string }) => (input.q.trim() ? find(store, ctx(), input.q) : []),

    'history.list': (input: { limit?: number }) => {
      const c = ctx();
      return history(db, c.branchId, input.limit ?? 40).map((h) => ({
        ...h,
        startedAt: h.startedAt.getTime(),
        who: h.actorKind === 'assistant' ? 'Claude' : h.actorKind === 'user' ? 'Dig' : 'Systemet',
      }));
    },

    'history.undo': () => ({ turnId: undoLast(store, ctx().branchId, actor) }),
    'history.redo': () => ({ turnId: redoLast(store, ctx().branchId, actor) }),
    'history.rollback': (input: { seq: number }) =>
      ({ undone: rollbackTo(store, ctx().branchId, input.seq, actor) }),
    'history.checkpoint': (input: { label: string }) =>
      ({ id: markCheckpoint(db, ctx().branchId, input.label) }),

    /** Independent narrative roads, all retaining their common lineage. */
    'branch.workspace': () => branchWorkspace(store, ctx()),

    'branch.create': (input: { name: string; seq?: number }) => {
      const c = ctx();
      const latest = db.select({ max: sql<number | null>`max(${change.seq})` }).from(change)
        .where(eq(change.branchId, c.branchId)).get()?.max ?? 0;
      const created = createBranchFromHistory(store, {
        sourceBranchId: c.branchId,
        sourceWorkId: c.workId,
        name: input.name,
        changeSeq: input.seq ?? latest,
        actor,
      });
      bench.setActive({
        worldId: c.worldId,
        branchId: created.branchId,
        workId: created.workId,
      });
      return created;
    },

    'branch.compare': (input: { otherBranchId: string }) => {
      const c = ctx();
      if (!c.workId) throw new Error('Der er ikke valgt en bog.');
      return compareBranches(store, {
        leftBranchId: c.branchId,
        rightBranchId: input.otherBranchId,
        workId: c.workId,
      });
    },

    'branch.transfer': (input: { otherBranchId: string; differenceId: string }) => {
      const c = ctx();
      if (!c.workId) throw new Error('Der er ikke valgt en bog.');
      return bench.run({ actor, summary: 'Overfør ændring fra alternativ' }, (session) =>
        transferBranchDifference(session, store, {
          leftBranchId: c.branchId,
          rightBranchId: input.otherBranchId,
          workId: c.workId!,
          differenceId: input.differenceId,
        }));
    },

    'branch.choose': (input: { branchId: string }) => {
      const c = ctx();
      setDefaultBranch(store, input.branchId, actor);
      const next = bench.setActive({ worldId: c.worldId, branchId: input.branchId });
      return { branchId: next.branchId, workId: next.workId };
    },

    'branch.archive': (input: { branchId: string }) => {
      const c = ctx();
      if (input.branchId === c.branchId) {
        throw new Error('Skift til en anden gren, før du arkiverer denne.');
      }
      return bench.run({ actor, summary: 'Arkivér gren' }, (session) => {
        setBranchArchived(session, store, input.branchId, true);
        return { archived: true };
      });
    },

    'branch.reopen': (input: { branchId: string }) =>
      bench.run({ actor, summary: 'Genåbn gren' }, (session) => {
        setBranchArchived(session, store, input.branchId, false);
        return { archived: false };
      }),

    'branch.chapter.move': (input: { chapterId: string; toIndex: number }) =>
      bench.run({ actor, summary: 'Flyt kapitel' }, (session, c) => {
        moveChapter(session, store, c, input.chapterId, input.toIndex);
        return { moved: true };
      }),

    'branch.scene.move': (input: {
      sceneId: string; targetChapterId: string; toIndex: number;
    }) => bench.run({ actor, summary: 'Flyt scene' }, (session, c) => {
      moveScene(session, store, c, input);
      return { moved: true };
    }),

    'branch.reveal.move': (input: {
      revealId: string; sceneId: string;
      strength?: 'hinted' | 'implied' | 'stated' | 'confirmed';
    }) => bench.run({ actor, summary: 'Flyt afsløring' }, (session, c) => {
      moveReveal(session, store, c, input);
      return { moved: true };
    }),

    'row.update': (input: { table: string; id: string; patch: Record<string, unknown> }) =>
      bench.run({ actor, summary: `Ret ${input.table}` }, (session) =>
        updateRow(session, store, input)),

    'row.delete': (input: { table: string; id: string }) =>
      bench.run({ actor, summary: `Slet ${input.table}` }, (session) => {
        deleteRow(session, store, input);
        return { deleted: true };
      }),

    'row.delete.preview': (input: { table: string; id: string }) => {
      const target = store.sqlite.prepare('select name from sqlite_master where type = ? and name = ?')
        .get('table', input.table) as { name: string } | undefined;
      if (!target || input.table === 'sqlite_sequence') throw new Error('Posten findes ikke.');
      const parent = store.sqlite.prepare(`select * from "${target.name}" where id = ?`)
        .get(input.id) as Record<string, unknown> | undefined;
      if (!parent) throw new Error('Posten findes ikke længere.');
      const dependencies: { kind: string; label: string; relation: string }[] = [];
      const tables = store.sqlite.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[];
      const tableLabels: Record<string, string> = {
        entity: 'person, sted eller ting', event: 'event', fact: 'faktum', scene: 'scene',
        chapter: 'kapitel', work: 'bog', realm: 'fortællingslag', law: 'lov',
        thread: 'plottråd', source: 'kilde', identity: 'identitet',
        participation: 'deltagelse i event', presence: 'ophold', possession: 'besiddelse',
        relationship: 'relation', belief: 'overbevisning', statement: 'udsagn',
        carrier: 'viden på genstand', reveal: 'afsløring', beat: 'plotslag',
        scene_event: 'scene, der fortæller eventet', temporal_link: 'tidsbånd',
        source_link: 'kildehenvisning', text_anchor: 'omtale i prosa',
        story_reference: 'arbejdsreference', event_fact: 'faktum knyttet til event',
      };
      const seen = new Set<string>();
      const addDependency = (childTable: string, row: Record<string, unknown>, relation: string) => {
        const preferred = ['name', 'title', 'summary', 'statement', 'value', 'kind', 'predicate', 'code', 'note', 'quote'];
        const title = preferred.map((field) => row[field]).find((value) =>
          typeof value === 'string' && value.trim().length > 0) as string | undefined;
        const key = `${childTable}:${String(row['id'] ?? title ?? '')}:${relation}`;
        if (seen.has(key)) return;
        seen.add(key);
        dependencies.push({
          kind: tableLabels[childTable] ?? childTable.replaceAll('_', ' '),
          label: title ?? 'post uden titel', relation,
        });
      };
      for (const child of tables) {
        if (child.name.startsWith('sqlite_') || child.name === input.table) continue;
        const foreignKeys = store.sqlite.prepare(`pragma foreign_key_list("${child.name}")`).all() as
          { table: string; from: string; to: string }[];
        for (const key of foreignKeys.filter((item) => item.table === input.table && item.to === 'id')) {
          const rows = store.sqlite.prepare(`select * from "${child.name}" where "${key.from}" = ?`)
            .all(input.id) as Record<string, unknown>[];
          for (const row of rows) {
            addDependency(child.name, row, key.from.replaceAll('_', ' '));
          }
        }
        const columns = new Set((store.sqlite.prepare(`pragma table_info("${child.name}")`).all() as { name: string }[]).map((column) => column.name));
        if (columns.has('target_id') && columns.has('target_kind')) {
          const rows = store.sqlite.prepare(`select * from "${child.name}" where target_id = ? and target_kind = ?`)
            .all(input.id, input.table) as Record<string, unknown>[];
          for (const row of rows) addDependency(child.name, row, 'polymorfisk reference');
        }
        if (columns.has('owner_id') && columns.has('owner_kind')) {
          const ownerKind = input.table === 'fact' ? 'truth' : input.table;
          const rows = store.sqlite.prepare(`select * from "${child.name}" where owner_id = ? and owner_kind = ?`)
            .all(input.id, ownerKind) as Record<string, unknown>[];
          for (const row of rows) addDependency(child.name, row, 'indhold knyttet til posten');
        }
        if (child.name === 'event_fact' && input.table === 'fact') {
          const rows = store.sqlite.prepare('select * from event_fact where fact_id = ?').all(input.id) as Record<string, unknown>[];
          for (const row of rows) addDependency(child.name, row, 'event, der bruger faktummet');
        }
      }
      return { dependencies, canDelete: dependencies.length === 0 };
    },

    'fact.create': (input: {
      predicate: string; summary: string; realmId: string;
      truth?: 'true' | 'false' | 'disputed' | 'undecided';
      slots: { name: string; valueKind: 'entity' | 'time' | 'place' | 'text' | 'number' }[];
    }) => bench.run({ actor, summary: `Faktum: ${input.summary}` }, (session, c) =>
      createFact(session, c, input)),

    'belief.create': (input: {
      entityId: string; factId: string;
      strength: 'knows' | 'convinced' | 'suspects' | 'mistaken' | 'denies' | 'unaware';
      note?: string;
    }) => bench.run({ actor, summary: 'Registrer viden eller tro' }, (session, c) =>
      ({ id: recordBelief(session, c, input) })),

    'statement.create': (input: {
      speakerEntityId: string; factId: string; truthful?: boolean;
      audienceEntityId?: string; eventId?: string; note?: string;
    }) => bench.run({ actor, summary: 'Registrer udsagn' }, (session, c) =>
      ({ id: recordStatement(session, c, input) })),

    'carrier.create': (input: {
      objectEntityId: string; factId: string; accurate?: boolean; note?: string;
    }) => bench.run({ actor, summary: 'Lad en genstand bære et faktum' }, (session, c) =>
      ({ id: attachFactToCarrier(session, c, input) })),

    'law.create': (input: {
      kind: 'ability' | 'prohibition'; hardness: 'hard' | 'soft'; statement: string;
      ruleCode?: string; scopeKind?: 'world' | 'series' | 'work' | 'realm'; scopeId?: string;
      subjectKind?: 'everyone' | 'entity' | 'entity_kind' | 'carrier_holder';
      subjectEntityId?: string; subjectExpression?: string;
    }) => bench.run({ actor, summary: `Lov: ${input.statement}` }, (session, c) =>
      ({ id: createLaw(session, c, input) })),

    'identity.create': (input: {
      entityId: string; name: string; note?: string; validFrom?: number; validTo?: number;
    }) => bench.run({ actor, summary: `Identitet: ${input.name}` }, (session, c) =>
      ({ id: createIdentity(session, c, input) })),

    'possession.create': (input: {
      holderEntityId: string; objectEntityId: string; note?: string;
      fromTime?: number; toTime?: number;
    }) => bench.run({ actor, summary: 'Registrer besiddelse' }, (session, c) =>
      ({ id: recordPossession(session, c, input) })),

    'presence.create': (input: {
      entityId: string; placeId: string; realmId: string;
      fromTime?: number; toTime?: number; note?: string;
    }) => bench.run({ actor, summary: 'Registrer tilstedeværelse' }, (session, c) =>
      ({ id: recordPresence(session, c, input) })),

    'place-link.create': (input: {
      realmId: string; fromPlaceId: string; toPlaceId: string; mode: string;
      travelMin?: number; travelMax?: number; bidirectional?: boolean; note?: string;
    }) => bench.run({ actor, summary: 'Rejseforbindelse' }, (session, c) =>
      ({ id: createPlaceLink(session, c, input) })),

    'participation.create': (input: {
      eventId: string; entityId: string;
      role: 'actor' | 'witness' | 'victim' | 'present_unaware' | 'mentioned'; note?: string;
    }) => bench.run({ actor, summary: 'Knyt person til event' }, (session, c) =>
      ({ id: addParticipation(session, c, input) })),

    'event.fact.create': (input: {
      eventId: string; factId: string;
      exposes?: 'establishes' | 'reveals' | 'evidences'; note?: string;
    }) => bench.run({ actor, summary: 'Knyt faktum til event' }, (session, c) =>
      ({ id: linkEventFact(session, c, input) })),

    'temporal.create': (input: {
      fromEventId: string; toEventId: string;
      kind: 'before' | 'after' | 'same_time' | 'offset' | 'during';
      axis?: 'world' | 'personal'; offsetMin?: number; offsetMax?: number; note?: string;
    }) => bench.run({ actor, summary: 'Knyt tidsbånd' }, (session, c) =>
      ({ id: addTemporalLink(session, c, input) })),

    'entity.create': (input: {
      name: string;
      kind: 'person' | 'place' | 'object' | 'organisation' | 'concept';
      summary?: string;
    }) => bench.run({ actor, summary: `Opret ${input.kind}: ${input.name}` }, (session, c) =>
      ({ id: createEntity(session, c, input) })),

    'event.create': (input: {
      title: string; realmId: string; summary?: string; earliest?: number; latest?: number;
    }) => bench.run({ actor, summary: `Event: ${input.title}` }, (session, c) =>
      ({ id: createEvent(session, c, input) })),

    'continuity.state.create': (input: {
      entityId: string; category: string; value: string;
      fromTime?: number; toTime?: number; note?: string;
    }) => bench.run({ actor, summary: `Tilstand: ${input.value}` }, (session, c) =>
      ({ id: recordEntityState(session, store, c, input) })),

    'continuity.relationship.create': (input: {
      fromEntityId: string; toEntityId: string; kind: string; category?: string;
      symmetric?: boolean; fromTime?: number; toTime?: number; note?: string;
    }) => bench.run({ actor, summary: `Relation: ${input.kind}` }, (session, c) =>
      ({ id: createRelationship(session, c, input) })),

    'continuity.disappearance.create': (input: {
      entityId: string; disappearsEventId: string; returnsEventId?: string; note?: string;
    }) => bench.run({ actor, summary: 'Registrer forsvinding' }, (session, c) =>
      ({ id: recordDisappearance(session, c, input) })),

    'continuity.thread.create': (input: {
      name: string; summary?: string; workId?: string; scope?: ThreadScope;
    }) =>
      bench.run({ actor, summary: `Plottråd: ${input.name}` }, (session, c) => {
        const workId = input.workId ?? c.workId;
        if (!workId) throw new Error('Der er ikke valgt en bog.');
        return { id: createThread(session, c, { ...input, workId }) };
      }),

    'continuity.beat.create': (input: {
      threadId: string; kind: 'setup' | 'complication' | 'payoff';
      sceneId?: string; summary?: string; position?: number;
    }) => bench.run({ actor, summary: `Plotslag: ${input.kind}` }, (session, c) =>
      ({ id: createBeat(session, c, input) })),

    'source.create': (input: {
      title: string; kind: 'note' | 'link' | 'pdf' | 'article' | 'image' | 'file';
      url?: string; filePath?: string; mimeType?: string; byteSize?: number; note?: string;
    }) => bench.run({ actor, summary: `Kilde: ${input.title}` }, (session, c) =>
      ({ id: createSource(session, c, input) })),

    'source.link': (input: {
      sourceId: string; targetKind: 'fact' | 'law' | 'event' | 'entity' | 'scene' | 'work';
      targetId: string; relation?: 'supports' | 'context' | 'conflicts';
      quote?: string; note?: string;
    }) => bench.run({ actor, summary: 'Knyt kilde' }, (session, c) =>
      ({ id: linkSource(session, c, input) })),

    /** Everything saved as research, and what each item is actually holding up. */
    'source.shelf': () => sourceShelf(store, ctx()),

    /**
     * Filing a file the writer picked in the interface.
     *
     * The bytes arrive base64-encoded in the same JSON body as everything
     * else. A multipart upload would be the tidier shape and would need its
     * own route, its own parser and its own error path, for one file at a
     * time on a machine that is already holding the whole thing in memory.
     */
    'source.attach': (input: { sourceId: string; name: string; base64: string }) =>
      bench.run({ actor, summary: 'Vedhæft fil' }, (session, c) =>
        attachBytes(store, session, c, {
          sourceId: input.sourceId, name: input.name,
          bytes: Buffer.from(input.base64, 'base64'),
        })),

    /** The same, for a file already lying on this machine. */
    'source.attachPath': (input: { sourceId: string; path: string }) =>
      bench.run({ actor, summary: 'Vedhæft fil' }, (session, c) =>
        attachFile(store, session, c, input)),

    /**
     * Letting go of the file, and -- only when asked -- deleting it.
     *
     * Two decisions in one call, but never by accident: `removeFile` is set by
     * a second confirmation in the interface, because `rm` has no undo.
     */
    'source.detach': (input: { sourceId: string; removeFile?: boolean }) =>
      bench.run({ actor, summary: 'Fjern fil fra kilde' }, (session, c) =>
        detachFile(store, session, c, input)),

    /** The thorough check: every file read back and compared with what was filed. */
    'source.check': () => ({
      files: checkAttachments(store, ctx()),
      orphans: orphanFiles(store),
    }),

    /**
     * The book, as a file the writer can hand to someone else.
     *
     * The bytes come back base64 in the ordinary JSON answer, the same way an
     * attachment goes the other way. The interface makes a Blob of it and
     * hands it to the browser: no download route, no temporary file on the
     * server, and nothing left lying around afterwards.
     */
    'export.reading': (input: {
      workId?: string; seriesId?: string;
      format?: 'markdown' | 'docx';
      sceneTitles?: boolean; gaps?: boolean; appendix?: AppendixPart[];
    }) => {
      const c = ctx();
      const target = input.seriesId
        ? { seriesId: input.seriesId }
        : { workId: input.workId ?? c.workId ?? '' };
      const { document, stats } = readingEdition(store, c, target, {
        sceneTitles: input.sceneTitles, gaps: input.gaps, appendix: input.appendix,
      });
      const docx = input.format === 'docx';
      const bytes = docx ? toDocx(document) : Buffer.from(toMarkdown(document), 'utf8');
      return {
        name: `${fileName(document.title)}.${docx ? 'docx' : 'md'}`,
        mimeType: docx
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'text/markdown',
        base64: bytes.toString('base64'),
        stats,
      };
    },

    /** Everything, in one file: the rows, and -- unless asked otherwise -- the files. */
    'export.backup': (input: { withFiles?: boolean } | undefined) => {
      const withFiles = input?.withFiles !== false;
      const stamp = new Date().toISOString().slice(0, 10);
      const made = withFiles ? backupBundle(store) : null;
      const bytes = made ? made.bytes : backupJson(store);
      return {
        name: `fabula-backup-${stamp}.${withFiles ? 'zip' : 'json'}`,
        mimeType: withFiles ? 'application/zip' : 'application/json',
        base64: bytes.toString('base64'),
        rows: made?.rows ?? null,
        files: made?.files ?? 0,
        missing: made?.missing ?? [],
      };
    },

    /** What is in the file, before anything happens to this database. */
    'backup.inspect': (input: { base64: string }) =>
      inspectBackup(store, Buffer.from(input.base64, 'base64')),

    /**
     * And then the writer says yes.
     *
     * Only into an empty database, which is also why this is the one call in
     * here that does not go through the change log: it restores the log. The
     * refusal is the guard, and it comes from the core rather than from here.
     */
    'backup.restore': (input: { base64: string; allowOtherSchema?: boolean }) =>
      restoreBackup(store, Buffer.from(input.base64, 'base64'), {
        allowOtherSchema: input.allowOtherSchema,
      }),

    /**
     * The writing desk: one scene, its prose, and the two answers that stop a
     * draft -- what the viewpoint character knows here, and what the reader
     * knows by now.
     */
    'desk.get': (input: { sceneId: string }) => manuscriptPacket(store, ctx(), input.sceneId),

    'suggestion.list': (input: {
      sceneId?: string; status?: 'open' | 'accepted' | 'rejected';
    }) => suggestionsFor(store, ctx(), input),

    'suggestion.create': (input: {
      sceneId: string; markId?: string;
      kind: 'continuity' | 'craft' | 'pacing' | 'research';
      message: string; proposedText?: string; sourceId?: string; runId?: string;
    }) => bench.run({ actor, summary: 'Tilføj margennote' }, (session, c) =>
      ({ id: createSuggestion(session, c, input, store) })),

    /**
     * The read-through: a review bound to the prose it actually read.
     *
     * Reading and commenting only. A run records which version of every scene
     * it saw, so a months-old reading cannot pass itself off as being about
     * what stands there now.
     */
    'review.scope': (input: { kind: ScopeKind; id: string }) =>
      scenesInScope(store, ctx(), input),

    'review.runs': (input: { limit?: number }) => reviewRuns(store, ctx(), input ?? {}),

    /** Names standing in the prose that no mention answers for. Reads only. */
    'review.gaps': (input: { kind: ScopeKind; id: string }) =>
      proseGaps(store, ctx(), input),

    'review.start': (input: { kind: ScopeKind; id: string }) =>
      bench.run({ actor, summary: 'Start gennemlæsning' }, (session, c) =>
        startReviewRun(session, c, store, input)),

    'review.finish': (input: { id: string; summary?: string }) =>
      bench.run({ actor, summary: 'Afslut gennemlæsning' }, (session, c) =>
        ({ finished: finishReviewRun(session, c, store, input) })),

    'suggestion.decide': (input: {
      id: string; status: 'open' | 'accepted' | 'rejected';
    }) => bench.run({ actor, summary: 'Afgør margennote' }, (session, c) =>
      ({ updated: decideSuggestion(session, c, store, input) })),

    /**
     * The yes, and the only way a proposed wording reaches the manuscript.
     *
     * Deliberately here and not among the MCP tools: the editor sends the
     * document it already put the sentence into, so the writer has seen the
     * change before this is called. Prose and stamp go in one turn, so a single
     * undo takes back both.
     */
    'suggestion.apply': (input: { id: string; doc: unknown; markdown: string }) =>
      bench.run({ actor, summary: 'Skriv margennote ind' }, (session, c) =>
        applySuggestion(session, c, store, input)),

    /** Every scene in reading order, for walking the book from the desk. */
    'scene.list': (input: { workId?: string }) => {
      const c = ctx();
      const workId = input.workId ?? c.workId;
      if (!workId) return [];
      // The scene list is also the desk's map. A reference hidden twenty
      // scenes down is no example at all, so show the codes beside every scene
      // that already contains one. The catalogue is sorted; keeping the first
      // code also keeps merged aliases from turning one mention into a row of
      // badges.
      const codeByTarget = new Map<string, string>();
      for (const ref of referenceCatalog(store, c)) {
        const key = `${ref.targetKind}:${ref.targetId}`;
        if (!codeByTarget.has(key)) codeByTarget.set(key, ref.code);
      }
      const anchorsByScene = new Map<string, typeof textAnchor.$inferSelect[]>();
      for (const anchor of db.select().from(textAnchor)
        .where(eq(textAnchor.branchId, c.branchId)).all()) {
        const rows = anchorsByScene.get(anchor.sceneId) ?? [];
        rows.push(anchor);
        anchorsByScene.set(anchor.sceneId, rows);
      }
      return db.select().from(chapter)
        .where(eq(chapter.workId, workId)).all()
        .filter((ch) => ch.branchId === c.branchId)
        .sort((a, b) => a.position - b.position)
        .flatMap((ch) => db.select().from(scene).where(eq(scene.chapterId, ch.id)).all()
          .sort((a, b) => a.position - b.position)
          .map((s) => {
            const current = db.select().from(sceneText)
              .where(and(eq(sceneText.sceneId, s.id), eq(sceneText.isCurrent, true))).get();
            const anchors = anchorsByScene.get(s.id) ?? [];
            const referenceCodes = [...new Set(anchors.map((anchor) =>
              codeByTarget.get(`${anchor.targetKind}:${anchor.targetId}`))
              .filter((code): code is string => !!code))];
            return {
              id: s.id, title: s.title ?? ch.title, position: s.position,
              chapterId: ch.id, chapterTitle: ch.title, chapterPosition: ch.position,
              pov: nameOf(s.povEntityId),
              wordCount: current?.wordCount ?? 0,
              anchorCount: anchors.length,
              referenceCodes,
            };
          }));
    },

    /**
     * The writer's own prose, saved from the writer's own editor.
     *
     * The rule that nothing touches the prose without a yes is about the review
     * and about Claude, not about the person typing. Each save keeps the last
     * draft readable rather than overwriting it.
     */
    'desk.saveProse': (input: {
      sceneId: string; doc: unknown; markdown?: string; label?: string;
    }) => bench.run({ actor, summary: 'Gem scenetekst' }, (session, c) =>
      ({ id: saveSceneText(session, c, store, input) })),

    /**
     * Ties a stretch of prose to what it expresses.
     *
     * By mark id, never by character offset: offsets do not survive the next
     * edit, and an anchor that has drifted is worse than no anchor at all.
     */
    'anchor.create': (input: {
      sceneId: string;
      markId: string;
      targetKind: 'event' | 'fact' | 'reveal' | 'belief' | 'beat' | 'entity'
        | 'identity' | 'scene' | 'thread';
      targetId: string;
      excerpt?: string;
      use?: 'depicted' | 'mentioned' | 'held' | 'state';
      relatedEntityId?: string; stateCategory?: string; stateValue?: string;
    }) => bench.run({ actor, summary: 'Sæt tekstanker' }, (session, c) =>
      ({ id: createTextAnchor(session, c, input) })),

    /** Anchors whose mark is gone from the document, cleared in one turn. */
    'anchor.prune': (input: { sceneId: string; markIds: string[] }) =>
      bench.run({ actor, summary: 'Ryd forladte tekstankre' }, (session) => {
        const rows = db.select().from(textAnchor)
          .where(eq(textAnchor.sceneId, input.sceneId)).all()
          .filter((a) => !input.markIds.includes(a.markId));
        for (const row of rows) session.remove(textAnchor, row.id);
        return { removed: rows.length };
      }),

    'chapter.create': (input: { title: string; workId?: string; summary?: string }) =>
      bench.run({ actor, summary: `Kapitel: ${input.title}` }, (session, c) => {
        const workId = input.workId ?? c.workId;
        if (!workId) throw new Error('Der er ikke valgt en bog.');
        return { id: createChapter(session, c, store, { ...input, workId }) };
      }),

    'scene.create': (input: {
      chapterId: string; title?: string; povEntityId?: string; realmId?: string;
      narrationPerson?: 'first' | 'second' | 'third_limited' | 'third_omniscient';
      narrationTense?: 'past' | 'present' | 'future';
    }) => bench.run({ actor, summary: `Scene: ${input.title ?? 'uden titel'}` }, (session, c) =>
      ({ id: createScene(session, c, store, input) })),

    'scene.linkEvent': (input: {
      sceneId: string; eventId: string; mode?: 'dramatised' | 'mentioned' | 'implied';
    }) => bench.run({ actor, summary: 'Knyt scene til event' }, (session, c) =>
      ({ id: linkSceneToEvent(session, c, input) })),

    'reveal.create': (input: {
      sceneId: string; factId: string; slotId?: string;
      strength?: 'hinted' | 'implied' | 'stated' | 'confirmed';
    }) => bench.run({ actor, summary: 'Afsløring' }, (session, c) =>
      ({ id: createReveal(session, c, input) })),

    /**
     * Chronology down one side, reading order down the other, a ribbon per
     * telling. Every crossing is a flashback or a piece of foreshadowing.
     */
    'band.get': (input: { workId?: string }) => {
      const c = ctx();
      const workId = input.workId ?? c.workId;
      if (!workId) return null;
      return bandView(store, c, { workId });
    },

    /** Where a person's knowledge changes, on their own clock. */
    'knows.track': (input: { entityId: string; legId?: string }) =>
      knowledgeTrack(store, ctx(), input),

    /**
     * One pass over everything: solve the time, run the rules, write down what
     * came out. This is the button the whole consistency layer exists behind.
     */
    'review.run': (input: { only?: string[] }) => review(store, ctx(), input.only),

    /** What stands right now, without running anything. */
    'review.list': () => openFindings(store, ctx()),

    /** The rules there are, so the screen can name them rather than show codes. */
    'review.rules': () => RULES.map((r) => ({ code: r.code, title: r.title })),

    /**
     * "Yes, he was there -- but he lies about it later, that is the point."
     *
     * Unlike the findings, this is a person deciding something, so it goes
     * through the change log and is one undo away like everything else.
     */
    'review.dismiss': (input: { fingerprint: string; reason: string }) =>
      bench.run({ actor, summary: 'Afvis fund' }, (session, c) =>
        ({ id: dismissFinding(session, c, store, input) })),

    'review.undismiss': (input: { fingerprint: string }) =>
      bench.run({ actor, summary: 'Tag afvisning tilbage' }, (session, c) =>
        ({ revoked: revokeDismissal(session, c, store, input) })),

    /**
     * How well the reveals actually work -- the craft question, not the
     * possibility question. No score: each reading names the scenes it came
     * from, because that is the part a writer can act on.
     */
    /**
     * The series read as one thing. Null when the chosen book stands alone --
     * a single volume is not a series, and pretending otherwise would put an
     * empty panel in front of the writer.
     */
    'series.overview': (input: { seriesId?: string }) => {
      const c = ctx();
      const seriesId = input?.seriesId
        ?? (c.workId ? db.select().from(work).where(eq(work.id, c.workId)).get()?.seriesId : null);
      if (!seriesId) return null;
      return seriesOverview(store, c, { seriesId });
    },

    'twist.list': (input: { workId?: string }) => {
      const c = ctx();
      const workId = input.workId ?? c.workId;
      if (!workId) return [];
      return twistReadings(store, c, { workId });
    },

    /** The same reveals read on two branches: which axes moved, and how. */
    'twist.compare': (input: { otherBranchId: string; workId?: string }) => {
      const c = ctx();
      const workId = input.workId ?? c.workId;
      if (!workId) return [];
      const otherWorkId = workInBranch(store, workId, input.otherBranchId);
      if (!otherWorkId) throw new Error('Bogen findes ikke på den anden gren.');
      return compareTwists(store, {
        here: c, hereWorkId: workId,
        there: { ...c, branchId: input.otherBranchId }, thereWorkId: otherWorkId,
        lineage: (table, id) => lineageRoot(store, table, id),
      });
    },

    'solve': () => {
      const report = solveTime(store, ctx());
      return {
        updated: report.updated,
        iterations: report.iterations,
        findings: report.findings.map((f) => ({
          ruleCode: f.ruleCode, severity: f.severity, message: f.message,
          events: (f.subjects.events ?? []).map((id) => ({
            id, title: db.select().from(event).where(eq(event.id, id)).get()?.title ?? id,
          })),
        })),
      };
    },

    /** The individual writes behind a turn, for when the summary is not enough. */
    'changes.list': (input: { turnId?: string; limit?: number }) => {
      const c = ctx();
      return db.select().from(change)
        .where(input.turnId ? eq(change.turnId, input.turnId) : eq(change.branchId, c.branchId))
        .orderBy(desc(change.seq)).limit(input.limit ?? 50).all()
        .map((ch) => ({
          seq: ch.seq, op: ch.op, table: ch.tableName, rowId: ch.rowId,
          undone: ch.undoneAt != null,
          label: (ch.after as { name?: string; title?: string; summary?: string } | null)?.name
            ?? (ch.after as { title?: string } | null)?.title
            ?? (ch.before as { name?: string } | null)?.name
            ?? null,
        }));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
export type ApiRoute = keyof Api;
