/**
 * The Danish surface words for the model's own enum values.
 *
 * Identifiers are English and the surface is Danish, which leaves exactly one
 * question open: what does `hinted` say to a reader? It used to be answered
 * three times in three files, and they disagreed -- «antydet» meant `hinted`
 * on one screen and `implied` on the next, which is worse than English would
 * have been. So the words live here, once, and both surfaces read from them.
 *
 * The decisions themselves are written down in `docs/ORDBOG.md`; this file is
 * where they are spelled. Adding a value means adding it in both places.
 *
 * Deliberately free of imports: the interface bundles this straight into the
 * browser, so nothing here may reach for the database or for Node.
 */

/** How much of a fact the reader has been handed. `reveal.strength`. */
export const REVEAL_DA: Record<string, string> = {
  hinted: 'vink', implied: 'antydet', stated: 'fortalt', confirmed: 'bekræftet',
};

/** What a source is. `source.kind`. */
export const SOURCE_KIND_DA: Record<string, string> = {
  note: 'note', link: 'link', pdf: 'PDF', article: 'artikel',
  image: 'billede', file: 'fil',
};

/** How firmly a person holds what they hold. `belief.strength`. */
export const BELIEF_DA: Record<string, string> = {
  knows: 'ved', convinced: 'overbevist', suspects: 'mistænker',
  mistaken: 'tror fejlagtigt', denies: 'benægter', unaware: 'uvidende',
};

/** Where a belief came from. `belief.source`. */
export const BELIEF_SOURCE_DA: Record<string, string> = {
  stated: 'nedskrevet', derived: 'var til stede', carried: 'bærer det på sig',
};

/** How a scene uses an event. `scene_event.mode`. */
export const MODE_DA: Record<string, string> = {
  dramatised: 'dramatiseret', mentioned: 'omtalt', implied: 'antydet',
};

/** Looks a value up and says it plainly when the word is missing. */
export const say = (words: Record<string, string>, value: string | null | undefined): string =>
  (value == null ? '' : words[value] ?? value);
