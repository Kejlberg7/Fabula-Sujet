import { and, asc, eq, lte } from 'drizzle-orm';
import type { Store } from '../db/client';
import {
  beat, belief, binding, branch, carrier, change, chapter, disappearance, entity,
  entityLeg, entityState, event, eventFact, fact, factSlot, identity, law, memoryPolicy,
  part, participation, placeLink, possession, presence, realm, relationship, reveal,
  scene, sceneEvent, sceneText, sourceLink, statement, suggestion, temporalLink,
  textAnchor, thread, work, storyReference,
} from '../db/schema';
import type { Context } from './workbench';
import { inTurn, type Actor, type RawRow, type Session } from './changelog';
import { newId } from './ids';
import { DIVERGEABLE_TABLES, tableByName } from './tables';
import { REVEAL_DA, say } from './words';

const COPY_ORDER = [
  'realm', 'entity', 'identity', 'entity_leg', 'place_link',
  'event', 'fact', 'fact_slot',
  'work', 'part', 'chapter', 'scene', 'scene_text',
  'participation', 'temporal_link', 'event_fact',
  'presence', 'possession', 'entity_state', 'relationship', 'disappearance',
  'belief', 'memory_policy', 'statement', 'carrier', 'binding', 'law',
  'scene_event', 'reveal', 'thread', 'beat', 'text_anchor', 'story_reference',
  'source_link', 'suggestion',
] as const;

const TABLES = {
  realm, entity, identity, entity_leg: entityLeg, place_link: placeLink,
  event, fact, fact_slot: factSlot,
  work, part, chapter, scene, scene_text: sceneText,
  participation, temporal_link: temporalLink, event_fact: eventFact,
  presence, possession, entity_state: entityState, relationship, disappearance,
  belief, memory_policy: memoryPolicy, statement, carrier, binding, law,
  scene_event: sceneEvent, reveal, thread, beat, text_anchor: textAnchor,
  story_reference: storyReference,
  source_link: sourceLink, suggestion,
} as const;

type CopyTable = keyof typeof TABLES;

export interface BranchCreation {
  branchId: string;
  workId: string | null;
  copiedRows: number;
  forkChangeSeq: number;
}

/** Replays one branch's own content log up to a precise point without touching it. */
export function narrativeSnapshotAt(
  store: Store, sourceBranchId: string, targetSeq: number,
): Map<CopyTable, RawRow[]> {
  if (!Number.isInteger(targetSeq) || targetSeq < 0) {
    throw new Error('Forgreningspunktet skal være et gyldigt trinnummer.');
  }
  const source = store.db.select().from(branch).where(eq(branch.id, sourceBranchId)).get();
  if (!source) throw new Error('Kildegrenen findes ikke.');

  const rows = store.db.select().from(change)
    .where(and(eq(change.branchId, sourceBranchId), lte(change.seq, targetSeq)))
    .orderBy(asc(change.seq)).all();
  const state = new Map<CopyTable, Map<string, RawRow>>();
  for (const tableName of COPY_ORDER) state.set(tableName, new Map());

  for (const item of rows) {
    if (!DIVERGEABLE_TABLES.has(item.tableName)) continue;
    const name = item.tableName as CopyTable;
    const tableState = state.get(name);
    if (!tableState) continue;
    const after = item.after as RawRow | null;
    if (after == null) tableState.delete(item.rowId);
    else tableState.set(item.rowId, { ...after });
  }

  return new Map(COPY_ORDER.map((name) => [name, [...state.get(name)!.values()]]));
}

function requiredMap(ids: Map<string, string>, oldId: unknown, label: string): string {
  if (typeof oldId !== 'string') throw new Error(`Historikpunktet mangler ${label}.`);
  const mapped = ids.get(oldId);
  if (!mapped) {
    throw new Error(
      `Historikpunktet ligger midt i en handling: ${label} var endnu ikke oprettet. `
      + 'Vælg afslutningen på en handling i historikken.',
    );
  }
  return mapped;
}

