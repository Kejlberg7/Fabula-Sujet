import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  chapter, entity, event, participation, scene, sceneEvent, sceneText, series,
  source, sourceLink, textAnchor,
} from '../../db/schema';
import type { Context } from '../workbench';
import { readingOrder } from '../queries/order';
import { labelForTarget, type SourceTargetKind } from '../queries/sources';
import { formatInstant, type Precision } from '../time/gregorian';
import { SOURCE_KIND_DA, say } from '../words';
import {
  asProse, fromProse, heading, para, type Block, type Document, type Run,
} from './document';

/**
 * The book as a reader would get it.
 *
 * Everything the program knows about the book is apparatus: work ids, anchors,
 * margin notes, findings, the reveal ledger. None of it belongs in the text a
 * publisher or a first reader receives, and «none of it» has to be provable
 * rather than remembered -- so the prose goes out through `fromProse`, which
 * keeps the words and drops the marks, and nothing here ever touches the
 * anchor table on the way to the page.
 *
 * The appendix is the deliberate exception, and it is asked for: the people,
 * the places, the chronology and the research, printed after the story for the
 * writer's own use. It says nothing the book has not already told; it only
 * gathers it.
 */

export type ReadingTarget = { workId: string } | { seriesId: string };

/** What an appendix may hold. Nothing is included unless it is asked for. */
export type AppendixPart = 'people' | 'places' | 'timeline' | 'sources';

export interface ReadingOptions {
  /** Working titles are working titles. They stay out unless the writer wants them. */
  sceneTitles?: boolean;
  /** Marks scenes that have no prose yet, for a draft read-through. */
  gaps?: boolean;
  appendix?: AppendixPart[];
}

export interface ReadingStats {
  works: number;
  chapters: number;
  scenes: number;
  /** Scenes that actually have prose. The rest are still empty. */
  written: number;
  words: number;
}

export interface ReadingEdition {
  document: Document;
  stats: ReadingStats;
}

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

export function readingEdition(
  store: Store, ctx: Context, target: ReadingTarget, options: ReadingOptions = {},
): ReadingEdition {
  const { db } = store;
  const order = readingOrder(store, ctx);

  const books = 'seriesId' in target
    ? order.works.filter((row) => row.seriesId === target.seriesId)
    : order.works.filter((row) => row.id === target.workId);
  if (books.length === 0) {
    throw new Error('Der er ikke noget at eksportere: ingen bog i den gren passer på det, du bad om.');
  }

  const seriesRow = 'seriesId' in target
    ? db.select().from(series).where(eq(series.id, target.seriesId)).get()
    : null;
  if ('seriesId' in target && !seriesRow) throw new Error('Serien findes ikke.');

  const blocks: Block[] = [];
  const stats: ReadingStats = { works: books.length, chapters: 0, scenes: 0, written: 0, words: 0 };
  const sceneIds: string[] = [];
  const povIds = new Set<string>();
  // A series puts its volumes at the top level, so its chapters move one down.
  const depth = books.length > 1 ? 1 : 0;

  for (const book of books) {
    if (depth === 1) blocks.push(heading(1, book.title, true));

    const chapters = db.select().from(chapter)
      .where(and(eq(chapter.workId, book.id), eq(chapter.branchId, ctx.branchId)))
      .all().sort(byPosition);

    for (const ch of chapters) {
      stats.chapters += 1;
      // Every chapter opens a page. It is what a chapter is.
      blocks.push(heading(depth + 1, ch.title, true));

      const scenes = db.select().from(scene)
        .where(and(eq(scene.chapterId, ch.id), eq(scene.branchId, ctx.branchId)))
        .all().sort(byPosition);

      scenes.forEach((sc, index) => {
        stats.scenes += 1;
        sceneIds.push(sc.id);
        if (sc.povEntityId) povIds.add(sc.povEntityId);
        // A scene break is white space with a mark in it. The first scene of a
        // chapter follows a heading and needs none.
        if (index > 0) blocks.push({ kind: 'separator' });
        if (options.sceneTitles && sc.title) blocks.push(heading(depth + 2, sc.title));

        const written = db.select().from(sceneText).where(and(
          eq(sceneText.sceneId, sc.id),
          eq(sceneText.branchId, ctx.branchId),
          eq(sceneText.isCurrent, true),
        )).get();
        if (!written) {
          if (options.gaps) blocks.push(para('[Scenen er ikke skrevet endnu.]', 'note'));
          return;
        }
        stats.written += 1;
        stats.words += written.wordCount ?? 0;
        blocks.push(...asProse(fromProse(written.doc)));
      });
    }
  }

  if (options.appendix?.length) {
    blocks.push(...appendix(store, ctx, sceneIds, povIds, options.appendix));
  }

  // A volume says which series it is part of; a series has already said it.
  const subtitle = seriesRow ? null : books[0]!.seriesName;
  return {
    document: {
      title: seriesRow?.name ?? books[0]!.title,
      ...(subtitle ? { subtitle } : {}),
      createdAt: new Date(),
      blocks,
    },
    stats,
  };
}

/**
 * The apparatus, gathered after the story.
 *
 * Scoped to what the exported book actually brings on stage: the people who
 * take part in the events its scenes tell, the places those events happen in,
 * that chronology, and the research tied to any of it. A world-wide list would
 * be longer and less useful -- an appendix to volume two should not introduce
 * everyone volume five is going to need.
 */
