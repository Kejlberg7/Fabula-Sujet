import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { dismissal } from '../../db/schema';
import type { Session } from '../changelog';
import type { Context } from '../workbench';

/**
 * "Yes, he was there -- but he lies about it later, that is the point."
 *
 * Unlike the findings themselves, a dismissal is a person deciding something,
 * so it goes through the change log like every other decision. It keys on the
 * fingerprint rather than the finding row, so it survives a re-run: fix the
 * problem and the finding resolves itself, but put it aside and it stays aside.
 *
 * A reason is required. An engine whose warnings can be waved away without
 * saying why becomes a list of things nobody reads, and then the whole
 * investment is wasted.
 */
export function dismissFinding(
  session: Session,
  ctx: Context,
  store: Store,
  input: { fingerprint: string; reason: string },
): string {
  if (!input.reason.trim()) {
    throw new Error('Sig hvorfor. En afvisning uden grund er bare en advarsel, der er slukket.');
  }
  const existing = store.db.select().from(dismissal).where(and(
    eq(dismissal.branchId, ctx.branchId),
    eq(dismissal.fingerprint, input.fingerprint),
  )).get();

  if (existing) {
    session.update(dismissal, existing.id, { reason: input.reason, revokedAt: null });
    return existing.id;
  }
  return session.insert(dismissal, {
    branchId: ctx.branchId,
    fingerprint: input.fingerprint,
    reason: input.reason,
    createdAt: new Date(),
  })['id'] as string;
}

/** Takes a dismissal back. The finding reappears on the next run. */
export function revokeDismissal(
  session: Session,
  ctx: Context,
  store: Store,
  input: { fingerprint: string },
): boolean {
  const existing = store.db.select().from(dismissal).where(and(
    eq(dismissal.branchId, ctx.branchId),
    eq(dismissal.fingerprint, input.fingerprint),
  )).get();
  if (!existing || existing.revokedAt != null) return false;
  session.update(dismissal, existing.id, { revokedAt: new Date() });
  return true;
}
