import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { suggestion } from '../../db/schema';
import type { Session } from '../changelog';
import type { Context } from '../workbench';

export function createSuggestion(
  session: Session,
  ctx: Context,
  input: {
    sceneId: string;
    markId?: string;
    kind: 'continuity' | 'craft' | 'pacing' | 'research';
    message: string;
    proposedText?: string;
    sourceId?: string;
  },
): string {
  if (!input.message.trim()) throw new Error('En margennote skal sige noget.');
  return session.insert(suggestion, {
    branchId: ctx.branchId, sceneId: input.sceneId, markId: input.markId ?? null,
    kind: input.kind, message: input.message.trim(),
    proposedText: input.proposedText?.trim() || null,
    sourceId: input.sourceId ?? null, status: 'open', createdAt: new Date(),
  })['id'] as string;
}

/**
 * A decision about a suggestion never edits the manuscript.
 *
 * `accepted` means the writer wants to keep the advice. Applying wording is a
 * separate prose save after an explicit yes, so accepting a note cannot
 * silently replace a sentence.
 */
export function decideSuggestion(
  session: Session,
  ctx: Context,
  store: Store,
  input: { id: string; status: 'open' | 'accepted' | 'rejected' },
): boolean {
  const row = store.db.select().from(suggestion).where(and(
    eq(suggestion.id, input.id), eq(suggestion.branchId, ctx.branchId),
  )).get();
  if (!row) throw new Error('Margennoten findes ikke i den aktive gren.');
  session.update(suggestion, row.id, {
    status: input.status,
    decidedAt: input.status === 'open' ? null : new Date(),
  });
  return true;
}

export function suggestionsFor(
  store: Store,
  ctx: Context,
  input: { sceneId?: string; status?: 'open' | 'accepted' | 'rejected' },
) {
  return store.db.select().from(suggestion)
    .where(eq(suggestion.branchId, ctx.branchId)).all()
    .filter((s) => !input.sceneId || s.sceneId === input.sceneId)
    .filter((s) => !input.status || s.status === input.status)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
