import { eq, inArray } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { binding, entity, factSlot } from '../../db/schema';
import { formatInstant } from '../time/gregorian';

export type BoundSlots = Record<string, string>;

/** Slot values as a person would read them, with entity ids resolved to names. */
export function readBindings(
  store: Store,
  ownerKind: 'truth' | 'belief' | 'statement' | 'carrier' | 'reveal',
  ownerId: string,
): BoundSlots {
  const rows = store.db.select().from(binding)
    .where(eq(binding.ownerId, ownerId)).all()
    .filter((b) => b.ownerKind === ownerKind);
  if (rows.length === 0) return {};

  const slots = new Map(
    store.db.select().from(factSlot)
      .where(inArray(factSlot.id, rows.map((r) => r.slotId))).all()
      .map((s) => [s.id, s.name]),
  );
  const entityIds = rows.map((r) => r.valueEntityId).filter((v): v is string => !!v);
  const names = entityIds.length
    ? new Map(store.db.select().from(entity).where(inArray(entity.id, entityIds)).all()
        .map((e) => [e.id, e.name]))
    : new Map<string, string>();

  const out: BoundSlots = {};
  for (const row of rows) {
    const name = slots.get(row.slotId) ?? row.slotId;
    if (row.valueEntityId) out[name] = names.get(row.valueEntityId) ?? row.valueEntityId;
    else if (row.valueTime != null) out[name] = formatInstant(row.valueTime, 'day');
    else if (row.valueText != null) out[name] = row.valueText;
    else if (row.valueNumber != null) out[name] = String(row.valueNumber);
  }
  return out;
}

/** Which slots a fact has, in order. */
export function slotsOf(store: Store, factId: string): { id: string; name: string }[] {
  return store.db.select().from(factSlot).where(eq(factSlot.factId, factId)).all()
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, name: s.name }));
}
