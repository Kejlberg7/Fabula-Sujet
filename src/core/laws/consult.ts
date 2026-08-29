import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { law, realm } from '../../db/schema';
import type { Context } from '../workbench';

export interface Exemption {
  lawId: string;
  statement: string;
}

/**
 * Does anything in this world lift a rule here?
 *
 * The built-in rules ask this *before* they report, which is the whole point of
 * the law table: an exception is something the writer wrote down about their
 * world, not a warning they clicked away. A hard `ability` naming a rule code is
 * the machine-readable half; a `prohibition` never lifts anything, it only adds.
 *
 * Scope is inherited downwards. A law on the world holds in every realm until a
 * law on that realm says otherwise, because what is worth writing down is the
 * exception -- so a world-scoped law matches everywhere, and a realm-scoped one
 * matches only inside that realm and the realms nested in it.
 */
export function lawsLifting(
  store: Store,
  ctx: Context,
  query: {
    ruleCode: string;
    /** Who the rule is about, when it is about someone. */
    entityId?: string | null;
    entityKind?: string | null;
    /** Where it happens, so a realm-scoped law can be told apart from a world one. */
    realmId?: string | null;
    workId?: string | null;
    /** When it happens, in world time, so a law with a validity window can say no. */
    at?: number | null;
  },
): Exemption[] {
  const { db } = store;
  const candidates = db.select().from(law)
    .where(and(
      eq(law.branchId, ctx.branchId),
      eq(law.ruleCode, query.ruleCode),
      eq(law.kind, 'ability'),
      eq(law.enabled, true),
    )).all();
  if (candidates.length === 0) return [];

  // A realm-scoped law reaches the realms nested inside it, not just its own.
  const chain = new Set<string>();
  let walk = query.realmId ?? null;
  const seen = new Set<string>();
  while (walk && !seen.has(walk)) {
    seen.add(walk);
    chain.add(walk);
    walk = db.select().from(realm).where(eq(realm.id, walk)).get()?.parentRealmId ?? null;
  }

  return candidates
    .filter((l) => {
      if (l.validFrom != null && query.at != null && query.at < l.validFrom) return false;
      if (l.validTo != null && query.at != null && query.at > l.validTo) return false;
      switch (l.scopeKind) {
        case 'world': return true;
        case 'realm': return l.scopeId != null && chain.has(l.scopeId);
        case 'work': return l.scopeId != null && l.scopeId === query.workId;
        // A series-scoped law needs the work's series, which the caller does not
        // always have. Letting it through is the safer error: the cost is a
        // finding we did not raise, not one we raised wrongly.
        case 'series': return true;
        default: return false;
      }
    })
    .filter((l) => {
      switch (l.subjectKind) {
        case 'everyone': return true;
        case 'entity': return l.subjectEntityId != null && l.subjectEntityId === query.entityId;
        case 'entity_kind': return l.subjectExpression != null
          && l.subjectExpression === query.entityKind;
        // Whether the holder actually has the thing is the carrier rule's job,
        // and it is not decidable from a rule code alone.
        case 'carrier_holder': return true;
        default: return false;
      }
    })
    .map((l) => ({ lawId: l.id, statement: l.statement }));
}
