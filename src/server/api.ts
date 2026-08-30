import { and, desc, eq, sql } from 'drizzle-orm';
import type { Store } from '../db/client';
import {
  beat, belief, branch, change, chapter, disappearance, entity, entityLeg, entityState,
  event, eventFact, fact, identity, law, memoryPolicy, participation, possession, presence,
  realm, relationship, scene, sceneEvent, sceneText, series, temporalLink,
  textAnchor, thread, work, world,
} from '../db/schema';
import {
  history, markCheckpoint, redoLast, rollbackTo, undoLast, type Actor,
} from '../core/changelog';
import { bandView } from '../core/queries/band';
import { compareTwists, twistReadings } from '../core/queries/dramaturgy';
import { readBindings } from '../core/queries/bindings';
import { manuscriptPacket } from '../core/queries/manuscript';
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
  createEntity, createRelationship, recordDisappearance, recordEntityState,
} from '../core/services/entities';
import { createEvent } from '../core/services/events';
import {
  createBeat, createChapter, createReveal, createScene, createTextAnchor, createThread,
  linkSceneToEvent, saveSceneText,
} from '../core/services/narrative';
import { createSource, linkSource } from '../core/services/laws';
import { openFindings, review } from '../core/review';
import { RULES } from '../core/rules';
import { dismissFinding, revokeDismissal } from '../core/services/findings';
import {
  finishReviewRun, reviewRuns, scenesInScope, startReviewRun, type ScopeKind,
} from '../core/services/reviews';
import {
  applySuggestion, createSuggestion, decideSuggestion, suggestionsFor,
} from '../core/services/suggestions';
import { solveTime } from '../core/solve';
import { formatInstant, formatSpan } from '../core/time/gregorian';
import { Workbench } from '../core/workbench';
import {
  branchWorkspace, compareBranches, createBranchFromHistory, lineageRoot, moveChapter, moveReveal, moveScene, setBranchArchived, setDefaultBranch, workInBranch,
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
            id: w.id, title: w.title, summary: w.summary,
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
      const lines = db.select().from(thread).where(eq(thread.branchId, c.branchId)).all()
        .filter((row) => !c.workId || row.workId === c.workId);
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
            .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
            .map((item) => ({
              ...item, sceneName: item.sceneId ? sceneNames.get(item.sceneId) ?? '(ukendt)' : null,
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

    'continuity.thread.create': (input: { name: string; summary?: string; workId?: string }) =>
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
      return db.select().from(chapter)
        .where(eq(chapter.workId, workId)).all()
        .filter((ch) => ch.branchId === c.branchId)
        .sort((a, b) => a.position - b.position)
        .flatMap((ch) => db.select().from(scene).where(eq(scene.chapterId, ch.id)).all()
          .sort((a, b) => a.position - b.position)
          .map((s) => {
            const current = db.select().from(sceneText)
              .where(and(eq(sceneText.sceneId, s.id), eq(sceneText.isCurrent, true))).get();
            return {
              id: s.id, title: s.title ?? ch.title, position: s.position,
              chapterId: ch.id, chapterTitle: ch.title, chapterPosition: ch.position,
              pov: nameOf(s.povEntityId),
              wordCount: current?.wordCount ?? 0,
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
