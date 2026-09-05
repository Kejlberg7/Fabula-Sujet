import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { archiveRoot } from '../attachments';
import { tablesByName } from '../tables';
import { zipBytes, unzipBytes, type ZipEntry } from './zip';

/**
 * The whole workbench, in one file, and the way back.
 *
 * A backup is not a feature until it has been restored, so both directions
 * live here and are tested against each other: the roundtrip is the test, and
 * a backup that cannot be read back is a bug in the writing half.
 *
 * Two shapes, because they answer different questions. The JSON is every row
 * in every table, readable by anything and greppable in a pinch. The bundle is
 * that same JSON zipped together with the archive's files, which is what you
 * actually want when the disk dies -- a backup of a book that does not carry
 * the photographed page it argues from is only half a backup.
 *
 * Restoring is the one thing in the program that does not write through the
 * change log, and the reason is that it restores the log. The rows in `turn`
 * and `change` come back as themselves; passing them through a session would
 * make a new history whose contents claim to be the old one. It is safe
 * because it is refused on any database that already holds something: there
 * is never an existing history for it to damage.
 */

export const BACKUP_FORMAT = 'fabula-sujet-backup';
export const BACKUP_VERSION = 1;

/** A row exactly as the driver holds it: numbers, strings, nulls. */
type RawRow = Record<string, unknown>;

export interface BackupFile {
  format: string;
  version: number;
  createdAt: string;
  /**
   * Which migrations the database had run when the backup was taken.
   *
   * This is the version stamp that matters. A row written under one schema
   * cannot be trusted to fit another, and the honest thing to do about it is
   * to say so before touching anything rather than to fail halfway through.
   */
  schema: { fingerprint: string; migrations: number };
  tables: Record<string, RawRow[]>;
  /** The archive's files, so a bundle can be checked against the data. */
  files: { sourceId: string; filePath: string; byteSize: number | null; checksum: string | null }[];
}

const MANIFEST = 'backup.json';
const FILES = 'filer';

/** ZIP names always use forward slashes, whatever this machine calls a path. */
const zipName = (filePath: string) => `${FILES}/${filePath.split(sep).join('/')}`;

function schemaStamp(store: Store): { fingerprint: string; migrations: number } {
  const rows = store.sqlite
    .prepare('select hash from __drizzle_migrations order by created_at')
    .all() as { hash: string }[];
  return {
    fingerprint: createHash('sha256').update(rows.map((row) => row.hash).join('\n'))
      .digest('hex').slice(0, 12),
    migrations: rows.length,
  };
}

/** Every row in every table the schema knows about. */
export function backupData(store: Store): BackupFile {
  const tables: Record<string, RawRow[]> = {};
  for (const name of [...tablesByName.keys()].sort()) {
    tables[name] = store.sqlite.prepare(`select * from "${name}"`).all() as RawRow[];
  }
  const files = (tables['source'] ?? [])
    .filter((row) => typeof row['file_path'] === 'string')
    .map((row) => ({
      sourceId: row['id'] as string,
      filePath: row['file_path'] as string,
      byteSize: (row['byte_size'] as number | null) ?? null,
      checksum: (row['checksum'] as string | null) ?? null,
    }));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    schema: schemaStamp(store),
    tables,
    files,
  };
}

export function backupJson(store: Store): Buffer {
  return Buffer.from(`${JSON.stringify(backupData(store), null, 2)}\n`, 'utf8');
}

export interface Bundle {
  bytes: Buffer;
  rows: number;
  files: number;
  /** Files the data points at that were not in the archive to pack. */
  missing: string[];
}

/** The data and the archive's files, in one ZIP. */
export function backupBundle(store: Store): Bundle {
  const data = backupData(store);
  const root = archiveRoot(store);
  const entries: ZipEntry[] = [{
    name: MANIFEST,
    bytes: Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'),
  }];
  const missing: string[] = [];

  for (const file of data.files) {
    const path = root ? join(root, file.filePath) : null;
    if (!path || !existsSync(path)) {
      missing.push(file.filePath);
      continue;
    }
    // Bytes that are already compressed -- a PDF, a JPEG -- are stored rather
    // than deflated again. Reading them here is copying, not reading.
    entries.push({ name: zipName(file.filePath), bytes: readFileSync(path) });
  }

  return {
    bytes: zipBytes(entries),
    rows: Object.values(data.tables).reduce((sum, rows) => sum + rows.length, 0),
    files: entries.length - 1,
    missing,
  };
}

