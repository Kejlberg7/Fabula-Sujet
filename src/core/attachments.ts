import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Store } from '../db/client';
import { source } from '../db/schema';
import type { Session } from './changelog';
import type { Context } from './workbench';

/**
 * The project's own file archive.
 *
 * A research file used to be a path the writer typed in, and a path is a
 * promise nobody made: move the file, rename a folder, empty a downloads
 * directory, and the reference points into thin air without the program ever
 * noticing. So the file is copied in and kept beside the database, and what is
 * recorded about it -- original name, type, size, checksum -- is enough to say
 * later whether the bytes are still the ones that were filed.
 *
 * Two things this deliberately does not do.
 *
 * It never reads a file. Copying bytes and hashing them is not reading: no
 * text is extracted, no page is recognised, no PDF is parsed. What the rules
 * act on is still only the writer's own marking of the source.
 *
 * And the bytes live outside the change log. Every row here goes through
 * `Session` like everything else, but the copy in the archive does not: an
 * undo restores the row and leaves the file alone. That is the safe
 * direction. Undo is for the model; a file the writer put there is theirs, and
 * removing it is a separate, explicit act -- see `detachFile`.
 */

/** Files an attachment may be shown inline. Everything else is downloaded. */
const INLINE = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain',
]);

/**
 * Type from the file's name, never from its contents.
 *
 * SVG is missing on purpose, and so is anything HTML-shaped: they are
 * documents that can run code, and «vist sikkert» would stop being true the
 * moment one of them was rendered inline. They can still be filed; they are
 * handed over as a download.
 */
const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.rtf': 'application/rtf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.epub': 'application/epub+zip',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
  '.htm': 'text/html',
};

export function typeForName(name: string): string {
  return TYPES[extname(name).toLocaleLowerCase('en')] ?? 'application/octet-stream';
}

export function safeInline(mimeType: string | null): boolean {
  return !!mimeType && INLINE.has(mimeType);
}

/**
 * Where this database keeps its files: `fabula.db` → `fabula-filer/`.
 *
 * Null for an in-memory database, which has nowhere to put anything. Callers
 * must say so plainly rather than inventing a directory somewhere.
 */
export function archiveRoot(store: Store): string | null {
  if (store.sqlite.memory) return null;
  const file = resolve(store.sqlite.name);
  const stem = basename(file).replace(/\.[^.]+$/, '');
  return join(dirname(file), `${stem}-filer`);
}

/** The absolute path of a stored file, or null when there is no archive. */
export function attachedPath(store: Store, filePath: string): string | null {
  const root = archiveRoot(store);
  return root ? join(root, filePath) : null;
}

/**
 * A name that is safe to put on a disk and still recognisable.
 *
 * Path separators and leading dots go: a file called `../../.ssh/config` must
 * land in the archive as a file, not somewhere else entirely.
 */