/** Repoints every id-shaped reference after all copied rows received new ids. */
function copiedRow(
  tableName: CopyTable, source: RawRow, branchId: string, ids: Map<string, string>,
): RawRow {
  const oldId = source['id'];
  if (typeof oldId !== 'string') throw new Error(`${tableName} mangler id i historikken.`);
  const row: RawRow = { ...source };
  for (const [column, value] of Object.entries(row)) {
    if (column !== 'origin_id' && column.endsWith('_id') && typeof value === 'string') {
      row[column] = ids.get(value) ?? value;
    }
  }
  // event_fact stores a selected subset of slots as JSON rather than rows.
  if (typeof row['slot_ids'] === 'string') {
    try {
      const parsed = JSON.parse(row['slot_ids'] as string) as unknown;
      if (Array.isArray(parsed)) {
        row['slot_ids'] = JSON.stringify(parsed.map((id) => typeof id === 'string' ? ids.get(id) ?? id : id));
      }
    } catch {
      // A malformed historical value should be copied verbatim; validation can
      // report it later, while branching must not silently rewrite it.
    }
  }
  row['id'] = requiredMap(ids, oldId, `${tableName}.id`);
  row['branch_id'] = branchId;
  if ('origin_id' in source) row['origin_id'] = oldId;
  return row;
}

/**
 * Creates an independent story road from a visible point in the source log.
 * The source is read-only; the new road consists of copied content rows whose
 * origin_id points back to the exact source row they came from.
 */
export function createBranchFromHistory(
  store: Store,
  input: {
    sourceBranchId: string;
    sourceWorkId?: string | null;
    name: string;
    changeSeq: number;
    actor: Actor;
  },
): BranchCreation {
  const sourceBranch = store.db.select().from(branch)
    .where(eq(branch.id, input.sourceBranchId)).get();
  if (!sourceBranch) throw new Error('Kildegrenen findes ikke.');
  const name = input.name.trim();
  if (!name) throw new Error('Grenen skal have et navn.');
  const duplicate = store.db.select().from(branch)
    .where(eq(branch.worldId, sourceBranch.worldId)).all()
    .some((item) => item.name.localeCompare(name, 'da', { sensitivity: 'accent' }) === 0);
  if (duplicate) throw new Error(`Der findes allerede en gren, der hedder «${name}».`);

  const latest = store.db.select().from(change)
    .where(eq(change.branchId, input.sourceBranchId)).orderBy(asc(change.seq)).all().at(-1)?.seq ?? 0;
  if (input.changeSeq > latest) {
    throw new Error(`Kildegrenen er kun nået til trin ${latest}.`);
  }
  const snapshot = narrativeSnapshotAt(store, input.sourceBranchId, input.changeSeq);
  const ids = new Map<string, string>();
  for (const rows of snapshot.values()) {
    for (const row of rows) {
      if (typeof row['id'] === 'string') ids.set(row['id'], newId());
    }
  }

  const newBranchId = newId();
  let copiedRows = 0;
  inTurn(store, {
    branchId: newBranchId,
    actor: input.actor,
    summary: `Opret gren: ${name}`,
  }, (session) => {
    session.insert(branch, {
      id: newBranchId,
      worldId: sourceBranch.worldId,
      parentBranchId: sourceBranch.id,
      forkChangeSeq: input.changeSeq,
      name,
      isDefault: false,
      archivedAt: null,
      createdAt: new Date(),
    });
    for (const tableName of COPY_ORDER) {
      const table = TABLES[tableName];
      for (const source of snapshot.get(tableName) ?? []) {
        session.insertRaw(table, copiedRow(tableName, source, newBranchId, ids));
        copiedRows += 1;
      }
    }
  });

  const mappedWork = input.sourceWorkId ? ids.get(input.sourceWorkId) ?? null : null;
  return {
    branchId: newBranchId,
    workId: mappedWork,
    copiedRows,
    forkChangeSeq: input.changeSeq,
  };
}

function rawRows(store: Store, tableName: CopyTable, branchId: string): RawRow[] {
  tableByName(tableName);
  return store.sqlite.prepare(`select * from "${tableName}" where branch_id = ?`).all(branchId) as RawRow[];
}

function rawById(store: Store, tableName: CopyTable, id: string): RawRow | undefined {
  return store.sqlite.prepare(`select * from "${tableName}" where id = ?`).get(id) as RawRow | undefined;
}

/** Stable lineage key shared by siblings and descendants. */
export function lineageRoot(store: Store, tableName: CopyTable, id: string): string {
  let current = id;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const row = rawById(store, tableName, current);
    const parent = row?.['origin_id'];
    if (typeof parent !== 'string' || !parent) return current;
    current = parent;
  }
  return current;
}

