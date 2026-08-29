import { and, eq } from 'drizzle-orm';
import { chapter, entity, event, realm, scene, sceneEvent } from '../../db/schema';
import type { Store } from '../../db/client';
import type { Context } from '../workbench';

/**
 * The two axes side by side, and the threads between them.
 *
 * Chronology down one side, reading order down the other, one ribbon per
 * telling. Everything the tool is for is visible in the shape of those ribbons:
 * parallel ones are a book told in order, and every crossing is a flashback, a
 * foreshadowing or a piece of withheld information. Memento drawn this way is a
 * lattice, and that is not a bug in the picture.
 */

export interface BandEvent {
  eventId: string;
  title: string;
  from: number;
  fromLatest: number;
  certain: boolean;
  realmName: string;
  placeName: string | null;
  /** Position in chronological order, 1-based. The number in the Chapters table. */
  rank: number;
  /** 0..1 down the chronological axis, by rank rather than by clock. */
  y: number;
  /** True when no scene tells it: built, and never written. */
  untold: boolean;
}

export interface BandScene {
  sceneId: string;
  title: string;
  chapterId: string;
  chapterTitle: string;
  chapterPosition: number;
  povName: string | null;
  /** Position in reading order across the whole book, 1-based. */
  order: number;
  y: number;
  /** True when nothing it tells has been placed in time. */
  floating: boolean;
}

export interface BandRibbon {
  sceneId: string;
  eventId: string;
  mode: string;
  fromY: number;
  toY: number;
  /**
   * The reader has just been moved backwards in time relative to the previous
   * scene. This is the flashback marker, and counting them is how you see at a
   * glance whether the structure is what you thought it was.
   */
  backwards: boolean;
}

export function bandView(
  store: Store,
  ctx: Context,
  query: { workId: string },
): {
  events: BandEvent[];
  scenes: BandScene[];
  ribbons: BandRibbon[];
  stats: { told: number; untold: number; floating: number; backwards: number };
} {
  const { db } = store;

  const chapters = db.select().from(chapter)
    .where(and(eq(chapter.workId, query.workId), eq(chapter.branchId, ctx.branchId))).all()
    .sort((a, b) => a.position - b.position);
  const scenes = chapters.flatMap((c) =>
    db.select().from(scene).where(eq(scene.chapterId, c.id)).all()
      .filter((s) => s.branchId === ctx.branchId)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ row: s, chapter: c })));

  const links = db.select().from(sceneEvent)
    .where(eq(sceneEvent.branchId, ctx.branchId)).all()
    .filter((l) => scenes.some((s) => s.row.id === l.sceneId));

  /**
   * Every event in the world, not only the ones a scene tells -- the gap is the
   * point. An event with no ribbon is something you worked out and have not
   * written yet, and it is worth seeing next to the ones you have.
   */
  const all = db.select().from(event).where(eq(event.branchId, ctx.branchId)).all()
    .map((e) => ({ row: e, from: e.solvedEarliest ?? e.earliest }))
    .filter((e): e is { row: typeof event.$inferSelect; from: number } => e.from != null)
    .sort((a, b) => a.from - b.from);

  const spread = (index: number, count: number) => (count <= 1 ? 0.5 : index / (count - 1));

  const events: BandEvent[] = all.map((e, index) => ({
    eventId: e.row.id,
    title: e.row.title,
    from: e.from,
    fromLatest: e.row.solvedLatest ?? e.row.latest ?? e.from,
    certain: (e.row.solvedLatest ?? e.row.latest ?? e.from) === e.from,
    realmName: db.select().from(realm).where(eq(realm.id, e.row.realmId)).get()?.name ?? '',
    placeName: e.row.placeId
      ? db.select().from(entity).where(eq(entity.id, e.row.placeId)).get()?.name ?? null
      : null,
    rank: index + 1,
    y: spread(index, all.length),
    untold: !links.some((l) => l.eventId === e.row.id),
  }));
  const eventById = new Map(events.map((e) => [e.eventId, e]));

  const bandScenes: BandScene[] = scenes.map((s, index) => ({
    sceneId: s.row.id,
    title: s.row.title ?? s.chapter.title,
    chapterId: s.chapter.id,
    chapterTitle: s.chapter.title,
    chapterPosition: s.chapter.position,
    povName: s.row.povEntityId
      ? db.select().from(entity).where(eq(entity.id, s.row.povEntityId)).get()?.name ?? null
      : null,
    order: index + 1,
    y: spread(index, scenes.length),
    floating: !links.some((l) => l.sceneId === s.row.id && eventById.has(l.eventId)),
  }));
  const sceneById = new Map(bandScenes.map((s) => [s.sceneId, s]));

  /**
   * A jump is backwards when the earliest thing this scene tells happens before
   * the earliest thing the previous scene told. Comparing scene to scene rather
   * than ribbon to ribbon is what a reader actually experiences: they feel the
   * cut between two scenes, not the order of the rows underneath them.
   */
  const earliestRank = (sceneId: string): number | null => {
    const ranks = links.filter((l) => l.sceneId === sceneId)
      .map((l) => eventById.get(l.eventId)?.rank)
      .filter((r): r is number => r != null);
    return ranks.length ? Math.min(...ranks) : null;
  };

  const backwardScenes = new Set<string>();
  let previous: number | null = null;
  for (const s of bandScenes) {
    const rank = earliestRank(s.sceneId);
    if (rank == null) continue;
    if (previous != null && rank < previous) backwardScenes.add(s.sceneId);
    previous = rank;
  }

  const ribbons: BandRibbon[] = links.flatMap((l) => {
    const e = eventById.get(l.eventId);
    const s = sceneById.get(l.sceneId);
    if (!e || !s) return [];
    return [{
      sceneId: l.sceneId, eventId: l.eventId, mode: l.mode,
      fromY: e.y, toY: s.y, backwards: backwardScenes.has(l.sceneId),
    }];
  });

  return {
    events,
    scenes: bandScenes,
    ribbons,
    stats: {
      told: events.filter((e) => !e.untold).length,
      untold: events.filter((e) => e.untold).length,
      floating: bandScenes.filter((s) => s.floating).length,
      backwards: backwardScenes.size,
    },
  };
}
