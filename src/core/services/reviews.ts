import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  chapter, reviewRun, reviewScene, scene, sceneText, series, suggestion, work,
} from '../../db/schema';
import type { Session } from '../changelog';
import type { Context } from '../workbench';

/**
 * A read-through of the manuscript, bound to the prose it actually read.
 *
 * The review runs on a scope -- one scene, a chapter, a book, a whole series --
 * and writes down which `scene_text` version it saw in every scene it covered.
 * That is what lets it say later that eight of sixteen scenes have been
 * rewritten since, instead of presenting a months-old reading as if it were
 * about the words standing there now.
 *
 * Nothing here touches prose. A read-through reads and comments; the only path
 * from a proposed wording into the manuscript is the writer's click in the
 * editor (`applySuggestion`).
 */

export type ScopeKind = 'scene' | 'chapter' | 'work' | 'series';

export interface ScopedScene {
  sceneId: string;
  title: string | null;
  chapterTitle: string;
  workTitle: string;
  /** Reading order across the whole scope: series → book → chapter → scene. */
  position: number;
  /** The version standing right now. Null when nothing is written yet. */
  textId: string | null;
  wordCount: number | null;
}

/** The prose version standing in a scene at this moment, if any. */
export function currentText(store: Store, ctx: Context, sceneId: string) {
  return store.db.select().from(sceneText).where(and(
    eq(sceneText.sceneId, sceneId), eq(sceneText.branchId, ctx.branchId),
    eq(sceneText.isCurrent, true),
  )).get();
}

const byPosition = <T extends { position: number | null }>(a: T, b: T) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);

function worksOf(store: Store, ctx: Context, kind: ScopeKind, id: string) {
  const all = store.db.select().from(work).where(eq(work.branchId, ctx.branchId)).all();
  if (kind === 'series') return all.filter((item) => item.seriesId === id).sort(byPosition);
  const one = all.find((item) => item.id === id);
  return one ? [one] : [];
}

/** Every scene a scope covers, in reading order, with the version standing now. */
export function scenesInScope(
  store: Store, ctx: Context, input: { kind: ScopeKind; id: string },
): ScopedScene[] {
  const { db } = store;
  const rows: Omit<ScopedScene, 'position'>[] = [];

  const addChapter = (ch: typeof chapter.$inferSelect, workTitle: string, only?: string) => {
    const scenes = db.select().from(scene).where(and(
      eq(scene.chapterId, ch.id), eq(scene.branchId, ctx.branchId),
    )).all().sort((a, b) => a.position - b.position)
      .filter((sc) => !only || sc.id === only);
    for (const sc of scenes) {
      const text = currentText(store, ctx, sc.id);
      rows.push({
        sceneId: sc.id, title: sc.title, chapterTitle: ch.title, workTitle,
        textId: text?.id ?? null, wordCount: text?.wordCount ?? null,
      });
    }
  };

  if (input.kind === 'scene') {
    const sc = db.select().from(scene).where(and(
      eq(scene.id, input.id), eq(scene.branchId, ctx.branchId),
    )).get();
    if (!sc) return [];
    const ch = db.select().from(chapter).where(eq(chapter.id, sc.chapterId)).get();
    if (!ch) return [];
    const bog = db.select().from(work).where(eq(work.id, ch.workId)).get();
    addChapter(ch, bog?.title ?? '(ukendt bog)', sc.id);
  } else if (input.kind === 'chapter') {
    const ch = db.select().from(chapter).where(and(
      eq(chapter.id, input.id), eq(chapter.branchId, ctx.branchId),
    )).get();
    if (!ch) return [];
    const bog = db.select().from(work).where(eq(work.id, ch.workId)).get();
    addChapter(ch, bog?.title ?? '(ukendt bog)');
  } else {
    for (const bog of worksOf(store, ctx, input.kind, input.id)) {
      const chapters = db.select().from(chapter).where(and(
        eq(chapter.workId, bog.id), eq(chapter.branchId, ctx.branchId),
      )).all().sort((a, b) => a.position - b.position);
      for (const ch of chapters) addChapter(ch, bog.title);
    }
  }

  return rows.map((row, index) => ({ ...row, position: index + 1 }));
}

