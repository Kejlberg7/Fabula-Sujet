import { and, eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { chapter, law, realm, source, sourceLink } from '../../db/schema';
import type { Context } from '../workbench';
import { suggestionsFor } from '../services/suggestions';
import { sceneDesk } from './desk';

/**
 * The packet an AI needs in order to review one scene without inventing facts.
 *
 * Source files are still only stored and shown: this returns metadata and
 * writer-entered links, never extracts a PDF, article or image.
 */
export function manuscriptPacket(store: Store, ctx: Context, sceneId: string) {
  const { db } = store;
  const desk = sceneDesk(store, ctx, { sceneId });
  const ch = db.select().from(chapter).where(eq(chapter.id, desk.scene.chapterId)).get()!;

  const realmChain = new Set<string>();
  let currentRealm = desk.scene.realmId;
  while (currentRealm && !realmChain.has(currentRealm)) {
    realmChain.add(currentRealm);
    currentRealm = db.select().from(realm).where(eq(realm.id, currentRealm)).get()?.parentRealmId ?? null;
  }

  const laws = db.select().from(law).where(and(
    eq(law.branchId, ctx.branchId), eq(law.enabled, true),
  )).all().filter((item) => {
    const scope = item.scopeKind === 'world'
      || (item.scopeKind === 'work' && item.scopeId === ch.workId)
      || (item.scopeKind === 'realm' && item.scopeId != null && realmChain.has(item.scopeId))
      || item.scopeKind === 'series';
    if (!scope) return false;
    if (item.subjectKind === 'everyone') return true;
    if (item.subjectKind === 'entity') return item.subjectEntityId === desk.pov?.entityId;
    if (item.subjectKind === 'entity_kind') return item.subjectExpression === 'person';
    return item.subjectKind === 'carrier_holder';
  });

  const targets = new Set<string>([
    `scene:${sceneId}`, `work:${ch.workId}`,
    ...desk.tells.map((item) => `event:${item.eventId}`),
    ...desk.reveals.map((item) => `fact:${item.factId}`),
    ...laws.map((item) => `law:${item.id}`),
  ]);
  const links = db.select().from(sourceLink)
    .where(eq(sourceLink.branchId, ctx.branchId)).all()
    .filter((item) => targets.has(`${item.targetKind}:${item.targetId}`));
  const sources = links.map((link) => {
    const item = db.select().from(source).where(eq(source.id, link.sourceId)).get();
    return item ? {
      id: item.id, title: item.title, kind: item.kind, url: item.url,
      filePath: item.filePath, note: item.note,
      backs: { kind: link.targetKind, id: link.targetId, quote: link.quote, note: link.note },
    } : null;
  }).filter((item): item is NonNullable<typeof item> => item != null);

  return {
    ...desk,
    laws: laws.map((item) => ({
      id: item.id, kind: item.kind, hardness: item.hardness,
      ruleCode: item.ruleCode, statement: item.statement,
    })),
    sources,
    suggestions: suggestionsFor(store, ctx, { sceneId }),
  };
}
