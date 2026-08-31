import { eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  beat, chapter, entity, fact, participation, reveal, scene, sceneEvent, series,
  storyReference, textAnchor, thread, work,
} from '../../db/schema';
import { runRules } from '../rules';
import { readingOrder, type ThreadScope } from './order';
import { whatReaderKnows } from './reader';
import type { Context } from '../workbench';

export interface SeriesVolume {
  id: string;
  title: string;
  summary: string | null;
  chapters: number;
  scenes: number;
}

export interface RecurringPerson {
  id: string;
  name: string;
  kind: string;
  code: string | null;
  /** The volumes they turn up in, in reading order. Always two or more. */
  volumes: string[];
}

export interface SeriesThread {
  id: string;
  name: string;
  summary: string | null;
  scope: ThreadScope;
  /** The volume the thread begins in. */
  home: string;
  /** The volumes its beats actually fall in, in reading order. */
  volumes: string[];
  setups: number;
  payoffs: number;
}

export interface SeriesReveal {
  factId: string;
  summary: string;
  strength: string;
  volume: string;
  chapterTitle: string;
  sceneTitle: string;
  /** The earlier volume that already gave the reader this, when there is one. */
  carriedFrom: string | null;
}

export interface OpenSetup {
  threadId: string;
  threadName: string;
  message: string;
}

export interface SeriesOverview {
  id: string;
  name: string;
  summary: string | null;
  volumes: SeriesVolume[];
  people: RecurringPerson[];
  threads: SeriesThread[];
  reveals: SeriesReveal[];
  open: OpenSetup[];
}

/**
 * The series read as one thing.
 *
 * Everything here is already written down somewhere else; what the overview
 * adds is the one question no single volume can answer -- what carries across.
 * A person who only ever turns up in one book is not a recurring person, and a
 * thread that never leaves its volume is that volume's business.
 *
 * The boundary is the whole point. A world may hold several series, and they
 * inherit nothing from one another: the reader of this series has not read the
 * other one. So nothing here is gathered from the world; it is gathered from
 * the volumes of this series and no others.
 *
 * Reads only.
 */
