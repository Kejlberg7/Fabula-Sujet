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
import { saveSceneText } from './services/narrative';
import { DIVERGEABLE_TABLES, tableByName } from './tables';
import { formatInstant, formatSpan } from './time/gregorian';
import { BRANCH_VALUE_DA, REVEAL_DA, say } from './words';

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

export interface ProseDifference {
  before: string;
  removed: string;
  added: string;
  after: string;
}

interface RowTransfer {
  type: 'row';
  tableName: CopyTable;
  rootId: string;
  fields: string[];
}

interface ProseTransfer {
  type: 'prose';
  sceneRootId: string;
}

interface SceneMoveTransfer {
  type: 'scene_move';
  sceneRootId: string;
}

interface ChapterMoveTransfer {
  type: 'chapter_move';
  chapterRootId: string;
}

interface RevealTransfer {
  type: 'reveal';
  revealRootId: string;
  fields: Array<'scene' | 'strength'>;
}

type BranchTransfer = RowTransfer | ProseTransfer | SceneMoveTransfer
  | ChapterMoveTransfer | RevealTransfer;

export interface BranchDifference {
  /** Stable inside one comparison and opaque to the interface. */
  id: string;
  kind: string;
  section: 'fortaelling' | 'prosa' | 'events' | 'tid' | 'fakta'
    | 'personer' | 'love' | 'relationer' | 'plottraade';
  label: string;
  left: string | null;
  right: string | null;
  /** The active/left side changed too, compared with the common fork point. */
  conflict: boolean;
  canTransfer: boolean;
  transferNote: string | null;
  detail: ProseDifference | null;
  transfer: BranchTransfer | null;
}

type DifferenceSection = BranchDifference['section'];

interface ModelSpec {
  tableName: CopyTable;
  domain: string;
  section: DifferenceSection;
  fields: string[];
  /** Only the first group for a table owns additions and removals. */
  ownsExistence?: boolean;
}

const MODEL_SPECS: ModelSpec[] = [
  {
    tableName: 'entity', domain: 'entity', section: 'personer', ownsExistence: true,
    fields: ['kind', 'name', 'summary', 'description', 'born_event_id', 'died_event_id'],
  },
  {
    tableName: 'event', domain: 'event', section: 'events', ownsExistence: true,
    fields: ['title', 'summary', 'place_id', 'realm_id'],
  },
  {
    tableName: 'event', domain: 'time', section: 'tid',
    fields: ['earliest', 'latest', 'duration_min', 'duration_max', 'precision'],
  },
  {
    tableName: 'temporal_link', domain: 'temporal_link', section: 'tid', ownsExistence: true,
    fields: ['from_event_id', 'to_event_id', 'kind', 'offset_min', 'offset_max', 'axis', 'leg_id', 'note'],
  },
  {
    tableName: 'fact', domain: 'fact', section: 'fakta', ownsExistence: true,
    fields: ['realm_id', 'predicate', 'summary', 'truth'],
  },
  {
    tableName: 'law', domain: 'law', section: 'love', ownsExistence: true,
    fields: [
      'kind', 'hardness', 'rule_code', 'scope_kind', 'scope_id', 'subject_kind',
      'subject_entity_id', 'subject_expression', 'statement', 'valid_from', 'valid_to',
      'source_id', 'enabled',
    ],
  },
  {
    tableName: 'relationship', domain: 'relationship', section: 'relationer', ownsExistence: true,
    fields: [
      'from_entity_id', 'to_entity_id', 'kind', 'category', 'symmetric',
      'from_time', 'to_time', 'note',
    ],
  },
  {
    tableName: 'thread', domain: 'thread', section: 'plottraade', ownsExistence: true,
    fields: ['work_id', 'name', 'summary', 'scope'],
  },
];

