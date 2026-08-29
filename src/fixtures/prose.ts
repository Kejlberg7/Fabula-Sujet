/**
 * Short passages for the fixtures, so the writing desk has something in it.
 *
 * These are written here rather than lifted from the films: a fixture needs
 * prose on the page to show what the desk does with it, and a few sentences of
 * our own do that job without borrowing anyone's.
 */
export function paragraphs(...texts: string[]): unknown {
  return {
    type: 'doc',
    content: texts.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

export const markdownOf = (...texts: string[]): string => texts.join('\n\n');