export function seriesOverview(
  store: Store, ctx: Context, query: { seriesId: string },
): SeriesOverview | null {
  const { db } = store;
  const row = db.select().from(series).where(eq(series.id, query.seriesId)).get();
  if (!row || row.worldId !== ctx.worldId) return null;

  const order = readingOrder(store, ctx);
  const books = order.works.filter((item) => item.seriesId === row.id);
  const titleOf = new Map(books.map((item) => [item.id, item.title] as const));
  const mine = new Set(books.map((item) => item.id));

  const chapters = db.select().from(chapter).where(eq(chapter.branchId, ctx.branchId)).all()
    .filter((item) => mine.has(item.workId));
  const workOfChapter = new Map(chapters.map((item) => [item.id, item.workId] as const));
  const scenes = db.select().from(scene).where(eq(scene.branchId, ctx.branchId)).all()
    .filter((item) => workOfChapter.has(item.chapterId));
  const volumeOfScene = new Map(scenes.map((item) =>
    [item.id, workOfChapter.get(item.chapterId)!] as const));
  const sceneRows = new Map(scenes.map((item) => [item.id, item] as const));
  const chapterRows = new Map(chapters.map((item) => [item.id, item] as const));

  const volumes: SeriesVolume[] = books.map((item) => ({
    id: item.id,
    title: item.title,
    summary: db.select().from(work).where(eq(work.id, item.id)).get()?.summary ?? null,
    chapters: chapters.filter((ch) => ch.workId === item.id).length,
    scenes: scenes.filter((sc) => workOfChapter.get(sc.chapterId) === item.id).length,
  }));

  // ------------------------------------------------------------------ personer
  /**
   * Three ways a person is in a volume, and all three are the writer's own
   * marking: the volume tells an event they take part in, a scene is told from
   * their side, or the prose points at them. Nothing is guessed from a name.
   */
  const inVolumes = new Map<string, Set<string>>();
  const note = (entityId: string | null, workId: string | undefined) => {
    if (!entityId || !workId) return;
    const set = inVolumes.get(entityId) ?? new Set<string>();
    set.add(workId);
    inVolumes.set(entityId, set);
  };

  const eventScenes = new Map<string, string[]>();
  for (const link of db.select().from(sceneEvent)
    .where(eq(sceneEvent.branchId, ctx.branchId)).all()) {
    if (!volumeOfScene.has(link.sceneId)) continue;
    const list = eventScenes.get(link.eventId) ?? [];
    list.push(link.sceneId);
    eventScenes.set(link.eventId, list);
  }
  for (const part of db.select().from(participation)
    .where(eq(participation.branchId, ctx.branchId)).all()) {
    for (const sceneId of eventScenes.get(part.eventId) ?? []) {
      note(part.entityId, volumeOfScene.get(sceneId));
    }
  }
  for (const item of scenes) note(item.povEntityId, volumeOfScene.get(item.id));
  for (const anchor of db.select().from(textAnchor)
    .where(eq(textAnchor.branchId, ctx.branchId)).all()) {
    if (anchor.targetKind !== 'entity') continue;
    note(anchor.targetId, volumeOfScene.get(anchor.sceneId));
  }

  const codes = new Map(db.select().from(storyReference)
    .where(eq(storyReference.branchId, ctx.branchId)).all()
    .filter((item) => item.targetKind === 'entity')
    .map((item) => [item.targetId, item.code] as const));
  const entities = new Map(db.select().from(entity).all().map((item) => [item.id, item] as const));

  const people: RecurringPerson[] = [...inVolumes]
    .filter(([, set]) => set.size > 1)
    .map(([id, set]) => {
      const known = entities.get(id);
      return {
        id,
        name: known?.name ?? '(ukendt)',
        kind: known?.kind ?? 'person',
        code: codes.get(id) ?? null,
        volumes: books.filter((item) => set.has(item.id)).map((item) => item.title),
      };
    })
    .sort((a, b) => b.volumes.length - a.volumes.length || a.name.localeCompare(b.name, 'da'));

  // ------------------------------------------------------------------- tråde
  const threads = db.select().from(thread).where(eq(thread.branchId, ctx.branchId)).all()
    .filter((item) => books.some((book) => order.covers(item, book.id)));
  const beats = db.select().from(beat).where(eq(beat.branchId, ctx.branchId)).all();
  const threadRows: SeriesThread[] = threads.map((item) => {
    const own = beats.filter((b) => b.threadId === item.id);
    const touched = new Set(own
      .map((b) => (b.sceneId ? volumeOfScene.get(b.sceneId) : null))
      .filter((id): id is string => !!id));
    return {
      id: item.id,
      name: item.name,
      summary: item.summary,
      scope: item.scope,
      home: titleOf.get(item.workId) ?? '(uden for serien)',
      volumes: books.filter((book) => touched.has(book.id)).map((book) => book.title),
      setups: own.filter((b) => b.kind === 'setup').length,
      payoffs: own.filter((b) => b.kind === 'payoff').length,
    };
  }).sort((a, b) => b.volumes.length - a.volumes.length || a.name.localeCompare(b.name, 'da'));

  // -------------------------------------------------------------- afsløringer
  const facts = new Map(db.select().from(fact).where(eq(fact.branchId, ctx.branchId)).all()
    .map((item) => [item.id, item] as const));
  /** What each volume's reader walks in already holding, from the earlier ones. */
  const carried = new Map<string, Map<string, string | null>>();
  for (const book of books) {
    carried.set(book.id, new Map(
      whatReaderKnows(store, ctx, { workId: book.id, throughChapterPosition: 0 })
        .map((item) => [item.factId, item.fromEarlierWork] as const),
    ));
  }
  const reveals: SeriesReveal[] = db.select().from(reveal)
    .where(eq(reveal.branchId, ctx.branchId)).all()
    .filter((item) => volumeOfScene.has(item.sceneId))
    .sort((a, b) => (order.sceneRank(a.sceneId) ?? 0) - (order.sceneRank(b.sceneId) ?? 0))
    .map((item) => {
      const workId = volumeOfScene.get(item.sceneId)!;
      const sc = sceneRows.get(item.sceneId)!;
      const ch = chapterRows.get(sc.chapterId)!;
      return {
        factId: item.factId,
        summary: facts.get(item.factId)?.summary ?? '(ukendt påstand)',
        strength: item.strength,
        volume: titleOf.get(workId) ?? '(ukendt bind)',
        chapterTitle: ch.title,
        sceneTitle: sc.title ?? ch.title,
        carriedFrom: carried.get(workId)?.get(item.factId) ?? null,
      };
    });

  // ------------------------------------------------------------ uløste setups
  /**
   * The same rule the review runs, not a second opinion.
   *
   * It is asked once without a chosen book, so it sees every thread on the
   * branch, and the answers about other series are dropped here. A rule
   * rewritten for a panel is a rule that can disagree with itself.
   */
  const byThread = new Map(threads.map((item) => [item.id, item.name] as const));
  const open: OpenSetup[] = runRules(store, { ...ctx, workId: null }, ['dangling_setup'])
    .findings
    .map((finding) => ({ finding, threadId: (finding.subjects.rows ?? [])[0] ?? '' }))
    .filter(({ threadId }) => byThread.has(threadId))
    .map(({ finding, threadId }) => ({
      threadId,
      threadName: byThread.get(threadId)!,
      message: finding.message,
    }));

  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    volumes,
    people,
    threads: threadRows,
    reveals,
    open,
  };
}
