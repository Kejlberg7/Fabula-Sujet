import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { chapter, scene, series, work } from '../../db/schema';
import type { Context } from '../workbench';

export type ThreadScope = 'work' | 'series' | 'world';

/** A book in reading order, with the series it belongs to. */
export interface WorkInOrder {
  id: string;
  title: string;
  seriesId: string | null;
  seriesName: string | null;
  /** Zero-based position in the whole branch's reading order. */
  index: number;
}

export interface ReadingOrder {
  /** Every book on the branch, series by series, in the order they are read. */
  works: WorkInOrder[];
  workRank(workId: string): number | null;
  chapterRank(chapterId: string): number | null;
  /** Series → book → chapter → scene, as one ascending number. */
  sceneRank(sceneId: string): number | null;
  /** The books a thread reaches, in reading order. */
  reach(line: { workId: string; scope: ThreadScope }): string[];
  covers(line: { workId: string; scope: ThreadScope }, workId: string): boolean;
}

/**
 * One order for the whole branch, so «before» and «after» mean the same thing
 * everywhere.
 *
 * Chapter positions restart at one in every volume, so a comparison that only
 * looked at chapter and scene would put volume two's first chapter before
 * volume one's second -- and a promise made in volume one would look unkept
 * even where volume two keeps it. Everything that has to say which of two
 * scenes the reader reaches first asks here.
 *
 * Books inside a series come in series order. Books belonging to no series
 * follow, ordered among themselves; nothing claims they are read in that order,
 * only that the order is the same every time it is asked for.
 */
export function readingOrder(store: Store, ctx: Context): ReadingOrder {
  const { db } = store;
  const allSeries = db.select().from(series).where(eq(series.worldId, ctx.worldId)).all();
  const seriesRank = new Map(
    [...allSeries]
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity)
        || a.name.localeCompare(b.name, 'da'))
      .map((row, i) => [row.id, i] as const),
  );
  const seriesName = new Map(allSeries.map((row) => [row.id, row.name] as const));

  const books = db.select().from(work).where(and(
    eq(work.worldId, ctx.worldId), eq(work.branchId, ctx.branchId),
  )).all().sort((a, b) =>
    (a.seriesId ? seriesRank.get(a.seriesId) ?? Infinity : Infinity)
      - (b.seriesId ? seriesRank.get(b.seriesId) ?? Infinity : Infinity)
    || (a.position ?? Infinity) - (b.position ?? Infinity)
    || a.title.localeCompare(b.title, 'da'));

  const works: WorkInOrder[] = books.map((row, index) => ({
    id: row.id, title: row.title, seriesId: row.seriesId,
    seriesName: row.seriesId ? seriesName.get(row.seriesId) ?? null : null,
    index,
  }));
  const workIndex = new Map(works.map((row) => [row.id, row.index] as const));
  const seriesOf = new Map(works.map((row) => [row.id, row.seriesId] as const));

  const chapters = db.select().from(chapter).where(eq(chapter.branchId, ctx.branchId)).all();
  const chapterRank = new Map(chapters.map((row) => [
    row.id, (workIndex.get(row.workId) ?? 0) * 1_000_000 + row.position * 1_000,
  ] as const));
  const scenes = db.select().from(scene).where(eq(scene.branchId, ctx.branchId)).all();
  const sceneRank = new Map(scenes.map((row) => [
    row.id, (chapterRank.get(row.chapterId) ?? 0) + row.position,
  ] as const));

  const reach = (line: { workId: string; scope: ThreadScope }): string[] => {
    if (line.scope === 'world') return works.map((row) => row.id);
    const home = seriesOf.get(line.workId) ?? null;
    if (line.scope === 'series' && home) {
      return works.filter((row) => row.seriesId === home).map((row) => row.id);
    }
    return [line.workId];
  };

  return {
    works,
    workRank: (id) => workIndex.get(id) ?? null,
    chapterRank: (id) => chapterRank.get(id) ?? null,
    sceneRank: (id) => sceneRank.get(id) ?? null,
    reach,
    covers: (line, workId) => reach(line).includes(workId),
  };
}
