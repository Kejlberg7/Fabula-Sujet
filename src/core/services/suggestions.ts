import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { suggestion } from '../../db/schema';
import type { Session } from '../changelog';
import type { Context } from '../workbench';
import { saveSceneText } from './narrative';

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

/** Sammenlign prosa uden at hænge i mellemrum: et linjeskift er ikke en ændring. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The yes.
 *
 * This is the only path from a proposed wording into the manuscript, and it
 * exists so the writer does not have to retype advice they agree with. Three
 * things keep it from becoming the review editing the prose behind their back:
 * the replacement happens in the editor, where they watch it land; the prose and
 * the stamp are written in the same turn, so one undo takes back both; and the
 * text handed in must actually contain the proposal, so a save cannot travel in
 * under a note's name.
 */
export function applySuggestion(
  session: Session,
  ctx: Context,
  store: Store,
  input: { id: string; doc: unknown; markdown: string },
): { sceneId: string; textId: string } {
  const row = store.db.select().from(suggestion).where(and(
    eq(suggestion.id, input.id), eq(suggestion.branchId, ctx.branchId),
  )).get();
  if (!row) throw new Error('Margennoten findes ikke i den aktive gren.');
  if (!row.proposedText) {
    throw new Error('Noten foreslår ingen formulering, så der er ikke noget at skrive ind.');
  }
  if (row.appliedAt) {
    throw new Error('Formuleringen er allerede skrevet ind. Ret videre i teksten i stedet.');
  }
  if (!flat(input.markdown).includes(flat(row.proposedText))) {
    throw new Error(
      'Den tekst, der blev sendt ind, indeholder ikke den foreslåede formulering. '
      + 'Prosaen er ikke ændret.',
    );
  }

  const textId = saveSceneText(session, ctx, store, {
    sceneId: row.sceneId, doc: input.doc, markdown: input.markdown,
    label: `Margennote skrevet ind: ${row.message.slice(0, 60)}`,
  });
  const now = new Date();
  session.update(suggestion, row.id, {
    status: 'accepted', decidedAt: row.decidedAt ?? now, appliedAt: now,
  });
  return { sceneId: row.sceneId, textId };
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