const FIELD_DA: Record<string, string> = {
  kind: 'slags', name: 'navn', title: 'titel', summary: 'resumé', description: 'beskrivelse',
  truth: 'sandhed', predicate: 'påstand', statement: 'regel', hardness: 'hårdhed',
  rule_code: 'regeltype', enabled: 'aktiv', scope: 'rækkevidde', scope_kind: 'rækkevidde',
  subject_kind: 'gælder for', subject_expression: 'udtryk', category: 'kategori',
  symmetric: 'gensidig', note: 'note', precision: 'præcision', axis: 'akse',
  earliest: 'tidligst', latest: 'senest', duration_min: 'mindst varighed',
  duration_max: 'højst varighed', from_time: 'fra', to_time: 'til',
  valid_from: 'fra', valid_to: 'til', offset_min: 'mindst afstand',
  offset_max: 'højst afstand', place_id: 'sted', realm_id: 'lag',
  born_event_id: 'født/skabt ved', died_event_id: 'død/ødelagt ved',
  from_entity_id: 'fra', to_entity_id: 'til', from_event_id: 'fra event',
  to_event_id: 'til event', subject_entity_id: 'person/genstand', work_id: 'bog',
};

function rootsById(store: Store): Map<string, string> {
  const result = new Map<string, string>();
  for (const tableName of COPY_ORDER) {
    const rows = store.sqlite.prepare(`select id from "${tableName}"`).all() as Array<{ id: string }>;
    for (const row of rows) result.set(row.id, lineageRoot(store, tableName, row.id));
  }
  return result;
}

function canonicalValue(value: unknown, roots: Map<string, string>): unknown {
  if (typeof value === 'string' && roots.has(value)) return roots.get(value);
  if (typeof value === 'string' && value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => canonicalValue(item, roots));
    } catch {
      // It was ordinary prose beginning with a bracket, not stored JSON.
    }
  }
  return value;
}

function picked(row: RawRow | undefined, fields: string[], roots: Map<string, string>): unknown {
  if (!row) return null;
  return fields.map((field) => canonicalValue(row[field] ?? null, roots));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rowsAtRoots(
  store: Store, tableName: CopyTable, branchId: string,
): Map<string, RawRow> {
  return new Map(rawRows(store, tableName, branchId).map((row) => {
    const id = row['id'] as string;
    return [lineageRoot(store, tableName, id), row];
  }));
}

function branchPath(store: Store, branchId: string): Array<typeof branch.$inferSelect> {
  const result: Array<typeof branch.$inferSelect> = [];
  let id: string | null = branchId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const item = store.db.select().from(branch).where(eq(branch.id, id)).get();
    if (!item) break;
    result.push(item);
    id = item.parentBranchId;
  }
  return result;
}

/** The last state both roads indisputably shared. */
function commonSnapshot(
  store: Store, leftBranchId: string, rightBranchId: string,
): Map<CopyTable, RawRow[]> {
  const leftPath = branchPath(store, leftBranchId);
  const rightPath = branchPath(store, rightBranchId);
  const leftIds = new Set(leftPath.map((item) => item.id));
  const common = rightPath.find((item) => leftIds.has(item.id));
  if (!common) return new Map(COPY_ORDER.map((name) => [name, []]));
  const forkFrom = (path: Array<typeof branch.$inferSelect>) => {
    const index = path.findIndex((item) => item.id === common.id);
    if (index <= 0) return Number.POSITIVE_INFINITY;
    return path[index - 1]!.forkChangeSeq ?? 0;
  };
  const seq = Math.min(forkFrom(leftPath), forkFrom(rightPath));
  if (!Number.isFinite(seq)) return new Map(COPY_ORDER.map((name) => [
    name, rawRows(store, name, common.id),
  ]));
  return narrativeSnapshotAt(store, common.id, seq);
}

function snapshotAtRoots(
  store: Store, snapshot: Map<CopyTable, RawRow[]>, tableName: CopyTable,
): Map<string, RawRow> {
  return new Map((snapshot.get(tableName) ?? []).map((row) => {
    const id = row['id'] as string;
    return [lineageRoot(store, tableName, id), row];
  }));
}

function namesById(store: Store): Map<string, string> {
  const names = new Map<string, string>();
  const specs: Array<[CopyTable, string]> = [
    ['entity', 'name'], ['event', 'title'], ['fact', 'summary'], ['law', 'statement'],
    ['thread', 'name'], ['work', 'title'], ['realm', 'name'], ['scene', 'title'],
    ['chapter', 'title'],
  ];
  for (const [tableName, column] of specs) {
    const rows = store.sqlite.prepare(`select id, "${column}" as label from "${tableName}"`).all() as
      unknown as Array<{ id: string; label: string | null }>;
    for (const row of rows) if (row.label) names.set(row.id, row.label);
  }
  return names;
}

