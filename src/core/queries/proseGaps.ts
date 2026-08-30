import { eq } from 'drizzle-orm';
import type { Store } from '../../db/client';
import { textAnchor } from '../../db/schema';
import type { Context } from '../workbench';
import { currentText, scenesInScope, type ScopeKind } from '../services/reviews';
import { referenceCatalog, type ReferenceItem } from './references';

/**
 * What stands in the prose without standing in the bible.
 *
 * Two different gaps, and they are not the same kind of problem. A person who
 * has a record but no mention pointing at them is one click from being joined
 * up -- the writer simply wrote the name without reaching for the @ menu. A
 * name nobody has a record for is a decision waiting to be made: it may be a
 * character, or it may be a passer-by who never needs one.
 *
 * So both are reported, apart, and neither is called an error. Nothing here
 * writes: a mention is a mark in the manuscript, and a mark is only ever put
 * there by the writer clicking in the editor.
 */

export interface UnlinkedName {
  code: string;
  /** The record's name, as the address book shows it. */
  label: string;
  group: string;
  targetKind: string;
  targetId: string;
  entityKind: string | null;
  href: string | null;
  /** The words actually standing in the prose -- may be part of the full name. */
  phrase: string;
  count: number;
}

export interface UnknownName {
  phrase: string;
  count: number;
}

export interface SceneGaps {
  sceneId: string;
  title: string | null;
  chapterTitle: string;
  workTitle: string;
  position: number;
  /** Mentions the scene already carries. */
  linked: number;
  unlinked: UnlinkedName[];
  unknown: UnknownName[];
}

interface Run { text: string; anchored: boolean }

/** The scene's words, and which of them a mention already covers. */
function runsOf(doc: unknown): Run[] {
  const out: Run[] = [];
  const visit = (node: unknown, inAnchor: boolean): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; marks?: unknown[]; content?: unknown[] };
    if (n.type === 'text' && typeof n.text === 'string') {
      const marked = inAnchor || (Array.isArray(n.marks) && n.marks.some(
        (m) => (m as { type?: string })?.type === 'anchor',
      ));
      out.push({ text: n.text, anchored: marked });
      return;
    }
    const kids = Array.isArray(n.content) ? n.content : [];
    for (const kid of kids) visit(kid, inAnchor);
    // A block boundary reads as a sentence boundary, which is what decides
    // whether a capital letter is a name or merely the start of a sentence.
    if (kids.length) out.push({ text: '\n', anchored: false });
  };
  visit(doc, false);
  return out;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/**
 * Every whole-word occurrence of `needle`, with the Danish genitive counted in.
 *
 * «Sammys brev» is Sammy, not a second person called Sammys, and a report that
 * says otherwise teaches the writer to stop reading it.
 */
function occurrences(hay: string, needle: string): { at: number; length: number }[] {
  const hits: { at: number; length: number }[] = [];
  if (!needle) return hits;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    if (!isWordChar(hay[at - 1])) {
      const end = at + needle.length;
      if (!isWordChar(hay[end])) hits.push({ at, length: needle.length });
      else if (hay[end] === 's' && !isWordChar(hay[end + 1])) {
        hits.push({ at, length: needle.length + 1 });
      }
    }
    at = hay.indexOf(needle, at + 1);
  }
  return hits;
}

/**
 * The forms of a name a writer actually types.
 *
 * Full name always. For people and identities also the separate parts, because
 * a scene that has introduced Valdemar Sund calls him Valdemar for the next
 * three pages. Parts are only tried for people -- a place called «Det gamle
 * fyr» must not be found by the word «gamle» -- and only when every word of the
 * name is capitalised. «Den rejsende» is one name, not a man called Den.
 */
function namesOf(item: ReferenceItem): string[] {
  const full = item.label.trim();
  if (full.length < 3 || !/^\p{Lu}/u.test(full)) return [];
  const out = [full];
  const personal = item.targetKind === 'identity'
    || (item.targetKind === 'entity' && item.entityKind === 'person');
  const parts = full.split(/\s+/u);
  if (personal && parts.length > 1 && parts.every((part) => /^\p{Lu}/u.test(part))) {
    for (const part of parts) if (part.length >= 3) out.push(part);
  }
  return out;
}

/** Kinds whose label is a name rather than a sentence. */
const NAMED = new Set(['entity', 'identity', 'event']);

/** Capitals that are grammar, not names: formal and plural «you» in Danish. */
const NOT_A_NAME = new Set(['I', 'De', 'Dem', 'Deres', 'Jer', 'Jeres']);

const SENTENCE_END = new Set(['.', '!', '?', ':', '…', '\n']);
const OPENING = new Set(['»', '«', '"', '“', '”', "'", '‘', '’', '(', '-', '–', '—']);