export interface BackupPreview {
  kind: 'zip' | 'json';
  createdAt: string;
  version: number;
  schema: { fingerprint: string; migrations: number };
  /** True when this backup's schema is the one this database speaks. */
  sameSchema: boolean;
  rows: number;
  worlds: {
    name: string;
    /** Distinct titles. A branch holds its own copy of every book. */
    works: string[];
    branches: number;
    scenes: number;
    words: number;
  }[];
  files: { inData: number; inArchive: number; missing: string[] };
  /** Everything worth knowing before saying yes, in the writer's language. */
  warnings: string[];
  /** False when this database already holds something. */
  canRestore: boolean;
}

interface Opened {
  kind: 'zip' | 'json';
  data: BackupFile;
  files: Map<string, Buffer>;
}

/** Reads a backup without touching anything. A ZIP starts with «PK». */
function open(input: Buffer): Opened {
  const isZip = input.byteLength > 4 && input.readUInt32LE(0) === 0x04034b50;
  if (!isZip) {
    return { kind: 'json', data: parse(input.toString('utf8')), files: new Map() };
  }
  const parts = unzipBytes(input);
  const manifest = parts.get(MANIFEST);
  if (!manifest) throw new Error(`Arkivet indeholder ingen «${MANIFEST}», så det er ikke en backup herfra.`);
  const files = new Map<string, Buffer>();
  for (const [name, bytes] of parts) {
    if (name.startsWith(`${FILES}/`)) files.set(name.slice(FILES.length + 1), bytes);
  }
  return { kind: 'zip', data: parse(manifest.toString('utf8')), files };
}

function parse(text: string): BackupFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Filen er ikke en backup: den kan ikke læses som JSON.');
  }
  const data = value as Partial<BackupFile>;
  if (data.format !== BACKUP_FORMAT) {
    throw new Error('Filen er ikke en backup fra Fabula & Sujet.');
  }
  if (data.version !== BACKUP_VERSION) {
    throw new Error(
      `Backuppen er af udgave ${String(data.version)}, og programmet kender kun ${BACKUP_VERSION}.`,
    );
  }
  if (!data.tables) throw new Error('Backuppen indeholder ingen data.');
  return data as BackupFile;
}

/**
 * What is in the file, and what would happen -- before anything happens.
 *
 * A restore replaces a life's work with a file, so the writer sees the file
 * first: which worlds, which books, how many scenes and words, whether the
 * attachments are in there too, and whether this database will even accept it.
 */
export function inspectBackup(store: Store, input: Buffer): BackupPreview {
  const { kind, data, files } = open(input);
  const table = (name: string): RawRow[] => data.tables[name] ?? [];

  // Books, scenes and words counted per world by walking the chain the model
  // itself uses. A total would be quicker and would say the wrong thing the
  // first time a backup holds two worlds.
  const worldOfWork = new Map(table('work').map((row) =>
    [row['id'] as string, row['world_id'] as string] as const));
  const worldOfChapter = new Map(table('chapter').map((row) =>
    [row['id'] as string, worldOfWork.get(row['work_id'] as string) ?? ''] as const));
  const worldOfScene = new Map(table('scene').map((row) =>
    [row['id'] as string, worldOfChapter.get(row['chapter_id'] as string) ?? ''] as const));

  const worlds = table('world').map((row) => {
    const id = row['id'] as string;
    const scenes = [...worldOfScene].filter(([, world]) => world === id).map(([scene]) => scene);
    const mine = new Set(scenes);
    return {
      name: row['name'] as string,
      // One title per book. Every branch holds its own copy of every row, so
      // counting work rows would say «Memento, Memento» about one novel.
      works: [...new Set(table('work').filter((work) => work['world_id'] === id)
        .map((work) => work['title'] as string))].sort((a, b) => a.localeCompare(b, 'da')),
      branches: table('branch').filter((row) => row['world_id'] === id).length,
      scenes: scenes.length,
      words: table('scene_text')
        .filter((text) => text['is_current'] && mine.has(text['scene_id'] as string))
        .reduce((sum, text) => sum + ((text['word_count'] as number | null) ?? 0), 0),
    };
  });

  const missing = data.files
    .filter((file) => kind === 'zip' && !files.has(file.filePath.split(sep).join('/')))
    .map((file) => file.filePath);

  const here = schemaStamp(store);
  const sameSchema = here.fingerprint === data.schema.fingerprint;
  const occupied = holdsSomething(store);

  const warnings: string[] = [];
  if (!sameSchema) {
    warnings.push(
      'Backuppen er lavet på en anden udgave af databasen end den, du står i '
      + `(${data.schema.migrations} trin mod ${here.migrations}). Rækkerne passer måske ikke i tabellerne.`,
    );
  }
  if (occupied) {
    warnings.push(
      'Databasen her er ikke tom. En genoprettelse lægger ikke oven i noget — '
      + 'peg den mod en tom database, så du har begge dele bagefter.',
    );
  }
  if (kind === 'json' && data.files.length > 0) {
    warnings.push(
      `Backuppen er kun data. ${data.files.length} vedhæftede filer bliver ikke `
      + 'hentet med, og de vil mangle i arkivet bagefter.',
    );
  }
  if (missing.length > 0) {
    warnings.push(`${missing.length} vedhæftede filer manglede allerede, da backuppen blev lavet.`);
  }

  return {
    kind,
    createdAt: data.createdAt,
    version: data.version,
    schema: data.schema,
    sameSchema,
    rows: Object.values(data.tables).reduce((sum, rows) => sum + rows.length, 0),
    worlds,
    files: { inData: data.files.length, inArchive: files.size, missing },
    warnings,
    canRestore: !occupied && sameSchema,
  };
}