export function workInBranch(store: Store, workId: string, targetBranchId: string): string | null {
  const root = lineageRoot(store, 'work', workId);
  const hit = rawRows(store, 'work', targetBranchId)
    .find((row) => typeof row['id'] === 'string'
      && lineageRoot(store, 'work', row['id'] as string) === root);
  return typeof hit?.['id'] === 'string' ? hit['id'] : null;
}

export interface OutlineScene {
  id: string;
  rootId: string;
  title: string;
  position: number;
  globalPosition: number;
  wordCount: number;
  markdown: string | null;
  revealCount: number;
}

export interface OutlineChapter {
  id: string;
  rootId: string;
  title: string;
  position: number;
  scenes: OutlineScene[];
}

export interface OutlineReveal {
  id: string;
  rootId: string;
  factId: string;
  factSummary: string;
  sceneId: string;
  sceneRootId: string;
  sceneTitle: string;
  strength: string;
}

function outline(store: Store, branchId: string, workId: string) {
  const { db } = store;
  const chapters = db.select().from(chapter)
    .where(and(eq(chapter.branchId, branchId), eq(chapter.workId, workId))).all()
    .sort((a, b) => a.position - b.position);
  let globalPosition = 0;
  const chapterRows: OutlineChapter[] = chapters.map((ch) => {
    const scenes = db.select().from(scene)
      .where(and(eq(scene.branchId, branchId), eq(scene.chapterId, ch.id))).all()
      .sort((a, b) => a.position - b.position)
      .map((item): OutlineScene => {
        globalPosition += 1;
        const currentText = db.select().from(sceneText)
          .where(and(
            eq(sceneText.branchId, branchId), eq(sceneText.sceneId, item.id),
            eq(sceneText.isCurrent, true),
          )).get();
        const revealCount = db.select().from(reveal)
          .where(and(eq(reveal.branchId, branchId), eq(reveal.sceneId, item.id))).all().length;
        return {
          id: item.id,
          rootId: lineageRoot(store, 'scene', item.id),
          title: item.title ?? '(scene uden titel)',
          position: item.position,
          globalPosition,
          wordCount: currentText?.wordCount ?? 0,
          markdown: currentText?.markdown ?? null,
          revealCount,
        };
      });
    return {
      id: ch.id,
      rootId: lineageRoot(store, 'chapter', ch.id),
      title: ch.title,
      position: ch.position,
      scenes,
    };
  });
  const allScenes = chapterRows.flatMap((item) => item.scenes);
  const sceneById = new Map(allScenes.map((item) => [item.id, item]));
  const factName = new Map(
    (store.sqlite.prepare('select id, summary from fact').all() as Array<{ id: string; summary: string }>)
      .map((item) => [item.id, item.summary]),
  );
  const reveals: OutlineReveal[] = db.select().from(reveal)
    .where(eq(reveal.branchId, branchId)).all()
    .filter((item) => sceneById.has(item.sceneId))
    .map((item) => {
      const inScene = sceneById.get(item.sceneId)!;
      return {
        id: item.id,
        rootId: lineageRoot(store, 'reveal', item.id),
        factId: item.factId,
        factSummary: factName.get(item.factId) ?? item.factId,
        sceneId: item.sceneId,
        sceneRootId: inScene.rootId,
        sceneTitle: inScene.title,
        strength: item.strength,
      };
    });
  return { chapters: chapterRows, scenes: allScenes, reveals };
}

export interface BranchDifference {
  kind: 'chapter_moved' | 'scene_moved' | 'scene_added' | 'scene_removed'
    | 'scene_changed' | 'reveal_moved' | 'reveal_changed' | 'reveal_added' | 'reveal_removed';
  label: string;
  left: string | null;
  right: string | null;
}