function displayValue(
  tableName: CopyTable, field: string, value: unknown, names: Map<string, string>,
): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' && names.has(value)) return names.get(value)!;
  if (typeof value === 'string') {
    const translated = BRANCH_VALUE_DA[`${tableName}.${field}`]?.[value];
    if (translated) return translated;
  }
  if (['earliest', 'latest', 'from_time', 'to_time', 'valid_from', 'valid_to'].includes(field)
    && typeof value === 'number') return formatInstant(value, 'minute');
  if (['duration_min', 'duration_max', 'offset_min', 'offset_max'].includes(field)
    && typeof value === 'number') return formatSpan(value);
  if (field === 'enabled' || field === 'symmetric') return value ? 'ja' : 'nej';
  return String(value);
}

function changedSummary(
  tableName: CopyTable, row: RawRow, other: RawRow, fields: string[], names: Map<string, string>,
  roots: Map<string, string>,
): [string, string] {
  const changed = fields.filter((field) => !same(
    canonicalValue(row[field] ?? null, roots), canonicalValue(other[field] ?? null, roots),
  ));
  const describe = (source: RawRow) => changed.map((field) =>
    `${FIELD_DA[field] ?? field}: ${displayValue(tableName, field, source[field], names)}`).join(' · ');
  return [describe(row), describe(other)];
}

function rowLabel(
  tableName: CopyTable, row: RawRow, names: Map<string, string>,
): string {
  if (tableName === 'relationship') {
    return `${names.get(String(row['from_entity_id'])) ?? 'Ukendt'} — ${row['kind']} — ${names.get(String(row['to_entity_id'])) ?? 'ukendt'}`;
  }
  if (tableName === 'temporal_link') {
    return `${names.get(String(row['from_event_id'])) ?? 'Ukendt event'} → ${names.get(String(row['to_event_id'])) ?? 'ukendt event'}`;
  }
  for (const field of ['name', 'title', 'summary', 'statement', 'predicate']) {
    if (typeof row[field] === 'string' && row[field]) return row[field] as string;
  }
  return '(uden navn)';
}

function proseDifference(left: string, right: string): ProseDifference {
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let end = 0;
  while (end < left.length - start && end < right.length - start
    && left[left.length - 1 - end] === right[right.length - 1 - end]) end += 1;
  const context = 90;
  return {
    before: left.slice(Math.max(0, start - context), start),
    removed: left.slice(start, left.length - end),
    added: right.slice(start, right.length - end),
    after: left.slice(left.length - end, Math.min(left.length, left.length - end + context)),
  };
}

function differenceId(kind: string, rootId: string): string {
  return `${kind}:${rootId}`;
}

function canRemove(store: Store, branchId: string, rowId: string): string | null {
  for (const tableName of COPY_ORDER) {
    const columns = store.sqlite.prepare(`pragma table_info("${tableName}")`).all() as
      unknown as Array<{ name: string }>;
    for (const { name } of columns) {
      if (name === 'id' || name === 'origin_id' || !name.endsWith('_id')) continue;
      const hit = store.sqlite.prepare(
        `select 1 from "${tableName}" where branch_id = ? and "${name}" = ? limit 1`,
      ).get(branchId, rowId);
      if (hit) return 'Andre oplysninger på denne gren bruger stadig posten.';
    }
  }
  return null;
}

