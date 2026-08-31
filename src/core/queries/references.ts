import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import {
  chapter, entity, event, fact, identity, reveal, scene, storyReference,
  textAnchor, thread, work, type ReferenceKind,
} from '../../db/schema';
import type { Context } from '../workbench';

export interface ReferenceItem {
  id: string;
  code: string;
  targetKind: ReferenceKind;
  targetId: string;
  label: string;
  group: string;
  entityKind: string | null;
  exists: boolean;
  href: string | null;
  mentionCount: number;
}

function routeForEntity(kind: string, id: string): string | null {
  const view = kind === 'person' ? 'personer'
    : kind === 'place' ? 'steder'
      : kind === 'object' ? 'ting' : null;
  return view ? `${view}?id=${encodeURIComponent(id)}` : null;
}

/** The complete address book visible on the active story branch. */
export function referenceCatalog(store: Store, ctx: Context): ReferenceItem[] {
  const { db } = store;
  const refs = db.select().from(storyReference)
    .where(eq(storyReference.branchId, ctx.branchId)).all();
  const mentionCounts = new Map<string, number>();
  for (const anchor of db.select().from(textAnchor)
    .where(eq(textAnchor.branchId, ctx.branchId)).all()) {
    const key = `${anchor.targetKind}:${anchor.targetId}`;
    mentionCounts.set(key, (mentionCounts.get(key) ?? 0) + 1);
  }

  const entities = new Map(db.select().from(entity).all().map((item) => [item.id, item]));
  const identities = new Map(db.select().from(identity).all().map((item) => [item.id, item]));
  const events = new Map(db.select().from(event).all().map((item) => [item.id, item]));
  const facts = new Map(db.select().from(fact).all().map((item) => [item.id, item]));
  const reveals = new Map(db.select().from(reveal).all().map((item) => [item.id, item]));
  const scenes = new Map(db.select().from(scene).all().map((item) => [item.id, item]));
  const threads = new Map(db.select().from(thread).all().map((item) => [item.id, item]));

  const describe = (ref: typeof refs[number]): Omit<ReferenceItem, 'id' | 'code' | 'targetKind' | 'targetId' | 'mentionCount'> => {
    if (ref.targetKind === 'entity') {
      const item = entities.get(ref.targetId);
      // Er rækken væk, kan arten ikke læses -- og så hører referencen ikke
      // til under «Begreber». Den hører til under det, den er blevet: brudt.
      const group = !item ? 'Brudte'
        : item.kind === 'person' ? 'Personer'
          : item.kind === 'place' ? 'Steder'
            : item.kind === 'object' ? 'Genstande'
              : item.kind === 'organisation' ? 'Organisationer' : 'Begreber';
      return {
        label: item?.name ?? '(slettet entitet)', group,
        entityKind: item?.kind ?? null, exists: !!item,
        href: item ? routeForEntity(item.kind, item.id) : null,
      };
    }
    if (ref.targetKind === 'identity') {
      const item = identities.get(ref.targetId);
      const owner = item ? entities.get(item.entityId) : undefined;
      return {
        label: item?.name ?? '(slettet identitet)', group: 'Identiteter',
        entityKind: null, exists: !!item,
        href: owner ? routeForEntity(owner.kind, owner.id) : null,
      };
    }
    if (ref.targetKind === 'event') {
      const item = events.get(ref.targetId);
      return {
        label: item?.title ?? '(slettet event)', group: 'Events', entityKind: null,
        exists: !!item, href: item ? `events?id=${encodeURIComponent(item.id)}` : null,
      };
    }
    if (ref.targetKind === 'fact') {
      const item = facts.get(ref.targetId);
      return {
        label: item?.summary ?? '(slettet faktum)', group: 'Fakta', entityKind: null,
        exists: !!item, href: item ? `fakta?id=${encodeURIComponent(item.id)}` : null,
      };
    }
    if (ref.targetKind === 'reveal') {
      const item = reveals.get(ref.targetId);
      return {
        label: item ? `Afsløring: ${facts.get(item.factId)?.summary ?? '(ukendt faktum)'}` : '(slettet afsløring)',
        group: 'Afsløringer', entityKind: null, exists: !!item,
        href: item ? 'alternativer' : null,
      };
    }
    if (ref.targetKind === 'scene') {
      const item = scenes.get(ref.targetId);
      return {
        label: item?.title ?? (item ? '(scene uden titel)' : '(slettet scene)'),
        group: 'Scener', entityKind: null, exists: !!item,
        href: item ? `skrivebord?scene=${encodeURIComponent(item.id)}` : null,
      };
    }
    const item = threads.get(ref.targetId);
    return {
      label: item?.name ?? '(slettet plottråd)', group: 'Plottråde', entityKind: null,
      exists: !!item, href: item ? `kontinuitet?thread=${encodeURIComponent(item.id)}` : null,
    };
  };

  return refs.map((ref) => ({
    id: ref.id, code: ref.code, targetKind: ref.targetKind, targetId: ref.targetId,
    ...describe(ref),
    mentionCount: mentionCounts.get(`${ref.targetKind}:${ref.targetId}`) ?? 0,
  })).sort((a, b) => a.code.localeCompare(b.code, 'da', { numeric: true }));
}

/** Resolves P1, @P1 or another visible code on the current branch. */
export function referenceByCode(
  store: Store, ctx: Context, needle: string, kinds?: readonly ReferenceKind[],
) {
  const code = needle.trim().replace(/^@/, '').toUpperCase();
  const hit = store.db.select().from(storyReference).where(and(
    eq(storyReference.branchId, ctx.branchId), eq(storyReference.code, code),
  )).get();
  if (!hit || (kinds && !kinds.includes(hit.targetKind))) return null;
  return hit;
}

export interface ReferenceBacklink {
  anchorId: string;
  markId: string;
  excerpt: string | null;
  sceneId: string;
  sceneTitle: string;
  chapterTitle: string;
  workTitle: string;
  href: string;
}

/** Every piece of prose that points back at one concrete target. */
export function referenceBacklinks(
  store: Store, ctx: Context,
  input: { targetKind: string; targetId: string },
): ReferenceBacklink[] {
  const { db } = store;
  const scenes = new Map(db.select().from(scene).all().map((item) => [item.id, item]));
  const chapters = new Map(db.select().from(chapter).all().map((item) => [item.id, item]));
  const works = new Map(db.select().from(work).all().map((item) => [item.id, item]));
  return db.select().from(textAnchor).where(and(
    eq(textAnchor.branchId, ctx.branchId),
    eq(textAnchor.targetKind, input.targetKind as never),
    eq(textAnchor.targetId, input.targetId),
  )).all().map((anchor) => {
    const inScene = scenes.get(anchor.sceneId);
    const inChapter = inScene ? chapters.get(inScene.chapterId) : undefined;
    const inWork = inChapter ? works.get(inChapter.workId) : undefined;
    return {
      anchorId: anchor.id, markId: anchor.markId, excerpt: anchor.excerpt,
      sceneId: anchor.sceneId,
      sceneTitle: inScene?.title ?? '(scene uden titel)',
      chapterTitle: inChapter?.title ?? '(ukendt kapitel)',
      workTitle: inWork?.title ?? '(ukendt bog)',
      href: `skrivebord?scene=${encodeURIComponent(anchor.sceneId)}&mark=${encodeURIComponent(anchor.markId)}`,
    };
  });
}