/** Whether a capital at `at` merely begins a sentence. */
function startsSentence(plain: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && plain[i] === ' ') i -= 1;
  if (i < 0) return true;
  const ch = plain[i]!;
  return SENTENCE_END.has(ch) || OPENING.has(ch);
}

const CAPITAL_RUN = /\p{Lu}[\p{L}'’-]*(?: \p{Lu}[\p{L}'’-]*)*/gu;

function unknownNames(plain: string, masked: string): UnknownName[] {
  const counts = new Map<string, number>();
  for (const match of masked.matchAll(CAPITAL_RUN)) {
    const phrase = match[0];
    if (phrase.length < 2 || NOT_A_NAME.has(phrase)) continue;
    const words = phrase.split(' ').length;
    // A lone capital at the start of a sentence is just a sentence. Two
    // capitals in a row are not: Danish capitalises only the first word.
    if (words < 2 && startsSentence(plain, match.index)) continue;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  // «Valdemar» and «Valdemar Sund» are one unknown, not two.
  const phrases = [...counts.keys()].sort((a, b) => b.length - a.length);
  for (const short of phrases) {
    if (short.includes(' ')) continue;
    const longer = phrases.find((p) => p !== short && occurrences(p, short).length > 0);
    if (longer) {
      counts.set(longer, (counts.get(longer) ?? 0) + (counts.get(short) ?? 0));
      counts.delete(short);
    }
  }

  return [...counts.entries()]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase, 'da'))
    .slice(0, 12);
}

/** Names in the prose of every scene in a scope that no mention points at. */
export function proseGaps(
  store: Store, ctx: Context, input: { kind: ScopeKind; id: string },
): SceneGaps[] {
  const catalog = referenceCatalog(store, ctx)
    .filter((item) => item.exists && NAMED.has(item.targetKind));
  // Longest first, so «Valdemar Sund» is claimed before «Sund» can take it.
  const all = catalog.flatMap((item) => namesOf(item).map((name) => ({ item, name })))
    .sort((a, b) => b.name.length - a.name.length
      || a.name.localeCompare(b.name, 'da'));
  // Three Krags share a surname, so a bare «Krag» names none of them. Silence
  // beats confidently pointing at the wrong brother.
  const shared = new Set<string>();
  const owner = new Map<string, string>();
  for (const { item, name } of all) {
    const key = `${item.targetKind}:${item.targetId}`;
    const seen = owner.get(name);
    if (seen === undefined) owner.set(name, key);
    else if (seen !== key) shared.add(name);
  }
  const variants = all.filter(({ name }) => !shared.has(name));

  const anchorsByScene = new Map<string, Set<string>>();
  for (const row of store.db.select().from(textAnchor)
    .where(eq(textAnchor.branchId, ctx.branchId)).all()) {
    const seen = anchorsByScene.get(row.sceneId) ?? new Set<string>();
    seen.add(`${row.targetKind}:${row.targetId}`);
    anchorsByScene.set(row.sceneId, seen);
  }

  const out: SceneGaps[] = [];
  for (const sc of scenesInScope(store, ctx, input)) {
    const text = currentText(store, ctx, sc.sceneId);
    if (!text?.doc) continue;
    const runs = runsOf(text.doc);
    const plain = runs.map((r) => r.text).join('');
    if (!plain.trim()) continue;

    const here = anchorsByScene.get(sc.sceneId) ?? new Set<string>();
    let masked = runs.map((r) => (r.anchored ? ' '.repeat(r.text.length) : r.text)).join('');
    const found = new Map<string, UnlinkedName>();

    for (const { item, name } of variants) {
      const hits = occurrences(masked, name);
      if (hits.length === 0) continue;
      // Claimed either way: a name already anchored elsewhere in the scene must
      // not come back a second time as an unknown word.
      const chars = [...masked];
      for (const hit of hits) chars.fill(' ', hit.at, hit.at + hit.length);
      masked = chars.join('');

      const key = `${item.targetKind}:${item.targetId}`;
      if (here.has(key)) continue;
      const already = found.get(key);
      if (already) already.count += hits.length;
      else {
        found.set(key, {
          code: item.code, label: item.label, group: item.group,
          targetKind: item.targetKind, targetId: item.targetId,
          entityKind: item.entityKind, href: item.href,
          phrase: name, count: hits.length,
        });
      }
    }

    const unlinked = [...found.values()]
      .sort((a, b) => a.code.localeCompare(b.code, 'da', { numeric: true }));
    const unknown = unknownNames(plain, masked);
    if (unlinked.length === 0 && unknown.length === 0) continue;

    out.push({
      sceneId: sc.sceneId, title: sc.title, chapterTitle: sc.chapterTitle,
      workTitle: sc.workTitle, position: sc.position,
      linked: here.size, unlinked, unknown,
    });
  }
  return out;
}
