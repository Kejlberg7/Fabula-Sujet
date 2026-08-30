import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  belief, binding, carrier, disappearance, entity, entityLeg, entityState, identity,
  memoryPolicy, participation, placeLink, possession, presence, relationship, statement,
  storyReference, textAnchor,
} from '../../db/schema';
import type { Session } from '../changelog';
import type { Context } from '../workbench';

export function createEntity(
  session: Session,
  ctx: Context,
  input: {
    name: string;
    kind: 'person' | 'place' | 'object' | 'organisation' | 'concept';
    summary?: string;
    description?: string;
  },
): string {
  const id = session.insert(entity, {
    worldId: ctx.worldId, branchId: ctx.branchId,
    kind: input.kind, name: input.name,
    summary: input.summary ?? null, description: input.description ?? null,
    createdAt: new Date(),
  })['id'] as string;

  // Everyone gets one leg. Most people never get a second, and then the model
  // behaves exactly as it would without personal time at all.
  if (input.kind === 'person') {
    session.insert(entityLeg, {
      entityId: id, branchId: ctx.branchId, ordinal: 1, label: null,
    });
  }
  return id;
}

export function createIdentity(
  session: Session, ctx: Context,
  input: {
    entityId: string; name: string; sameAsFactId?: string;
    validFrom?: number; validTo?: number; note?: string;
  },
): string {
  return session.insert(identity, {
    entityId: input.entityId, branchId: ctx.branchId, name: input.name,
    sameAsFactId: input.sameAsFactId ?? null,
    validFrom: input.validFrom ?? null, validTo: input.validTo ?? null,
    note: input.note ?? null,
  })['id'] as string;
}

/**
 * A stretch of someone's own life.
 *
 * Ordinals run along personal time and never repeat: leg 2 is always later for
 * the person than leg 1, whatever the world clock says about where they are.
 */
export function createLeg(
  session: Session, ctx: Context, store: Store,
  input: {
    entityId: string; ordinal: number; label?: string;
    personalStart?: number; personalEnd?: number;
    worldStart?: number; worldEnd?: number;
    realmId?: string; identityId?: string;
  },
): string {
  const values = {
    label: input.label ?? null,
    personalStart: input.personalStart ?? null, personalEnd: input.personalEnd ?? null,
    worldStart: input.worldStart ?? null, worldEnd: input.worldEnd ?? null,
    realmId: input.realmId ?? null, identityId: input.identityId ?? null,
  };

  // Every person is created with leg 1 already in place, so describing it is a
  // change rather than an addition. Two legs sharing an ordinal would mean the
  // person lived the same stretch of their life twice, which is not a thing.
  const existing = store.db.select().from(entityLeg)
    .where(and(
      eq(entityLeg.entityId, input.entityId),
      eq(entityLeg.branchId, ctx.branchId),
      eq(entityLeg.ordinal, input.ordinal),
    )).get();
  if (existing) {
    session.update(entityLeg, existing.id, values);
    return existing.id;
  }

  return session.insert(entityLeg, {
    entityId: input.entityId, branchId: ctx.branchId, ordinal: input.ordinal, ...values,
  })['id'] as string;
}

export function recordPresence(
  session: Session, ctx: Context,
  input: {
    entityId: string; placeId: string; realmId: string;
    legId?: string; fromTime?: number; toTime?: number;
    derivedFromEventId?: string; note?: string;
  },
): string {
  return session.insert(presence, {
    branchId: ctx.branchId, entityId: input.entityId, placeId: input.placeId,
    realmId: input.realmId, legId: input.legId ?? null,
    fromTime: input.fromTime ?? null, toTime: input.toTime ?? null,
    derivedFromEventId: input.derivedFromEventId ?? null, note: input.note ?? null,
  })['id'] as string;
}

export function recordPossession(
  session: Session, ctx: Context,
  input: {
    holderEntityId: string; objectEntityId: string; holderLegId?: string;
    fromTime?: number; toTime?: number; note?: string;
  },
): string {
  return session.insert(possession, {
    branchId: ctx.branchId, holderEntityId: input.holderEntityId,
    objectEntityId: input.objectEntityId, holderLegId: input.holderLegId ?? null,
    fromTime: input.fromTime ?? null, toTime: input.toTime ?? null, note: input.note ?? null,
  })['id'] as string;
}