export function compareBranches(
  store: Store,
  input: { leftBranchId: string; rightBranchId: string; workId: string },
) {
  const leftBranch = store.db.select().from(branch).where(eq(branch.id, input.leftBranchId)).get();
  const rightBranch = store.db.select().from(branch).where(eq(branch.id, input.rightBranchId)).get();
  if (!leftBranch || !rightBranch || leftBranch.worldId !== rightBranch.worldId) {
    throw new Error('Grenene skal findes i den samme verden.');
  }
  const leftWorkId = workInBranch(store, input.workId, input.leftBranchId);
  const rightWorkId = workInBranch(store, input.workId, input.rightBranchId);
  if (!leftWorkId || !rightWorkId) {
    throw new Error('Bogen findes ikke på begge grene ved de valgte punkter.');
  }
  const left = outline(store, input.leftBranchId, leftWorkId);
  const right = outline(store, input.rightBranchId, rightWorkId);
  const differences: BranchDifference[] = [];

  const rightChapters = new Map(right.chapters.map((item) => [item.rootId, item]));
  for (const item of left.chapters) {
    const other = rightChapters.get(item.rootId);
    if (other && item.position !== other.position) differences.push({
      kind: 'chapter_moved', label: item.title,
      left: `kapitel ${item.position}`, right: `kapitel ${other.position}`,
    });
  }

  const leftScenes = new Map(left.scenes.map((item) => [item.rootId, item]));
  const rightScenes = new Map(right.scenes.map((item) => [item.rootId, item]));
  for (const item of left.scenes) {
    const other = rightScenes.get(item.rootId);
    if (!other) {
      differences.push({ kind: 'scene_removed', label: item.title, left: `nr. ${item.globalPosition}`, right: null });
      continue;
    }
    if (item.globalPosition !== other.globalPosition) differences.push({
      kind: 'scene_moved', label: item.title,
      left: `nr. ${item.globalPosition}`, right: `nr. ${other.globalPosition}`,
    });
    if (item.title !== other.title || item.markdown !== other.markdown) differences.push({
      kind: 'scene_changed', label: item.title,
      left: `${item.wordCount} ord`, right: `${other.wordCount} ord`,
    });
  }
  for (const item of right.scenes) {
    if (!leftScenes.has(item.rootId)) differences.push({
      kind: 'scene_added', label: item.title, left: null, right: `nr. ${item.globalPosition}`,
    });
  }

  const leftReveals = new Map(left.reveals.map((item) => [item.rootId, item]));
  const rightReveals = new Map(right.reveals.map((item) => [item.rootId, item]));
  for (const item of left.reveals) {
    const other = rightReveals.get(item.rootId);
    if (!other) {
      differences.push({ kind: 'reveal_removed', label: item.factSummary, left: item.sceneTitle, right: null });
      continue;
    }
    if (item.sceneRootId !== other.sceneRootId) differences.push({
      kind: 'reveal_moved', label: item.factSummary, left: item.sceneTitle, right: other.sceneTitle,
    });
    // Sammenligningen læses af et menneske, så styrken skal stå på dansk her
    // og ikke som den engelske værdi, kolonnen gemmer.
    if (item.strength !== other.strength) differences.push({
      kind: 'reveal_changed', label: item.factSummary,
      left: say(REVEAL_DA, item.strength), right: say(REVEAL_DA, other.strength),
    });
  }
  for (const item of right.reveals) {
    if (!leftReveals.has(item.rootId)) differences.push({
      kind: 'reveal_added', label: item.factSummary, left: null, right: item.sceneTitle,
    });
  }

  return {
    left: { branch: leftBranch, workId: leftWorkId, ...left },
    right: { branch: rightBranch, workId: rightWorkId, ...right },
    differences,
  };
}

export function branchWorkspace(store: Store, ctx: Context) {
  if (!ctx.workId) throw new Error('Der er ikke valgt en bog.');
  const branches = store.db.select().from(branch).where(eq(branch.worldId, ctx.worldId)).all()
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  return {
    activeBranchId: ctx.branchId,
    activeWorkId: ctx.workId,
    branches: branches.map((item) => ({
      ...item,
      createdAt: item.createdAt.getTime(),
      archivedAt: item.archivedAt?.getTime() ?? null,
      parentName: item.parentBranchId
        ? branches.find((candidate) => candidate.id === item.parentBranchId)?.name ?? '(ukendt)'
        : null,
    })),
    outline: outline(store, ctx.branchId, ctx.workId),
  };
}

export function setDefaultBranch(
  store: Store, targetBranchId: string, actor: Actor,
): void {
  const target = store.db.select().from(branch).where(eq(branch.id, targetBranchId)).get();
  if (!target) throw new Error('Grenen findes ikke.');
  if (target.archivedAt) throw new Error('Genåbn grenen, før den gøres til hovedspor.');
  inTurn(store, { branchId: target.id, actor, summary: `Gør ${target.name} til hovedspor` }, (session) => {
    for (const item of store.db.select().from(branch).where(eq(branch.worldId, target.worldId)).all()) {
      if (item.isDefault !== (item.id === target.id)) {
        session.update(branch, item.id, { isDefault: item.id === target.id });
      }
    }
  });
}