function canAddAlone(tableName: CopyTable): string | null {
  if (tableName === 'entity') return 'En person eller ting skal overføres sammen med sine ben og øvrige forbindelser.';
  if (tableName === 'event') return 'Et event skal overføres sammen med deltagere og det, eventet afslører.';
  if (tableName === 'fact') return 'Et faktum skal overføres sammen med sine pladser og bindinger.';
  if (tableName === 'thread') return 'En plottråd skal overføres sammen med sine slag.';
  return null;
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
  const roots = rootsById(store);
  const names = namesById(store);
  const base = commonSnapshot(store, input.leftBranchId, input.rightBranchId);

  const conflictFor = (
    tableName: CopyTable, rootId: string, fields: string[], leftRow?: RawRow, rightRow?: RawRow,
  ) => {
    const baseRow = snapshotAtRoots(store, base, tableName).get(rootId);
    return !same(picked(leftRow, fields, roots), picked(baseRow, fields, roots))
      && !same(picked(leftRow, fields, roots), picked(rightRow, fields, roots));
  };

  const push = (item: Omit<BranchDifference, 'id'> & { id?: string }) => {
    differences.push({
      id: item.id ?? differenceId(item.kind, item.transfer?.type === 'row'
        ? item.transfer.rootId
        : item.transfer?.type === 'prose' || item.transfer?.type === 'scene_move'
          ? item.transfer.sceneRootId
          : item.transfer?.type === 'chapter_move'
            ? item.transfer.chapterRootId
            : item.transfer?.type === 'reveal'
              ? item.transfer.revealRootId
              : String(differences.length)),
      ...item,
    });
  };

  const leftChapterRows = rowsAtRoots(store, 'chapter', input.leftBranchId);
  const rightChapterRows = rowsAtRoots(store, 'chapter', input.rightBranchId);
  const leftSceneRows = rowsAtRoots(store, 'scene', input.leftBranchId);
  const rightSceneRows = rowsAtRoots(store, 'scene', input.rightBranchId);
  const leftRevealRows = rowsAtRoots(store, 'reveal', input.leftBranchId);
  const rightRevealRows = rowsAtRoots(store, 'reveal', input.rightBranchId);
  const rightChapters = new Map(right.chapters.map((item) => [item.rootId, item]));
  for (const item of left.chapters) {
    const other = rightChapters.get(item.rootId);
    if (other && item.position !== other.position) {
      const conflict = conflictFor(
        'chapter', item.rootId, ['position'],
        leftChapterRows.get(item.rootId), rightChapterRows.get(item.rootId),
      );
      push({
        kind: 'chapter_moved', label: item.title,
        left: `kapitel ${item.position}`, right: `kapitel ${other.position}`,
        section: 'fortaelling', conflict, canTransfer: true,
        transferNote: conflict ? 'Begge grene har flyttet kapitlet siden forgreningen.' : null,
        detail: null, transfer: { type: 'chapter_move', chapterRootId: item.rootId },
      });
    }
  }

  const leftScenes = new Map(left.scenes.map((item) => [item.rootId, item]));
  const rightScenes = new Map(right.scenes.map((item) => [item.rootId, item]));
  for (const item of left.scenes) {
    const other = rightScenes.get(item.rootId);
    if (!other) {
      push({
        kind: 'scene_removed', label: item.title, left: `nr. ${item.globalPosition}`, right: null,
        section: 'fortaelling', conflict: true, canTransfer: false,
        transferNote: 'En scene med prosa og forbindelser skal flyttes som en samlet pakke.',
        detail: null, transfer: null,
      });
      continue;
    }
    if (item.globalPosition !== other.globalPosition) {
      const conflict = conflictFor(
        'scene', item.rootId, ['chapter_id', 'position'],
        leftSceneRows.get(item.rootId), rightSceneRows.get(item.rootId),
      );
      push({
        kind: 'scene_moved', label: item.title,
        left: `nr. ${item.globalPosition}`, right: `nr. ${other.globalPosition}`,
        section: 'fortaelling', conflict, canTransfer: true,
        transferNote: conflict ? 'Begge grene har flyttet scenen siden forgreningen.' : null,
        detail: null, transfer: { type: 'scene_move', sceneRootId: item.rootId },
      });
    }
    if (item.title !== other.title) {
      const conflict = conflictFor(
        'scene', item.rootId, ['title'],
        leftSceneRows.get(item.rootId), rightSceneRows.get(item.rootId),
      );
      push({
        kind: 'scene_changed', label: item.title,
        left: item.title, right: other.title,
        section: 'fortaelling', conflict, canTransfer: true,
        transferNote: conflict ? 'Begge grene har ændret titlen siden forgreningen.' : null,
        detail: null,
        transfer: { type: 'row', tableName: 'scene', rootId: item.rootId, fields: ['title'] },
      });
    }
    if (item.markdown !== other.markdown) {
      const baseTexts = base.get('scene_text') ?? [];
      const baseText = baseTexts.find((text) => {
        if (!text['is_current'] || typeof text['scene_id'] !== 'string') return false;
        return (roots.get(text['scene_id']) ?? text['scene_id']) === item.rootId;
      });
      const baseMarkdown = typeof baseText?.['markdown'] === 'string' ? baseText['markdown'] : '';
      const leftMarkdown = item.markdown ?? '';
      const rightMarkdown = other.markdown ?? '';
      push({
        kind: 'scene_prose_changed', label: item.title,
        left: `${item.wordCount} ord`, right: `${other.wordCount} ord`,
        section: 'prosa',
        conflict: leftMarkdown !== baseMarkdown && leftMarkdown !== rightMarkdown,
        canTransfer: true,
        transferNote: leftMarkdown !== baseMarkdown && leftMarkdown !== rightMarkdown
          ? 'Begge grene har ændret prosaen siden forgreningen.'
          : 'Den nuværende tekst gemmes som en tidligere udgave.',
        detail: proseDifference(leftMarkdown, rightMarkdown),
        transfer: { type: 'prose', sceneRootId: item.rootId },
      });
    }
  }
  for (const item of right.scenes) {
    if (!leftScenes.has(item.rootId)) push({
      kind: 'scene_added', label: item.title, left: null, right: `nr. ${item.globalPosition}`,
      section: 'fortaelling', conflict: false, canTransfer: false,
      transferNote: 'En scene med prosa og forbindelser skal flyttes som en samlet pakke.',
      detail: null, transfer: null,
    });
  }

  const leftReveals = new Map(left.reveals.map((item) => [item.rootId, item]));
  const rightReveals = new Map(right.reveals.map((item) => [item.rootId, item]));
  for (const item of left.reveals) {
    const other = rightReveals.get(item.rootId);
    if (!other) {
      const reason = canRemove(store, input.leftBranchId, item.id);
      push({
        kind: 'reveal_removed', label: item.factSummary, left: item.sceneTitle, right: null,
        section: 'fortaelling', conflict: true, canTransfer: !reason,
        transferNote: reason ?? 'Afsløringen bliver fjernet fra denne gren.', detail: null,
        transfer: reason ? null : { type: 'row', tableName: 'reveal', rootId: item.rootId, fields: [] },
      });
      continue;
    }
    if (item.sceneRootId !== other.sceneRootId) {
      const conflict = conflictFor(
        'reveal', item.rootId, ['scene_id'],
        leftRevealRows.get(item.rootId), rightRevealRows.get(item.rootId),
      );
      push({
        kind: 'reveal_moved', label: item.factSummary, left: item.sceneTitle, right: other.sceneTitle,
        section: 'fortaelling', conflict, canTransfer: true,
        transferNote: conflict ? 'Begge grene har flyttet afsløringen siden forgreningen.' : null,
        detail: null,
        transfer: { type: 'reveal', revealRootId: item.rootId, fields: ['scene'] },
      });
    }
    // Sammenligningen læses af et menneske, så styrken skal stå på dansk her
    // og ikke som den engelske værdi, kolonnen gemmer.
    if (item.strength !== other.strength) {
      const conflict = conflictFor(
        'reveal', item.rootId, ['strength'],
        leftRevealRows.get(item.rootId), rightRevealRows.get(item.rootId),
      );
      push({
        kind: 'reveal_changed', label: item.factSummary,
        left: say(REVEAL_DA, item.strength), right: say(REVEAL_DA, other.strength),
        section: 'fortaelling', conflict, canTransfer: true,
        transferNote: conflict ? 'Begge grene har ændret styrken siden forgreningen.' : null,
        detail: null,
        transfer: { type: 'reveal', revealRootId: item.rootId, fields: ['strength'] },
      });
    }
  }
  for (const item of right.reveals) {
    if (!leftReveals.has(item.rootId)) push({
      kind: 'reveal_added', label: item.factSummary, left: null, right: item.sceneTitle,
      section: 'fortaelling', conflict: false, canTransfer: true, transferNote: null, detail: null,
      transfer: { type: 'row', tableName: 'reveal', rootId: item.rootId, fields: [] },
    });
  }

  for (const spec of MODEL_SPECS) {
    const leftRows = rowsAtRoots(store, spec.tableName, input.leftBranchId);
    const rightRows = rowsAtRoots(store, spec.tableName, input.rightBranchId);
    const allRoots = new Set([...leftRows.keys(), ...rightRows.keys()]);
    for (const rootId of allRoots) {
      const leftRow = leftRows.get(rootId);
      const rightRow = rightRows.get(rootId);
      if (!leftRow || !rightRow) {
        if (!spec.ownsExistence) continue;
        const present = leftRow ?? rightRow!;
        const operation = leftRow ? 'removed' : 'added';
        const reason = leftRow
          ? canRemove(store, input.leftBranchId, leftRow['id'] as string)
          : canAddAlone(spec.tableName);
        push({
          kind: `${spec.domain}_${operation}`,
          label: rowLabel(spec.tableName, present, names),
          left: leftRow ? 'findes' : null,
          right: rightRow ? 'findes' : null,
          section: spec.section,
          conflict: !!leftRow,
          canTransfer: !reason,
          transferNote: reason ?? (leftRow ? 'Posten bliver fjernet fra denne gren.' : null),
          detail: null,
          transfer: reason ? null : {
            type: 'row', tableName: spec.tableName, rootId, fields: [],
          },
        });
        continue;
      }
      if (same(picked(leftRow, spec.fields, roots), picked(rightRow, spec.fields, roots))) continue;
      const [leftSummary, rightSummary] = changedSummary(
        spec.tableName, leftRow, rightRow, spec.fields, names, roots,
      );
      const conflict = conflictFor(spec.tableName, rootId, spec.fields, leftRow, rightRow);
      push({
        kind: `${spec.domain}_changed`,
        label: rowLabel(spec.tableName, leftRow, names),
        left: leftSummary, right: rightSummary,
        section: spec.section, conflict, canTransfer: true,
        transferNote: conflict ? 'Begge veje har ændret denne oplysning siden deres fælles punkt.' : null,
        detail: null,
        transfer: { type: 'row', tableName: spec.tableName, rootId, fields: spec.fields },
      });
    }
  }

  return {
    left: { branch: leftBranch, workId: leftWorkId, ...left },
    right: { branch: rightBranch, workId: rightWorkId, ...right },
    differences,
  };
}

