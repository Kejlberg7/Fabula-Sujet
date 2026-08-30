import { eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  branch, entity, event, fact, identity, reveal, scene, storyReference, thread,
  type ReferenceKind,
} from '../../db/schema';
import type { Session } from '../changelog';

type EntityKind = 'person' | 'place' | 'object' | 'organisation' | 'concept';

const ENTITY_PREFIX: Record<EntityKind, string> = {
  person: 'P',
  place: 'S',
  object: 'G',
  organisation: 'O',
  concept: 'B',
};

const KIND_PREFIX: Record<Exclude<ReferenceKind, 'entity'>, string> = {
  identity: 'I',
  event: 'E',
  fact: 'F',
  reveal: 'A',
  scene: 'SC',
  thread: 'T',
};

interface Candidate {
  targetKind: ReferenceKind;
  targetId: string;
  originId: string | null;
  prefix: string;
  label: string;
}

/** Everything that may be addressed directly from prose on one branch. */
function candidates(store: Store, branchId: string): Candidate[] {
  const { db } = store;
  const rows: Candidate[] = [];
  for (const item of db.select().from(entity).where(eq(entity.branchId, branchId)).all()) {
    rows.push({
      targetKind: 'entity', targetId: item.id, originId: item.originId,
      prefix: ENTITY_PREFIX[item.kind], label: item.name,
    });
  }
  for (const item of db.select().from(identity).where(eq(identity.branchId, branchId)).all()) {
    rows.push({
      targetKind: 'identity', targetId: item.id, originId: item.originId,
      prefix: KIND_PREFIX.identity, label: item.name,
    });
  }
  for (const item of db.select().from(event).where(eq(event.branchId, branchId)).all()) {
    rows.push({
      targetKind: 'event', targetId: item.id, originId: item.originId,
      prefix: KIND_PREFIX.event, label: item.title,
    });
  }
  for (const item of db.select().from(fact).where(eq(fact.branchId, branchId)).all()) {
    rows.push({
      targetKind: 'fact', targetId: item.id, originId: item.originId,
      prefix: KIND_PREFIX.fact, label: item.summary,
    });
  }
  const factNames = new Map(db.select().from(fact).all().map((item) => [item.id, item.summary]));
  for (const item of db.select().from(reveal).where(eq(reveal.branchId, branchId)).all()) {
    rows.push({
      targetKind: 'reveal', targetId: item.id, originId: item.originId,
      prefix: KIND_PREFIX.reveal,
      label: `Afsløring: ${factNames.get(item.factId) ?? '(ukendt faktum)'}`,
    });
  }
  for (const item of db.select().from(scene).where(eq(scene.branchId, branchId)).all()) {
    rows.push({
      targetKind: 'scene', targetId: item.id, originId: item.originId,
      prefix: KIND_PREFIX.scene, label: item.title ?? '(scene uden titel)',
    });
  }
  for (const item of db.select().from(thread).where(eq(thread.branchId, branchId)).all()) {
    rows.push({
      targetKind: 'thread', targetId: item.id, originId: item.originId,
      prefix: KIND_PREFIX.thread, label: item.name,
    });
  }
  return rows.sort((a, b) => a.prefix.localeCompare(b.prefix, 'da')
    || a.label.localeCompare(b.label, 'da') || a.targetId.localeCompare(b.targetId));
}

function nextNumber(codes: readonly string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
  let highest = 0;
  for (const code of codes) {
    const match = code.match(pattern);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

/**
 * Gives every newly-created addressable row one stable, short code.
 *
 * Called at the end of the same change-log turn that created the target, so one
 * undo removes both. A copied target inherits the source target's code. A new
 * target takes the next number across the whole world, not merely this branch;
 * siblings can therefore never independently invent two different G17s.
 */
export function indexMissingReferences(
  session: Session, store: Store, branchId: string,
): number {
  const branchRow = store.db.select().from(branch).where(eq(branch.id, branchId)).get();
  if (!branchRow) return 0;

  const allInWorld = store.db.select().from(storyReference)
    .where(eq(storyReference.worldId, branchRow.worldId)).all();
  const inBranch = allInWorld.filter((item) => item.branchId === branchId);
  const referenced = new Set(inBranch.map((item) => `${item.targetKind}:${item.targetId}`));
  const usedHere = new Set(inBranch.map((item) => item.code.toUpperCase()));
  const allCodes = allInWorld.map((item) => item.code);
  let added = 0;

  for (const target of candidates(store, branchId)) {
    if (referenced.has(`${target.targetKind}:${target.targetId}`)) continue;

    const inherited = target.originId == null ? undefined : allInWorld.find((item) =>
      item.targetKind === target.targetKind && item.targetId === target.originId);
    let code = inherited?.code.toUpperCase();
    if (!code || usedHere.has(code)) {
      let number = nextNumber(allCodes, target.prefix);
      code = `${target.prefix}${number}`;
      while (usedHere.has(code)) {
        number += 1;
        code = `${target.prefix}${number}`;
      }
    }

    session.insert(storyReference, {
      worldId: branchRow.worldId,
      branchId,
      targetKind: target.targetKind,
      targetId: target.targetId,
      code,
      createdAt: new Date(),
    });
    referenced.add(`${target.targetKind}:${target.targetId}`);
    usedHere.add(code);
    allCodes.push(code);
    added += 1;
  }
  return added;
}