/**
 * A database is «empty» when it holds no content of its own.
 *
 * `app_state` does not count: which world was last selected is a preference,
 * not work, and it is overwritten by the restore anyway.
 */
function holdsSomething(store: Store): boolean {
  for (const name of tablesByName.keys()) {
    if (name === 'app_state') continue;
    const row = store.sqlite.prepare(`select 1 from "${name}" limit 1`).get();
    if (row) return true;
  }
  return false;
}

export interface RestoreReport {
  rows: number;
  tables: number;
  files: number;
  worlds: string[];
}

export interface RestoreOptions {
  /**
   * Restores even though the backup was taken on another schema.
   *
   * Off by default and set by the writer, never by a caller being helpful:
   * the failure it lets through is a half-restored database, which is worse
   * than a refusal.
   */
  allowOtherSchema?: boolean;
}

export function restoreBackup(
  store: Store, input: Buffer, options: RestoreOptions = {},
): RestoreReport {
  const { data, files } = open(input);

  if (holdsSomething(store)) {
    throw new Error(
      'Databasen her er ikke tom, og en genoprettelse lægger ikke oven i noget. '
      + 'Peg den mod en tom database — så har du både det, du står i, og det, du henter tilbage.',
    );
  }
  const here = schemaStamp(store);
  if (here.fingerprint !== data.schema.fingerprint && !options.allowOtherSchema) {
    throw new Error(
      'Backuppen er lavet på en anden udgave af databasen end den, du står i '
      + `(${data.schema.migrations} trin mod ${here.migrations}). `
      + 'Genoprettelsen er stoppet, før den rørte noget.',
    );
  }

  let rows = 0;
  let tables = 0;
  store.db.transaction((tx) => {
    // Rows come back in whatever order they were dumped, and half of them
    // point at the other half. Deferring the check to the commit lets the
    // whole thing land at once and still fail loudly if it is not consistent.
    tx.run(sql`pragma defer_foreign_keys = on`);
    for (const [name, incoming] of Object.entries(data.tables)) {
      if (!tablesByName.has(name)) {
        throw new Error(`Backuppen indeholder tabellen «${name}», som programmet ikke kender.`);
      }
      if (incoming.length === 0) continue;
      tables += 1;
      for (const row of incoming) {
        const columns = Object.keys(row);
        store.sqlite.prepare(
          `insert into "${name}" (${columns.map((c) => `"${c}"`).join(', ')}) `
          + `values (${columns.map(() => '?').join(', ')})`,
        ).run(...columns.map((c) => row[c] as never));
        rows += 1;
      }
    }
  });

  let restored = 0;
  const root = archiveRoot(store);
  if (root) {
    for (const [name, bytes] of files) {
      const target = join(root, ...name.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      restored += 1;
    }
  }

  return {
    rows,
    tables,
    files: restored,
    worlds: (data.tables['world'] ?? []).map((row) => row['name'] as string),
  };
}