export function setBranchArchived(
  session: Session, store: Store, targetBranchId: string, archived: boolean,
): void {
  const target = store.db.select().from(branch).where(eq(branch.id, targetBranchId)).get();
  if (!target) throw new Error('Grenen findes ikke.');
  if (target.isDefault && archived) {
    throw new Error('Vælg først et andet hovedspor.');
  }
  const open = store.db.select().from(branch).where(eq(branch.worldId, target.worldId)).all()
    .filter((item) => !item.archivedAt && item.id !== target.id);
  if (archived && open.length === 0) throw new Error('Den sidste åbne gren kan ikke arkiveres.');
  session.update(branch, target.id, { archivedAt: archived ? new Date() : null });
}

export function moveChapter(
  session: Session, store: Store, ctx: Context, chapterId: string, toIndex: number,
): void {
  const moving = store.db.select().from(chapter).where(eq(chapter.id, chapterId)).get();
  if (!moving || moving.branchId !== ctx.branchId || moving.workId !== ctx.workId) {
    throw new Error('Kapitlet findes ikke i den valgte bog og gren.');
  }
  const rows = store.db.select().from(chapter)
    .where(and(eq(chapter.branchId, ctx.branchId), eq(chapter.workId, moving.workId))).all()
    .sort((a, b) => a.position - b.position)
    .filter((item) => item.id !== moving.id);
  rows.splice(Math.max(0, Math.min(toIndex, rows.length)), 0, moving);
  rows.forEach((item, index) => {
    if (item.position !== index + 1) session.update(chapter, item.id, { position: index + 1 });
  });
}

export function moveScene(
  session: Session, store: Store, ctx: Context,
  input: { sceneId: string; targetChapterId: string; toIndex: number },
): void {
  const moving = store.db.select().from(scene).where(eq(scene.id, input.sceneId)).get();
  const target = store.db.select().from(chapter).where(eq(chapter.id, input.targetChapterId)).get();
  if (!moving || moving.branchId !== ctx.branchId || !target
    || target.branchId !== ctx.branchId || target.workId !== ctx.workId) {
    throw new Error('Scenen eller målkapitlet findes ikke i den valgte gren.');
  }
  const oldChapterId = moving.chapterId;
  const targetRows = store.db.select().from(scene)
    .where(and(eq(scene.branchId, ctx.branchId), eq(scene.chapterId, target.id))).all()
    .sort((a, b) => a.position - b.position)
    .filter((item) => item.id !== moving.id);
  targetRows.splice(Math.max(0, Math.min(input.toIndex, targetRows.length)), 0, moving);
  targetRows.forEach((item, index) => {
    const patch: Record<string, unknown> = {};
    if (item.chapterId !== target.id) patch['chapterId'] = target.id;
    if (item.position !== index + 1) patch['position'] = index + 1;
    if (Object.keys(patch).length) session.update(scene, item.id, patch);
  });
  if (oldChapterId !== target.id) {
    const oldRows = store.db.select().from(scene)
      .where(and(eq(scene.branchId, ctx.branchId), eq(scene.chapterId, oldChapterId))).all()
      .filter((item) => item.id !== moving.id)
      .sort((a, b) => a.position - b.position);
    oldRows.forEach((item, index) => {
      if (item.position !== index + 1) session.update(scene, item.id, { position: index + 1 });
    });
  }
}

export function moveReveal(
  session: Session, store: Store, ctx: Context,
  input: { revealId: string; sceneId: string; strength?: 'hinted' | 'implied' | 'stated' | 'confirmed' },
): void {
  const moving = store.db.select().from(reveal).where(eq(reveal.id, input.revealId)).get();
  const target = store.db.select().from(scene).where(eq(scene.id, input.sceneId)).get();
  if (!moving || moving.branchId !== ctx.branchId || !target || target.branchId !== ctx.branchId) {
    throw new Error('Afsløringen eller målscenen findes ikke i den valgte gren.');
  }
  session.update(reveal, moving.id, {
    sceneId: target.id,
    ...(input.strength ? { strength: input.strength } : {}),
  });
}
