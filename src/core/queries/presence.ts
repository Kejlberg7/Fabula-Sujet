import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { entity, entityLeg, presence, realm } from '../../db/schema';
import type { Context } from '../workbench';

export interface PresenceHit {
  entityId: string;
  entityName: string;
  legLabel: string | null;
  legOrdinal: number | null;
  placeId: string;
  placeName: string;
  realmId: string;
  realmName: string;
  fromTime: number | null;
  toTime: number | null;
}

/**
 * Who was where.
 *
 * Deliberately says nothing about whether an overlap is a problem: the same
 * person in two places is a mistake only if it is the same leg of their life in
 * the same realm, and deciding that belongs to the rules, not to a lookup.
 */
export function whoWasWhere(
  store: Store,
  ctx: Context,
  query: { at?: number; placeId?: string; realmId?: string; entityId?: string },
): PresenceHit[] {
  const { db } = store;
  const rows = db.select().from(presence)
    .where(eq(presence.branchId, ctx.branchId)).all()
    .filter((p) => !query.placeId || p.placeId === query.placeId)
    .filter((p) => !query.realmId || p.realmId === query.realmId)
    .filter((p) => !query.entityId || p.entityId === query.entityId)
    .filter((p) => query.at == null
      || ((p.fromTime ?? Number.NEGATIVE_INFINITY) <= query.at
        && (p.toTime ?? Number.POSITIVE_INFINITY) >= query.at));

  const nameOf = (id: string) =>
    db.select().from(entity).where(eq(entity.id, id)).get()?.name ?? '(ukendt)';

  return rows.map((p) => {
    const leg = p.legId
      ? db.select().from(entityLeg).where(eq(entityLeg.id, p.legId)).get()
      : undefined;
    return {
      entityId: p.entityId,
      entityName: nameOf(p.entityId),
      legLabel: leg?.label ?? null,
      legOrdinal: leg?.ordinal ?? null,
      placeId: p.placeId,
      placeName: nameOf(p.placeId),
      realmId: p.realmId,
      realmName: db.select().from(realm).where(eq(realm.id, p.realmId)).get()?.name ?? '(ukendt lag)',
      fromTime: p.fromTime,
      toTime: p.toTime,
    };
  });
}

/** Every leg of a person's life, in the order they lived them. */
export function worldline(store: Store, ctx: Context, entityId: string) {
  return store.db.select().from(entityLeg)
    .where(and(eq(entityLeg.entityId, entityId), eq(entityLeg.branchId, ctx.branchId)))
    .all().sort((a, b) => a.ordinal - b.ordinal);
}