function appendix(
  store: Store, ctx: Context, sceneIds: string[], povIds: Set<string>, parts: AppendixPart[],
): Block[] {
  const { db } = store;
  const scenes = new Set(sceneIds);
  const branch = eq(sceneEvent.branchId, ctx.branchId);

  const eventIds = new Set(db.select().from(sceneEvent).where(branch).all()
    .filter((row) => scenes.has(row.sceneId)).map((row) => row.eventId));
  const events = db.select().from(event)
    .where(and(eq(event.worldId, ctx.worldId), eq(event.branchId, ctx.branchId))).all()
    .filter((row) => eventIds.has(row.id))
    .sort((a, b) => (a.solvedEarliest ?? a.earliest ?? Infinity)
      - (b.solvedEarliest ?? b.earliest ?? Infinity));

  // Who and where: from the events the scenes tell, from the viewpoints they
  // are told through, and from what the prose itself points at.
  const named = new Set<string>(povIds);
  for (const row of db.select().from(participation)
    .where(eq(participation.branchId, ctx.branchId)).all()) {
    if (eventIds.has(row.eventId)) named.add(row.entityId);
  }
  for (const row of events) if (row.placeId) named.add(row.placeId);
  for (const row of db.select().from(textAnchor)
    .where(eq(textAnchor.branchId, ctx.branchId)).all()) {
    if (row.targetKind === 'entity' && scenes.has(row.sceneId)) named.add(row.targetId);
  }

  const entities = db.select().from(entity)
    .where(and(eq(entity.worldId, ctx.worldId), eq(entity.branchId, ctx.branchId))).all()
    .filter((row) => named.has(row.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'da'));

  const out: Block[] = [];
  const section = (title: string) => out.push(heading(1, title, true));
  const line = (name: string, tail: string | null): Block => ({
    kind: 'paragraph',
    runs: [{ text: name, bold: true }, ...(tail ? [{ text: ` — ${tail}` }] : [])] as Run[],
    style: 'plain',
  });

  if (parts.includes('people')) {
    section('Personer');
    const people = entities.filter((row) => row.kind === 'person');
    if (people.length === 0) out.push(para('Ingen personer er knyttet til de scener, der er med.', 'note'));
    for (const row of people) out.push(line(row.name, row.summary));
  }

  if (parts.includes('places')) {
    section('Steder');
    const places = entities.filter((row) => row.kind === 'place');
    if (places.length === 0) out.push(para('Ingen steder er knyttet til de scener, der er med.', 'note'));
    for (const row of places) out.push(line(row.name, row.summary));
  }

  if (parts.includes('timeline')) {
    section('Tidslinje');
    if (events.length === 0) out.push(para('Ingen events er knyttet til de scener, der er med.', 'note'));
    for (const row of events) out.push(line(when(row), row.title));
  }

  if (parts.includes('sources')) {
    section('Kilder');
    const targets = new Set<string>([
      ...[...scenes].map((id) => `scene:${id}`),
      ...[...eventIds].map((id) => `event:${id}`),
      ...[...named].map((id) => `entity:${id}`),
    ]);
    const links = db.select().from(sourceLink)
      .where(eq(sourceLink.branchId, ctx.branchId)).all()
      .filter((row) => targets.has(`${row.targetKind}:${row.targetId}`));
    const used = new Map<string, string[]>();
    for (const link of links) {
      const label = labelForTarget(store, link.targetKind as SourceTargetKind, link.targetId);
      used.set(link.sourceId, [...(used.get(link.sourceId) ?? []), label ?? '(slettet)']);
    }
    const rows = db.select().from(source).where(eq(source.worldId, ctx.worldId)).all()
      .filter((row) => used.has(row.id))
      .sort((a, b) => a.title.localeCompare(b.title, 'da'));
    if (rows.length === 0) out.push(para('Der er ikke knyttet kilder til det, der er med.', 'note'));
    for (const row of rows) {
      // The source is named and shown, never read: title, kind, where it is.
      const where = row.url ?? row.originalName ?? null;
      out.push(line(row.title, [say(SOURCE_KIND_DA, row.kind), where].filter(Boolean).join(', ')));
      out.push(para(`Ligger bag: ${[...new Set(used.get(row.id) ?? [])].join(', ')}`, 'note'));
    }
  }

  return out;
}

/** What the solver has narrowed the event down to, said the way a person would. */
function when(row: {
  solvedEarliest: number | null; solvedLatest: number | null;
  earliest: number | null; latest: number | null;
  precision: Precision;
}): string {
  const from = row.solvedEarliest ?? row.earliest;
  const to = row.solvedLatest ?? row.latest;
  // A vague date stays vague: the interval is printed as an interval, never
  // rounded to the one date that would read as a decision nobody made.
  if (from == null && to == null) return 'Uden fast tid';
  const grain = row.precision === 'unknown' ? 'day' : row.precision;
  const start = formatInstant((from ?? to)!, grain);
  if (from == null || to == null) return start;
  // Two ends of an interval that fall on the same day are one day. The
  // interval is still there; it is just not something to print twice.
  const end = formatInstant(to, grain);
  return start === end ? start : `${start} – ${end}`;
}
