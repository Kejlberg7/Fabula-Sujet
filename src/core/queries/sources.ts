import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { archiveRoot } from '../attachments';
import type { Store } from '../../db/client';
import {
  chapter, entity, event, fact, law, scene, source, sourceLink, work,
} from '../../db/schema';
import type { Context } from '../workbench';

export type SourceTargetKind = 'fact' | 'law' | 'event' | 'entity' | 'scene' | 'work';

export interface ShelfLink {
  id: string;
  targetKind: SourceTargetKind;
  targetId: string;
  /** What the target is called. Null when the row it points at is gone. */
  label: string | null;
  relation: 'supports' | 'context' | 'conflicts';
  quote: string | null;
  note: string | null;
}

export interface ShelfItem {
  id: string;
  title: string;
  kind: 'note' | 'link' | 'pdf' | 'article' | 'image' | 'file';
  url: string | null;
  filePath: string | null;
  /** What the file was called before it was filed. Null when nothing is attached. */
  originalName: string | null;
  mimeType: string | null;
  byteSize: number | null;
  /**
   * The cheap check: is the file there, and is it still the size it was?
   *
   * Null when there is no file. The thorough check reads the bytes back and
   * compares checksums, and that one is asked for -- see `checkAttachments`.
   */
  fileState: 'ok' | 'mangler' | 'beskadiget' | 'intet_arkiv' | null;
  note: string | null;
  createdAt: Date;
  backs: ShelfLink[];
  /** Marked by the writer as possibly contradicting something in the model. */
  conflicts: number;
  /** Saved, and then never tied to anything. The shelf exists to show these. */
  unused: boolean;
}

/**
 * What a source reference points at, in the writer's own words.
 *
 * The label is looked up, never derived from the file: a source is stored and
 * shown, and this is the shown part. A missing label means the target was
 * deleted after the reference was made, which is worth seeing rather than
 * hiding -- the reference is now pointing at nothing.
 */
export function labelForTarget(
  store: Store, kind: SourceTargetKind, id: string,
): string | null {
  const { db } = store;
  switch (kind) {
    case 'fact': return db.select().from(fact).where(eq(fact.id, id)).get()?.summary ?? null;
    case 'law': return db.select().from(law).where(eq(law.id, id)).get()?.statement ?? null;
    case 'event': return db.select().from(event).where(eq(event.id, id)).get()?.title ?? null;
    case 'entity': return db.select().from(entity).where(eq(entity.id, id)).get()?.name ?? null;
    case 'work': return db.select().from(work).where(eq(work.id, id)).get()?.title ?? null;
    case 'scene': {
      const row = db.select().from(scene).where(eq(scene.id, id)).get();
      if (!row) return null;
      const ch = db.select().from(chapter).where(eq(chapter.id, row.chapterId)).get();
      return [ch ? `Kap. ${ch.position}` : null, row.title ?? ch?.title ?? 'Scene']
        .filter(Boolean).join(' · ');
    }
    default: return null;
  }
}

/**
 * The research shelf: everything saved, and what it is actually holding up.
 *
 * A source belongs to the world and its references belong to a branch, so the
 * same photographed page can back one thing on the main line and something else
 * on an alternative -- and moving the reference is a change like any other.
 *
 * The list is sorted so the two questions the shelf is for come first: what did
 * I mark as a possible contradiction, and what did I save and then forget.
 */
export function sourceShelf(store: Store, ctx: Context): ShelfItem[] {
  const { db } = store;
  const links = db.select().from(sourceLink)
    .where(eq(sourceLink.branchId, ctx.branchId)).all();

  const bySource = new Map<string, ShelfLink[]>();
  for (const link of links) {
    const list = bySource.get(link.sourceId) ?? [];
    list.push({
      id: link.id,
      targetKind: link.targetKind,
      targetId: link.targetId,
      label: labelForTarget(store, link.targetKind, link.targetId),
      relation: link.relation,
      quote: link.quote,
      note: link.note,
    });
    bySource.set(link.sourceId, list);
  }

  const root = archiveRoot(store);
  const stateOf = (row: typeof source.$inferSelect): ShelfItem['fileState'] => {
    if (!row.filePath) return null;
    if (!root) return 'intet_arkiv';
    const path = join(root, row.filePath);
    if (!existsSync(path)) return 'mangler';
    return row.byteSize != null && statSync(path).size !== row.byteSize ? 'beskadiget' : 'ok';
  };

  return db.select().from(source).where(eq(source.worldId, ctx.worldId)).all()
    .map((row): ShelfItem => {
      const backs = bySource.get(row.id) ?? [];
      return {
        id: row.id, title: row.title, kind: row.kind, url: row.url,
        filePath: row.filePath, originalName: row.originalName,
        mimeType: row.mimeType, byteSize: row.byteSize, fileState: stateOf(row),
        note: row.note, createdAt: row.createdAt,
        backs,
        conflicts: backs.filter((b) => b.relation === 'conflicts').length,
        unused: backs.length === 0,
      };
    })
    .sort((a, b) => (b.conflicts - a.conflicts)
      || (Number(b.unused) - Number(a.unused))
      || a.title.localeCompare(b.title, 'da'));
}
