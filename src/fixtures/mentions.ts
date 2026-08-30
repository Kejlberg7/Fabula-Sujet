import { and, eq } from 'drizzle-orm';
import type { Store } from '../db/client';
import { scene, sceneText, textAnchor, type ReferenceKind } from '../db/schema';
import { inTurn } from '../core/changelog';
import { createTextAnchor, saveSceneText } from '../core/services/narrative';
import { referenceCatalog } from '../core/queries/references';
import type { Context } from '../core/workbench';

/**
 * Turns words already standing in a fixture's prose into real mentions.
 *
 * This cannot happen while a fixture loads. A work reference -- P1, S1, G1 --
 * is handed out when the turn that created the target closes, so during the
 * load nothing has a code yet and the mark would have to be written blind.
 * So the mentions are placed afterwards, in a turn of their own, which is also
 * exactly what happens when the writer picks something from the @ menu.
 *
 * The same pass finishes the anchors the load already made: those were written
 * before any code existed, and without one the prose knows what it points at
 * but not what to call it.
 */
export interface MentionSpec {
  /** The scene's title on this branch. */
  scene: string;
  /** The exact words in the scene's prose that become the mention. */
  phrase: string;
  kind: ReferenceKind;
  /** The target's name, as the address book shows it. */
  name: string;
}

interface DocNode {
  type?: string;
  text?: string;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const clone = (doc: unknown): DocNode => JSON.parse(JSON.stringify(doc)) as DocNode;

const isAnchored = (node: DocNode): boolean =>
  (node.marks ?? []).some((mark) => mark.type === 'anchor');

/**
 * Wraps the first unanchored occurrence of `phrase` in an anchor mark.
 *
 * The text node is split rather than replaced, so whatever else the passage
 * carries -- emphasis, another anchor further along -- survives untouched.
 */
function wrapPhrase(node: DocNode, phrase: string, attrs: Record<string, unknown>): boolean {
  const children = node.content;
  if (!children) return false;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    if (child.type === 'text' && typeof child.text === 'string' && !isAnchored(child)) {
      const at = child.text.indexOf(phrase);
      if (at >= 0) {
        const before = child.text.slice(0, at);
        const after = child.text.slice(at + phrase.length);
        const marks = child.marks ?? [];
        const parts: DocNode[] = [];
        if (before) parts.push({ ...child, text: before });
        parts.push({ ...child, text: phrase, marks: [...marks, { type: 'anchor', attrs }] });
        if (after) parts.push({ ...child, text: after });
        children.splice(i, 1, ...parts);
        return true;
      }
    }
    if (wrapPhrase(child, phrase, attrs)) return true;
  }
  return false;
}

/** Writes the work reference into an anchor mark that was made without one. */
function stampCode(node: DocNode, markId: string, code: string, targetId: string): boolean {
  let hit = false;
  for (const mark of node.marks ?? []) {
    if (mark.type === 'anchor' && mark.attrs?.['markId'] === markId) {
      mark.attrs['code'] = code;
      mark.attrs['targetId'] = targetId;
      hit = true;
    }
  }
  for (const child of node.content ?? []) {
    if (stampCode(child, markId, code, targetId)) hit = true;
  }
  return hit;
}

export function placeMentions(store: Store, ctx: Context, specs: MentionSpec[]): void {
  inTurn(store, {
    branchId: ctx.branchId, actor: { kind: 'system' }, summary: 'Sæt omtaler i prosaen',
  }, (s) => {
    const catalog = referenceCatalog(store, ctx);
    const address = (kind: ReferenceKind, name: string) => {
      const hits = catalog.filter((item) => item.targetKind === kind && item.label === name);
      if (hits.length !== 1) {
        throw new Error(
          `Omtalen kan ikke placeres: ${hits.length} mål hedder «${name}» af typen ${kind}.`,
        );
      }
      return hits[0]!;
    };
    const byTarget = new Map(catalog.map((item) => [`${item.targetKind}:${item.targetId}`, item]));

    const current = (sceneId: string) => {
      const row = store.db.select().from(sceneText).where(and(
        eq(sceneText.sceneId, sceneId), eq(sceneText.isCurrent, true),
      )).get();
      if (!row) throw new Error('Scenen har ingen prosa at sætte en omtale i.');
      return row;
    };

    // Ankrene fra indlæsningen har et mål, men ingen kode: de blev skrevet, før
    // turen lukkede. De får den nu, så prosaen kan sige, hvad den peger på.
    for (const anchor of store.db.select().from(textAnchor)
      .where(eq(textAnchor.branchId, ctx.branchId)).all()) {
      const ref = byTarget.get(`${anchor.targetKind}:${anchor.targetId}`);
      if (!ref) continue;
      const row = current(anchor.sceneId);
      const doc = clone(row.doc);
      if (!stampCode(doc, anchor.markId, ref.code, anchor.targetId)) continue;
      saveSceneText(s, ctx, store, {
        sceneId: anchor.sceneId, doc, markdown: row.markdown ?? undefined,
      });
    }

    for (const spec of specs) {
      const scenes = store.db.select().from(scene).where(and(
        eq(scene.branchId, ctx.branchId), eq(scene.title, spec.scene),
      )).all();
      if (scenes.length !== 1) {
        throw new Error(`Omtalen kan ikke placeres: ${scenes.length} scener hedder «${spec.scene}».`);
      }
      const sceneId = scenes[0]!.id;
      const target = address(spec.kind, spec.name);
      const row = current(sceneId);
      const doc = clone(row.doc);
      const markId = `omtale-${sceneId}-${target.code}`.toLowerCase();
      const placed = wrapPhrase(doc, spec.phrase, {
        markId, kind: spec.kind, label: target.label,
        code: target.code, targetId: target.targetId,
      });
      if (!placed) {
        throw new Error(
          `Omtalen kan ikke placeres: «${spec.phrase}» står ikke i scenen «${spec.scene}».`,
        );
      }
      saveSceneText(s, ctx, store, { sceneId, doc, markdown: row.markdown ?? undefined });
      createTextAnchor(s, ctx, {
        sceneId, markId, targetKind: spec.kind, targetId: target.targetId,
        excerpt: spec.phrase,
      });
    }
  });
}