function targetIdsByRoot(store: Store, branchId: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const tableName of COPY_ORDER) {
    for (const row of rawRows(store, tableName, branchId)) {
      const id = row['id'] as string;
      result.set(lineageRoot(store, tableName, id), id);
    }
  }
  return result;
}

function mapValueToBranch(
  value: unknown, roots: Map<string, string>, targetIds: Map<string, string>, field: string,
): unknown {
  if (typeof value === 'string' && roots.has(value)) {
    const mapped = targetIds.get(roots.get(value)!);
    if (!mapped) throw new Error(`Kan ikke overføre: forbindelsen «${FIELD_DA[field] ?? field}» mangler på målgrenen.`);
    return mapped;
  }
  if (field === 'slot_ids' && typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed.map((item) => mapValueToBranch(item, roots, targetIds, field)));
      }
    } catch {
      // Leave malformed historical JSON untouched; the review reports it.
    }
  }
  return value;
}

export interface BranchTransferResult {
  differenceId: string;
  label: string;
  touched: number;
}

/**
 * Copies one explicitly selected difference from right into left.
 *
 * There is deliberately no "merge branches" operation. The comparison is
 * recalculated immediately before the write, the selected item is copied in
 * one change-log turn, and a conflict stays visible until the caller chooses
 * that exact item anyway.
 */