/**
 * A state that holds until something replaces it.
 *
 * A category means the values inside it are mutually exclusive -- that is the
 * whole reason the column exists, and the continuity rule checks it. So writing
 * a new value closes the open one before it, rather than leaving the writer to
 * remember. Saying "he is alive from 1866" and later "he is dead from 1901"
 * is how a person thinks about it, and it should not produce a contradiction.
 *
 * Only an open-ended earlier state is closed, and only when the new one is
 * placed in time. A state that already has an end was deliberate, and a state
 * with no beginning cannot be ordered against anything.
 */
export function recordEntityState(
  session: Session, store: Store, ctx: Context,
  input: {
    entityId: string; category: string; value: string;
    fromTime?: number; toTime?: number; note?: string;
  },
): string {
  if (!input.category.trim() || !input.value.trim()) {
    throw new Error('En tilstand skal have både kategori og værdi.');
  }
  const category = input.category.trim();
  if (input.fromTime != null) {
    const open = store.db.select().from(entityState).where(and(
      eq(entityState.entityId, input.entityId),
      eq(entityState.branchId, ctx.branchId),
      eq(entityState.category, category),
    )).all().filter((row) =>
      row.toTime == null && row.fromTime != null && row.fromTime < input.fromTime!);
    for (const row of open) {
      session.update(entityState, row.id, { toTime: input.fromTime });
    }
  }
  return session.insert(entityState, {
    branchId: ctx.branchId, entityId: input.entityId,
    category, value: input.value.trim(),
    fromTime: input.fromTime ?? null, toTime: input.toTime ?? null,
    note: input.note ?? null,
  })['id'] as string;
}

export function createRelationship(
  session: Session, ctx: Context,
  input: {
    fromEntityId: string; toEntityId: string; kind: string;
    category?: string; symmetric?: boolean; fromTime?: number; toTime?: number; note?: string;
  },
): string {
  return session.insert(relationship, {
    branchId: ctx.branchId, fromEntityId: input.fromEntityId, toEntityId: input.toEntityId,
    kind: input.kind, category: input.category?.trim() || null,
    symmetric: input.symmetric ?? false,
    fromTime: input.fromTime ?? null, toTime: input.toTime ?? null, note: input.note ?? null,
  })['id'] as string;
}

export function recordDisappearance(
  session: Session, ctx: Context,
  input: {
    entityId: string; disappearsEventId: string; returnsEventId?: string; note?: string;
  },
): string {
  if (input.disappearsEventId === input.returnsEventId) {
    throw new Error('Forsvinden og tilbagekomst kan ikke være det samme event.');
  }
  return session.insert(disappearance, {
    branchId: ctx.branchId, entityId: input.entityId,
    disappearsEventId: input.disappearsEventId,
    returnsEventId: input.returnsEventId ?? null,
    note: input.note ?? null,
  })['id'] as string;
}

/** Set how long experiences learned during a stretch of personal time last. */
export function recordMemoryPolicy(
  session: Session, ctx: Context,
  input: {
    entityId: string; legId?: string;
    fromPersonal?: number; untilPersonal?: number;
    retentionSeconds?: number | null; note?: string;
  },
): string {
  if (input.retentionSeconds != null && input.retentionSeconds < 0) {
    throw new Error('Hukommelsens varighed kan ikke være negativ.');
  }
  return session.insert(memoryPolicy, {
    branchId: ctx.branchId, entityId: input.entityId, legId: input.legId ?? null,
    fromPersonal: input.fromPersonal ?? null, untilPersonal: input.untilPersonal ?? null,
    retentionSeconds: input.retentionSeconds ?? null, note: input.note ?? null,
  })['id'] as string;
}

export function createPlaceLink(
  session: Session, ctx: Context,
  input: {
    realmId: string; fromPlaceId: string; toPlaceId: string; mode: string;
    travelMin?: number; travelMax?: number; bidirectional?: boolean; note?: string;
  },
): string {
  return session.insert(placeLink, {
    branchId: ctx.branchId, realmId: input.realmId,
    fromPlaceId: input.fromPlaceId, toPlaceId: input.toPlaceId, mode: input.mode,
    travelMin: input.travelMin ?? null, travelMax: input.travelMax ?? null,
    bidirectional: input.bidirectional ?? true, note: input.note ?? null,
  })['id'] as string;
}

