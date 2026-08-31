import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  beat, chapter, part, reveal, scene, sceneEvent, sceneText, textAnchor, thread,
} from '../../db/schema';
import type { ThreadScope } from '../queries/order';
import type { Session } from '../changelog';
import type { Context } from '../workbench';

/** Appends at the end unless a position is given, which is what you nearly always want. */
function nextPosition(store: Store, tableName: string, parentColumn: string, parentId: string): number {
  const row = store.sqlite
    .prepare(`select max(position) as max from "${tableName}" where "${parentColumn}" = ?`)
    .get(parentId) as { max: number | null } | undefined;
  return (row?.max ?? 0) + 1;
}

export function createPart(
  session: Session, ctx: Context, store: Store,
  input: { workId: string; title: string; position?: number },
): string {
  return session.insert(part, {
    workId: input.workId, branchId: ctx.branchId, title: input.title,
    position: input.position ?? nextPosition(store, 'part', 'work_id', input.workId),
  })['id'] as string;
}

export function createChapter(
  session: Session, ctx: Context, store: Store,
  input: { workId: string; title: string; partId?: string; position?: number; summary?: string },
): string {
  return session.insert(chapter, {
    workId: input.workId, branchId: ctx.branchId, partId: input.partId ?? null,
    title: input.title, summary: input.summary ?? null,
    position: input.position ?? nextPosition(store, 'chapter', 'work_id', input.workId),
  })['id'] as string;
}

export function createScene(
  session: Session, ctx: Context, store: Store,
  input: {
    chapterId: string;
    title?: string;
    position?: number;
    povEntityId?: string;
    povLegId?: string;
    narrationPerson?: 'first' | 'second' | 'third_limited' | 'third_omniscient';
    narrationTense?: 'past' | 'present' | 'future';
    realmId?: string;
    summary?: string;
  },
): string {
  return session.insert(scene, {
    chapterId: input.chapterId, branchId: ctx.branchId,
    title: input.title ?? null,
    position: input.position ?? nextPosition(store, 'scene', 'chapter_id', input.chapterId),
    povEntityId: input.povEntityId ?? null, povLegId: input.povLegId ?? null,
    narrationPerson: input.narrationPerson ?? null,
    narrationTense: input.narrationTense ?? null,
    realmId: input.realmId ?? null, summary: input.summary ?? null,
  })['id'] as string;
}

/**
 * Which events a scene tells, and how.
 *
 * Many-to-many on purpose: one happening told twice from two points of view is
 * two rows. This table and `reveal` are where the two axes actually meet, and
 * the distance between them is every flashback and every piece of foreshadowing.
 */
export function linkSceneToEvent(
  session: Session, ctx: Context,
  input: {
    sceneId: string;
    eventId: string;
    mode?: 'dramatised' | 'mentioned' | 'implied';
    note?: string;
  },
): string {
  return session.insert(sceneEvent, {
    branchId: ctx.branchId, sceneId: input.sceneId, eventId: input.eventId,
    mode: input.mode ?? 'dramatised', note: input.note ?? null,
  })['id'] as string;
}

/**
 * When the *reader* learns something.
 *
 * Kept strictly apart from when a character learns it: the gap between the two
 * is dramatic irony, and the order of these against chapter order is what makes
 * a twist land or misfire. Naming a slot releases part of a fact -- the victim
 * in chapter two, the culprit in chapter thirty.
 */
export function createReveal(
  session: Session, ctx: Context,
  input: {
    factId: string;
    sceneId: string;
    slotId?: string;
    strength?: 'hinted' | 'implied' | 'stated' | 'confirmed';
    note?: string;
  },
): string {
  return session.insert(reveal, {
    branchId: ctx.branchId, factId: input.factId, sceneId: input.sceneId,
    slotId: input.slotId ?? null, strength: input.strength ?? 'stated',
    note: input.note ?? null,
  })['id'] as string;
}

/**
 * Saves prose, keeping the previous draft readable.
 *
 * The current text is one row among several; earlier ones stay so that "what
 * did chapter five say before I rewrote it" has an answer.
 */
export function saveSceneText(
  session: Session, ctx: Context, store: Store,
  input: { sceneId: string; doc: unknown; markdown?: string; label?: string },
): string {
  const existing = store.db.select().from(sceneText)
    .where(and(eq(sceneText.sceneId, input.sceneId), eq(sceneText.isCurrent, true))).all();
  for (const row of existing) session.update(sceneText, row.id, { isCurrent: false });

  const words = input.markdown ? input.markdown.trim().split(/\s+/).filter(Boolean).length : null;
  return session.insert(sceneText, {
    sceneId: input.sceneId, branchId: ctx.branchId,
    doc: input.doc, markdown: input.markdown ?? null, wordCount: words,
    isCurrent: true, label: input.label ?? null, createdAt: new Date(),
  })['id'] as string;
}

/**
 * Ties a stretch of prose to what it expresses.
 *
 * Anchored by a ProseMirror mark id, never a character offset: offsets do not
 * survive editing, and an anchor that drifts is worse than no anchor at all.
 */
export function createTextAnchor(
  session: Session, ctx: Context,
  input: {
    sceneId: string;
    markId: string;
    targetKind: 'event' | 'fact' | 'reveal' | 'belief' | 'beat' | 'entity'
      | 'identity' | 'scene' | 'thread';
    targetId: string;
    excerpt?: string;
  },
): string {
  return session.insert(textAnchor, {
    branchId: ctx.branchId, sceneId: input.sceneId, markId: input.markId,
    targetKind: input.targetKind, targetId: input.targetId,
    excerpt: input.excerpt ?? null,
  })['id'] as string;
}

/**
 * `workId` is the volume the thread begins in; `scope` is how far it reaches.
 * A thread left at `work` behaves exactly as it did before scope existed.
 */
export function createThread(
  session: Session, ctx: Context,
  input: { workId: string; name: string; summary?: string; scope?: ThreadScope },
): string {
  return session.insert(thread, {
    workId: input.workId, branchId: ctx.branchId,
    name: input.name, summary: input.summary ?? null, scope: input.scope ?? 'work',
  })['id'] as string;
}

export function createBeat(
  session: Session, ctx: Context,
  input: {
    threadId: string;
    kind: 'setup' | 'complication' | 'payoff';
    sceneId?: string;
    summary?: string;
    position?: number;
  },
): string {
  return session.insert(beat, {
    threadId: input.threadId, branchId: ctx.branchId, sceneId: input.sceneId ?? null,
    kind: input.kind, summary: input.summary ?? null, position: input.position ?? null,
  })['id'] as string;
}