/** What the scope was called when it was read. Titles change; the record does not. */
function labelFor(store: Store, ctx: Context, kind: ScopeKind, id: string): string | null {
  const { db } = store;
  if (kind === 'scene') {
    const sc = db.select().from(scene).where(and(
      eq(scene.id, id), eq(scene.branchId, ctx.branchId),
    )).get();
    return sc ? (sc.title ?? '(scene uden titel)') : null;
  }
  if (kind === 'chapter') {
    const ch = db.select().from(chapter).where(and(
      eq(chapter.id, id), eq(chapter.branchId, ctx.branchId),
    )).get();
    return ch?.title ?? null;
  }
  if (kind === 'work') {
    const bog = db.select().from(work).where(and(
      eq(work.id, id), eq(work.branchId, ctx.branchId),
    )).get();
    return bog?.title ?? null;
  }
  return db.select().from(series).where(eq(series.id, id)).get()?.name ?? null;
}

export function startReviewRun(
  session: Session, ctx: Context, store: Store,
  input: { kind: ScopeKind; id: string },
): { runId: string; scopeLabel: string; scenes: ScopedScene[] } {
  const scopeLabel = labelFor(store, ctx, input.kind, input.id);
  if (!scopeLabel) throw new Error('Det omfang findes ikke i den aktive gren.');
  const scenes = scenesInScope(store, ctx, input);
  if (scenes.length === 0) {
    throw new Error('Der er ingen scener i det omfang, så der er ikke noget at læse igennem.');
  }

  const runId = session.insert(reviewRun, {
    branchId: ctx.branchId, scopeKind: input.kind, scopeId: input.id,
    scopeLabel, createdAt: new Date(),
  })['id'] as string;
  for (const item of scenes) {
    session.insert(reviewScene, {
      branchId: ctx.branchId, runId, sceneId: item.sceneId,
      textId: item.textId, position: item.position,
    });
  }
  return { runId, scopeLabel, scenes };
}

export function finishReviewRun(
  session: Session, ctx: Context, store: Store,
  input: { id: string; summary?: string },
): boolean {
  const row = store.db.select().from(reviewRun).where(and(
    eq(reviewRun.id, input.id), eq(reviewRun.branchId, ctx.branchId),
  )).get();
  if (!row) throw new Error('Den gennemlæsning findes ikke i den aktive gren.');
  if (row.finishedAt) throw new Error('Den gennemlæsning er allerede afsluttet.');
  session.update(reviewRun, row.id, {
    finishedAt: new Date(), summary: input.summary?.trim() || null,
  });
  return true;
}

export interface RunReport {
  id: string;
  scopeKind: ScopeKind;
  scopeId: string;
  scopeLabel: string;
  createdAt: Date;
  finishedAt: Date | null;
  summary: string | null;
  scenes: number;
  /** Scenes whose prose has been saved again since the run read them. */
  rewritten: number;
  notes: number;
  openNotes: number;
}

/** The read-throughs on this branch, newest first, and how much has moved since. */
export function reviewRuns(
  store: Store, ctx: Context, input: { limit?: number } = {},
): RunReport[] {
  const { db } = store;
  const runs = db.select().from(reviewRun)
    .where(eq(reviewRun.branchId, ctx.branchId)).all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, input.limit ?? 20);
  if (runs.length === 0) return [];

  const covered = db.select().from(reviewScene)
    .where(eq(reviewScene.branchId, ctx.branchId)).all();
  const notes = db.select().from(suggestion)
    .where(eq(suggestion.branchId, ctx.branchId)).all();
  const standing = new Map(db.select().from(sceneText)
    .where(eq(sceneText.branchId, ctx.branchId)).all()
    .filter((row) => row.isCurrent)
    .map((row) => [row.sceneId, row.id]));

  return runs.map((run) => {
    const mine = covered.filter((row) => row.runId === run.id);
    const written = notes.filter((row) => row.runId === run.id);
    return {
      id: run.id, scopeKind: run.scopeKind, scopeId: run.scopeId,
      scopeLabel: run.scopeLabel, createdAt: run.createdAt,
      finishedAt: run.finishedAt, summary: run.summary,
      scenes: mine.length,
      rewritten: mine.filter((row) => (standing.get(row.sceneId) ?? null) !== row.textId).length,
      notes: written.length,
      openNotes: written.filter((row) => row.status === 'open').length,
    };
  });
}