/**
 * "Anna" and "Anna Berg" turned out to be the same person.
 *
 * This happens constantly when a story is talked in rather than typed in, so it
 * is a first-class operation rather than something to clean up by hand. Every
 * reference is repointed and the loser is deleted -- all inside one turn, so a
 * merge made in error is one undo away.
 */
export function mergeEntities(
  session: Session, store: Store, ctx: Context,
  input: { keepId: string; mergeId: string },
): { moved: number } {
  if (input.keepId === input.mergeId) throw new Error('Kan ikke flette en entitet med sig selv.');
  const { db } = store;
  let moved = 0;

  const repoint = <T extends { id: string }>(rows: T[], table: never, patch: Record<string, string>) => {
    for (const row of rows) {
      session.update(table, row.id, patch);
      moved += 1;
    }
  };

  repoint(db.select().from(entityLeg).where(eq(entityLeg.entityId, input.mergeId)).all(),
    entityLeg as never, { entityId: input.keepId });
  repoint(db.select().from(identity).where(eq(identity.entityId, input.mergeId)).all(),
    identity as never, { entityId: input.keepId });
  repoint(db.select().from(presence).where(eq(presence.entityId, input.mergeId)).all(),
    presence as never, { entityId: input.keepId });
  repoint(db.select().from(presence).where(eq(presence.placeId, input.mergeId)).all(),
    presence as never, { placeId: input.keepId });
  repoint(db.select().from(participation).where(eq(participation.entityId, input.mergeId)).all(),
    participation as never, { entityId: input.keepId });
  repoint(db.select().from(possession).where(eq(possession.holderEntityId, input.mergeId)).all(),
    possession as never, { holderEntityId: input.keepId });
  repoint(db.select().from(possession).where(eq(possession.objectEntityId, input.mergeId)).all(),
    possession as never, { objectEntityId: input.keepId });
  repoint(db.select().from(entityState).where(eq(entityState.entityId, input.mergeId)).all(),
    entityState as never, { entityId: input.keepId });
  repoint(db.select().from(relationship).where(eq(relationship.fromEntityId, input.mergeId)).all(),
    relationship as never, { fromEntityId: input.keepId });
  repoint(db.select().from(relationship).where(eq(relationship.toEntityId, input.mergeId)).all(),
    relationship as never, { toEntityId: input.keepId });
  repoint(db.select().from(disappearance).where(eq(disappearance.entityId, input.mergeId)).all(),
    disappearance as never, { entityId: input.keepId });
  repoint(db.select().from(belief).where(eq(belief.entityId, input.mergeId)).all(),
    belief as never, { entityId: input.keepId });
  repoint(db.select().from(memoryPolicy).where(eq(memoryPolicy.entityId, input.mergeId)).all(),
    memoryPolicy as never, { entityId: input.keepId });
  repoint(db.select().from(statement).where(eq(statement.speakerEntityId, input.mergeId)).all(),
    statement as never, { speakerEntityId: input.keepId });
  repoint(db.select().from(carrier).where(eq(carrier.objectEntityId, input.mergeId)).all(),
    carrier as never, { objectEntityId: input.keepId });
  repoint(db.select().from(binding).where(eq(binding.valueEntityId, input.mergeId)).all(),
    binding as never, { valueEntityId: input.keepId });
  repoint(db.select().from(textAnchor).where(and(
    eq(textAnchor.targetKind, 'entity'), eq(textAnchor.targetId, input.mergeId),
  )).all(), textAnchor as never, { targetId: input.keepId });
  // Both visible codes remain valid aliases for the surviving entity. A writer
  // may already have used either one in notes or conversation.
  repoint(db.select().from(storyReference).where(and(
    eq(storyReference.targetKind, 'entity'), eq(storyReference.targetId, input.mergeId),
  )).all(), storyReference as never, { targetId: input.keepId });

  session.remove(entity, input.mergeId);
  return { moved };
}
