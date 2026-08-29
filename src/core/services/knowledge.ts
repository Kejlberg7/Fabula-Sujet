import { belief, binding, carrier, fact, factSlot, statement } from '../../db/schema';
import type { Session } from '../changelog';
import type { Context } from '../workbench';

export interface SlotSpec {
  name: string;
  valueKind: 'entity' | 'time' | 'place' | 'text' | 'number';
  /** The true filling, when it is known. Leave out for a slot nobody has settled. */
  value?: SlotValue;
}

export interface SlotValue {
  entityId?: string;
  time?: number;
  text?: string;
  number?: number;
}

function writeBindings(
  session: Session,
  ctx: Context,
  ownerKind: 'truth' | 'belief' | 'statement' | 'carrier' | 'reveal',
  ownerId: string,
  slotIds: ReadonlyMap<string, string>,
  values: Readonly<Record<string, SlotValue>>,
): void {
  for (const [slotName, value] of Object.entries(values)) {
    const slotId = slotIds.get(slotName);
    if (!slotId) throw new Error(`Faktummet har ingen plads der hedder "${slotName}".`);
    session.insert(binding, {
      branchId: ctx.branchId, slotId, ownerKind, ownerId,
      valueEntityId: value.entityId ?? null,
      valueTime: value.time ?? null,
      valueText: value.text ?? null,
      valueNumber: value.number ?? null,
    });
  }
}

/**
 * A claim about the world, as a predicate with slots.
 *
 * The slots are the whole point. Partial knowledge is an unbound slot, growing
 * knowledge is binding one more, false belief is binding the wrong value, and a
 * partial reveal is releasing one slot to the reader. None of those needs
 * machinery of its own, and there is never a second near-identical fact to keep
 * in step with the first.
 */
export function createFact(
  session: Session,
  ctx: Context,
  input: {
    predicate: string;
    summary: string;
    realmId: string;
    slots: readonly SlotSpec[];
    truth?: 'true' | 'false' | 'disputed' | 'undecided';
  },
): { factId: string; slotIds: Map<string, string> } {
  const factId = session.insert(fact, {
    worldId: ctx.worldId, branchId: ctx.branchId, realmId: input.realmId,
    predicate: input.predicate, summary: input.summary,
    truth: input.truth ?? 'true', createdAt: new Date(),
  })['id'] as string;

  const slotIds = new Map<string, string>();
  input.slots.forEach((slot, index) => {
    const id = session.insert(factSlot, {
      factId, branchId: ctx.branchId, name: slot.name,
      position: index, valueKind: slot.valueKind,
    })['id'] as string;
    slotIds.set(slot.name, id);
  });

  const truthValues: Record<string, SlotValue> = {};
  for (const slot of input.slots) if (slot.value) truthValues[slot.name] = slot.value;
  writeBindings(session, ctx, 'truth', factId, slotIds, truthValues);

  return { factId, slotIds };
}

/**
 * What someone holds to be the case, from a point in *their own* time.
 *
 * `untilPersonal` lets it expire -- amnesia at the extreme, ordinary forgetting
 * in the mild case. Binding fewer slots than the truth has is not an omission;
 * it is the difference between knowing Peter was killed and knowing who did it.
 */
export function recordBelief(
  session: Session,
  ctx: Context,
  input: {
    entityId: string;
    factId: string;
    strength: 'knows' | 'convinced' | 'suspects' | 'mistaken' | 'denies' | 'unaware';
    legId?: string;
    sincePersonal?: number;
    untilPersonal?: number;
    sourceEventId?: string;
    sourceStatementId?: string;
    sourceCarrierId?: string;
    derived?: boolean;
    note?: string;
    slotIds?: ReadonlyMap<string, string>;
    binds?: Readonly<Record<string, SlotValue>>;
  },
): string {
  const id = session.insert(belief, {
    branchId: ctx.branchId, entityId: input.entityId, legId: input.legId ?? null,
    factId: input.factId, strength: input.strength,
    sincePersonal: input.sincePersonal ?? null, untilPersonal: input.untilPersonal ?? null,
    sourceEventId: input.sourceEventId ?? null,
    sourceStatementId: input.sourceStatementId ?? null,
    sourceCarrierId: input.sourceCarrierId ?? null,
    derived: input.derived ?? false, note: input.note ?? null,
  })['id'] as string;

  if (input.binds && input.slotIds) {
    writeBindings(session, ctx, 'belief', id, input.slotIds, input.binds);
  }
  return id;
}

/** What someone says, to whom. Speaker and audience may be the same person. */
export function recordStatement(
  session: Session,
  ctx: Context,
  input: {
    speakerEntityId: string;
    factId: string;
    truthful?: boolean;
    eventId?: string;
    speakerLegId?: string;
    audienceEntityId?: string;
    atTime?: number;
    note?: string;
    slotIds?: ReadonlyMap<string, string>;
    binds?: Readonly<Record<string, SlotValue>>;
  },
): string {
  const id = session.insert(statement, {
    branchId: ctx.branchId, eventId: input.eventId ?? null,
    speakerEntityId: input.speakerEntityId, speakerLegId: input.speakerLegId ?? null,
    factId: input.factId, truthful: input.truthful ?? null,
    audienceEntityId: input.audienceEntityId ?? null,
    atTime: input.atTime ?? null, note: input.note ?? null,
  })['id'] as string;

  if (input.binds && input.slotIds) {
    writeBindings(session, ctx, 'statement', id, input.slotIds, input.binds);
  }
  return id;
}

/**
 * A fact written down in an object: a polaroid, a tattoo, a letter.
 *
 * Effective knowledge is what she remembers plus what she is carrying, which is
 * where "she acted on a note she left at home" comes from. A carrier may be
 * inaccurate -- a note can be wrong, or a forgery.
 */
export function attachFactToCarrier(
  session: Session,
  ctx: Context,
  input: {
    objectEntityId: string;
    factId: string;
    accurate?: boolean;
    writtenEventId?: string;
    destroyedEventId?: string;
    note?: string;
    slotIds?: ReadonlyMap<string, string>;
    binds?: Readonly<Record<string, SlotValue>>;
  },
): string {
  const id = session.insert(carrier, {
    branchId: ctx.branchId, objectEntityId: input.objectEntityId, factId: input.factId,
    accurate: input.accurate ?? true,
    writtenEventId: input.writtenEventId ?? null,
    destroyedEventId: input.destroyedEventId ?? null,
    note: input.note ?? null,
  })['id'] as string;

  if (input.binds && input.slotIds) {
    writeBindings(session, ctx, 'carrier', id, input.slotIds, input.binds);
  }
  return id;
}
