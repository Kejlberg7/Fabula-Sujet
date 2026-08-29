import { and, eq, inArray } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { chapter, fact, factSlot, reveal, scene } from '../../db/schema';
import type { Context } from '../workbench';

export interface ReaderFact {
  factId: string;
  summary: string;
  /** Slot names released so far. Empty means the whole fact was given at once. */
  slots: string[];
  /** Whether every slot has now been released. */
  complete: boolean;
  strength: string;
  firstChapter: number;
  firstChapterTitle: string;
}

/**
 * What the reader knows by the end of a chapter.
 *
 * This is the other half of `whoKnewWhat`, and the distance between the two is
 * the dramatic irony. A fact may be released a slot at a time -- the victim in
 * chapter two, the culprit in chapter thirty -- so what comes back is not
 * "known / not known" but how much of it has been handed over.
 */
export function whatReaderKnows(
  store: Store,
  ctx: Context,
  query: { workId: string; throughChapterPosition: number },
): ReaderFact[] {
  const { db } = store;
  const chapters = db.select().from(chapter)
    .where(and(eq(chapter.workId, query.workId), eq(chapter.branchId, ctx.branchId))).all()
    .filter((c) => c.position <= query.throughChapterPosition)
    .sort((a, b) => a.position - b.position);
  if (chapters.length === 0) return [];

  const scenes = db.select().from(scene)
    .where(inArray(scene.chapterId, chapters.map((c) => c.id))).all();
  if (scenes.length === 0) return [];

  const sceneChapter = new Map(scenes.map((s) => [s.id, chapters.find((c) => c.id === s.chapterId)!]));
  const reveals = db.select().from(reveal)
    .where(and(eq(reveal.branchId, ctx.branchId), inArray(reveal.sceneId, scenes.map((s) => s.id))))
    .all();

  const byFact = new Map<string, ReaderFact & { slotIds: Set<string> }>();
  for (const r of reveals) {
    const ch = sceneChapter.get(r.sceneId)!;
    let entry = byFact.get(r.factId);
    if (!entry) {
      const f = db.select().from(fact).where(eq(fact.id, r.factId)).get();
      entry = {
        factId: r.factId,
        summary: f?.summary ?? '(ukendt faktum)',
        slots: [], complete: false, strength: r.strength,
        firstChapter: ch.position, firstChapterTitle: ch.title,
        slotIds: new Set<string>(),
      };
      byFact.set(r.factId, entry);
    }
    if (ch.position < entry.firstChapter) {
      entry.firstChapter = ch.position;
      entry.firstChapterTitle = ch.title;
    }
    // The strongest disclosure so far is what the reader is left holding.
    const order = ['hinted', 'implied', 'stated', 'confirmed'];
    if (order.indexOf(r.strength) > order.indexOf(entry.strength)) entry.strength = r.strength;
    if (r.slotId) entry.slotIds.add(r.slotId);
    else entry.complete = true;
  }

  return [...byFact.values()].map((entry) => {
    const all = db.select().from(factSlot).where(eq(factSlot.factId, entry.factId)).all();
    const named = all.filter((s) => entry.slotIds.has(s.id)).map((s) => s.name);
    return {
      factId: entry.factId,
      summary: entry.summary,
      slots: named,
      complete: entry.complete || (all.length > 0 && named.length === all.length),
      strength: entry.strength,
      firstChapter: entry.firstChapter,
      firstChapterTitle: entry.firstChapterTitle,
    };
  }).sort((a, b) => a.firstChapter - b.firstChapter);
}