export function transferBranchDifference(
  session: Session,
  store: Store,
  input: {
    leftBranchId: string;
    rightBranchId: string;
    workId: string;
    differenceId: string;
  },
): BranchTransferResult {
  if (session.branchId !== input.leftBranchId) {
    throw new Error('Overførslen skal skrives på den gren, du arbejder på.');
  }
  const compared = compareBranches(store, input);
  const difference = compared.differences.find((item) => item.id === input.differenceId);
  if (!difference) throw new Error('Forskellen findes ikke længere. Sammenlign grenene igen.');
  if (!difference.canTransfer || !difference.transfer) {
    throw new Error(difference.transferNote ?? 'Denne forskel kan ikke overføres alene.');
  }
  const transfer = difference.transfer;
  const ctx: Context = {
    worldId: compared.left.branch.worldId,
    branchId: input.leftBranchId,
    workId: compared.left.workId,
    userId: null,
  };

  if (transfer.type === 'prose') {
    const targetScene = compared.left.scenes.find((item) => item.rootId === transfer.sceneRootId);
    const sourceScene = compared.right.scenes.find((item) => item.rootId === transfer.sceneRootId);
    if (!targetScene || !sourceScene) throw new Error('Scenen findes ikke længere på begge grene.');
    const sourceText = store.db.select().from(sceneText)
      .where(and(
        eq(sceneText.branchId, input.rightBranchId),
        eq(sceneText.sceneId, sourceScene.id),
        eq(sceneText.isCurrent, true),
      )).get();
    if (!sourceText) throw new Error('Kildegrenen har ingen aktuel tekst til scenen.');
    saveSceneText(session, ctx, store, {
      sceneId: targetScene.id,
      doc: sourceText.doc,
      markdown: sourceText.markdown ?? undefined,
      label: `Overført fra ${compared.right.branch.name}`,
    });
  } else if (transfer.type === 'scene_move') {
    const targetScene = compared.left.scenes.find((item) => item.rootId === transfer.sceneRootId);
    const sourceScene = compared.right.scenes.find((item) => item.rootId === transfer.sceneRootId);
    const sourceChapter = compared.right.chapters.find((item) =>
      item.scenes.some((candidate) => candidate.rootId === transfer.sceneRootId));
    const targetChapter = compared.left.chapters.find((item) => item.rootId === sourceChapter?.rootId);
    if (!targetScene || !sourceScene || !targetChapter) {
      throw new Error('Scenen eller dens kapitel findes ikke længere på målgrenen.');
    }
    moveScene(session, store, ctx, {
      sceneId: targetScene.id,
      targetChapterId: targetChapter.id,
      toIndex: Math.max(0, sourceScene.position - 1),
    });
  } else if (transfer.type === 'chapter_move') {
    const target = compared.left.chapters.find((item) => item.rootId === transfer.chapterRootId);
    const source = compared.right.chapters.find((item) => item.rootId === transfer.chapterRootId);
    if (!target || !source) throw new Error('Kapitlet findes ikke længere på begge grene.');
    moveChapter(session, store, ctx, target.id, Math.max(0, source.position - 1));
  } else if (transfer.type === 'reveal') {
    const target = compared.left.reveals.find((item) => item.rootId === transfer.revealRootId);
    const source = compared.right.reveals.find((item) => item.rootId === transfer.revealRootId);
    if (!target || !source) throw new Error('Afsløringen findes ikke længere på begge grene.');
    const targetScene = compared.left.scenes.find((item) => item.rootId === source.sceneRootId);
    moveReveal(session, store, ctx, {
      revealId: target.id,
      sceneId: transfer.fields.includes('scene')
        ? targetScene?.id ?? (() => { throw new Error('Afsløringens scene mangler på målgrenen.'); })()
        : target.sceneId,
      strength: transfer.fields.includes('strength')
        ? source.strength as OutlineReveal['strength'] as 'hinted' | 'implied' | 'stated' | 'confirmed'
        : undefined,
    });
  } else {
    const { tableName, rootId, fields } = transfer;
    const source = rowsAtRoots(store, tableName, input.rightBranchId).get(rootId);
    const target = rowsAtRoots(store, tableName, input.leftBranchId).get(rootId);
    const table = TABLES[tableName];
    if (!source && !target) throw new Error('Posten findes ikke længere på nogen af grenene.');
    if (!source && target) {
      const reason = canRemove(store, input.leftBranchId, target['id'] as string);
      if (reason) throw new Error(reason);
      session.remove(table, target['id'] as string);
    } else if (source && !target) {
      const roots = rootsById(store);
      const targetIds = targetIdsByRoot(store, input.leftBranchId);
      const copied: RawRow = {};
      for (const [field, value] of Object.entries(source)) {
        if (field === 'id') copied[field] = newId();
        else if (field === 'branch_id') copied[field] = input.leftBranchId;
        else if (field === 'origin_id') copied[field] = source['id'];
        else copied[field] = mapValueToBranch(value, roots, targetIds, field);
      }
      session.insertRaw(table, copied);
    } else if (source && target) {
      const roots = rootsById(store);
      const targetIds = targetIdsByRoot(store, input.leftBranchId);
      const next: RawRow = { ...target };
      for (const field of fields) {
        next[field] = mapValueToBranch(source[field], roots, targetIds, field);
      }
      session.replaceRaw(table, target['id'] as string, next);
    }
  }

  return { differenceId: difference.id, label: difference.label, touched: session.changeCount };
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
