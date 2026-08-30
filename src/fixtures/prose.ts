/**
 * Short passages for the fixtures, so the writing desk has something in it.
 *
 * These are written here rather than lifted from the films: a fixture needs
 * prose on the page to show what the desk does with it, and a few sentences of
 * our own do that job without borrowing anyone's.
 */
export interface Anchored {
  text: string;
  /** The mark a text anchor -- and a margin note -- can address this passage by. */
  mark: { id: string; kind: 'event' | 'fact' | 'entity'; label: string };
}

export type Passage = string | Anchored;

const textOf = (passage: Passage): string =>
  (typeof passage === 'string' ? passage : passage.text);

export function paragraphs(...texts: Passage[]): unknown {
  return {
    type: 'doc',
    content: texts.map((passage) => ({
      type: 'paragraph',
      content: [{
        type: 'text',
        text: textOf(passage),
        ...(typeof passage === 'string' ? {} : {
          marks: [{
            type: 'anchor',
            attrs: {
              markId: passage.mark.id, kind: passage.mark.kind, label: passage.mark.label,
            },
          }],
        }),
      }],
    })),
  };
}

export const markdownOf = (...texts: Passage[]): string =>
  texts.map(textOf).join('\n\n');