function safeName(name: string): string {
  const cleaned = basename(name).replace(/[/\\]/g, '-').replace(/^\.+/, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'fil';
}

export interface AttachedFile {
  filePath: string;
  originalName: string;
  checksum: string;
  mimeType: string;
  byteSize: number;
}

/**
 * Copies bytes into the archive and records them on the source.
 *
 * The file is written first and the row second. An interrupted attach then
 * leaves a copy nothing points at, which `orphanFiles` lists and the writer
 * can remove -- the other order would leave a source pointing at nothing,
 * which is the exact failure this phase exists to end.
 */
export function attachBytes(
  store: Store, session: Session, ctx: Context,
  input: { sourceId: string; name: string; bytes: Buffer },
): AttachedFile {
  const root = archiveRoot(store);
  if (!root) {
    throw new Error('Databasen ligger kun i hukommelsen, så der er ingen mappe at lægge filen i.');
  }
  const row = store.db.select().from(source).where(eq(source.id, input.sourceId)).get();
  if (!row) throw new Error('Kilden findes ikke.');
  if (row.worldId !== ctx.worldId) throw new Error('Kilden hører til en anden verden.');

  const originalName = safeName(input.name);
  const filePath = join(input.sourceId, originalName);
  const target = join(root, filePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, input.bytes);

  const facts: AttachedFile = {
    filePath,
    originalName,
    checksum: createHash('sha256').update(input.bytes).digest('hex'),
    mimeType: typeForName(originalName),
    byteSize: input.bytes.byteLength,
  };
  session.update(source, input.sourceId, { ...facts });
  return facts;
}

/** The same, for a file already on this machine. Its bytes are copied, not linked. */
export function attachFile(
  store: Store, session: Session, ctx: Context,
  input: { sourceId: string; path: string },
): AttachedFile {
  const from = resolve(input.path);
  if (!existsSync(from) || !statSync(from).isFile()) {
    throw new Error(`Der ligger ingen fil på «${input.path}».`);
  }
  return attachBytes(store, session, ctx, {
    sourceId: input.sourceId, name: basename(from), bytes: readFileSync(from),
  });
}

export type AttachmentState = 'ok' | 'mangler' | 'beskadiget' | 'ulaeselig' | 'intet_arkiv';

export interface AttachmentCheck {
  sourceId: string;
  title: string;
  filePath: string;
  originalName: string | null;
  state: AttachmentState;
  /** What the file looks like now, when that differs from what was filed. */
  byteSize: number | null;
  note: string;
}

/**
 * Reads every stored file back and compares it with what was filed.
 *
 * This is the thorough check and it is asked for, not run in passing: hashing
 * every attachment on every review would make the review slow for an answer
 * that changes about once a year. The cheap half -- is the file there at all,
 * is it still the size it was -- is a rule, and that runs every time.
 */
export function checkAttachments(store: Store, ctx: Context): AttachmentCheck[] {
  const root = archiveRoot(store);
  const rows = store.db.select().from(source).where(eq(source.worldId, ctx.worldId)).all()
    .filter((row) => !!row.filePath);
  return rows.map((row): AttachmentCheck => {
    const base = {
      sourceId: row.id, title: row.title, filePath: row.filePath!,
      originalName: row.originalName, byteSize: null as number | null,
    };
    if (!root) {
      return { ...base, state: 'intet_arkiv', note: 'Databasen ligger kun i hukommelsen.' };
    }
    const path = join(root, row.filePath!);
    if (!existsSync(path)) {
      return { ...base, state: 'mangler', note: 'Filen ligger ikke i arkivet længere.' };
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      return {
        ...base, state: 'ulaeselig',
        note: `Filen kan ikke åbnes: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (row.checksum && checksum !== row.checksum) {
      return {
        ...base, state: 'beskadiget', byteSize: bytes.byteLength,
        note: 'Filen er ikke længere den, der blev lagt ind. Indholdet er ikke blevet læst.',
      };
    }
    return { ...base, state: 'ok', byteSize: bytes.byteLength, note: 'Uændret siden den blev lagt ind.' };
  });
}

/**
 * Files in the archive that no source points at.
 *
 * They turn up when an attach is undone: the row goes back, the copy stays.
 * Listing them is the whole answer -- nothing here deletes anything on its
 * own, because a file the writer put there is not the program's to throw away.
 */
export function orphanFiles(store: Store): { filePath: string; byteSize: number }[] {
  const root = archiveRoot(store);
  if (!root || !existsSync(root)) return [];
  const known = new Set(store.db.select().from(source).all()
    .map((row) => row.filePath)
    .filter((path): path is string => !!path));
  const out: { filePath: string; byteSize: number }[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? join(prefix, item.name) : item.name;
      if (item.isDirectory()) walk(join(dir, item.name), relative);
      else if (!known.has(relative)) {
        out.push({ filePath: relative, byteSize: statSync(join(dir, item.name)).size });
      }
    }
  };
  walk(root, '');
  return out;
}

export interface Detached {
  /** Whether the copy in the archive was actually removed. */
  fileRemoved: boolean;
  filePath: string;
}

/**
 * Two actions, deliberately.
 *
 * Letting go of the reference is undoable and touches only the row. Removing
 * the file is not, and it is asked for separately, because there is no undo
 * for `rm` and the program should not pretend otherwise.
 */
export function detachFile(
  store: Store, session: Session, ctx: Context,
  input: { sourceId: string; removeFile?: boolean },
): Detached {
  const row = store.db.select().from(source).where(eq(source.id, input.sourceId)).get();
  if (!row) throw new Error('Kilden findes ikke.');
  if (row.worldId !== ctx.worldId) throw new Error('Kilden hører til en anden verden.');
  if (!row.filePath) throw new Error('Der er ingen fil på kilden.');

  const filePath = row.filePath;
  session.update(source, input.sourceId, {
    filePath: null, originalName: null, checksum: null, mimeType: null, byteSize: null,
  });

  if (!input.removeFile) return { fileRemoved: false, filePath };
  const root = archiveRoot(store);
  const path = root ? join(root, filePath) : null;
  if (path && existsSync(path)) {
    rmSync(path);
    const folder = dirname(path);
    // The source's own folder goes with its last file; anything else stays.
    if (folder !== root && existsSync(folder) && readdirSync(folder).length === 0) rmSync(folder, { recursive: true });
  }
  return { fileRemoved: true, filePath };
}

export interface StoredFile {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
  /** False when the type is one a browser must not render in place. */
  inline: boolean;
}

/** The bytes, handed over exactly as they were filed. Nothing is parsed. */
export function readAttachment(store: Store, ctx: Context, sourceId: string): StoredFile {
  const row = store.db.select().from(source).where(eq(source.id, sourceId)).get();
  if (!row || row.worldId !== ctx.worldId) throw new Error('Kilden findes ikke.');
  if (!row.filePath) throw new Error('Der er ingen fil på kilden.');
  const path = attachedPath(store, row.filePath);
  if (!path || !existsSync(path)) throw new Error('Filen ligger ikke i arkivet længere.');
  const mimeType = row.mimeType ?? typeForName(row.originalName ?? row.filePath);
  return {
    bytes: readFileSync(path),
    mimeType,
    originalName: row.originalName ?? basename(row.filePath),
    inline: safeInline(mimeType),
  };
}
