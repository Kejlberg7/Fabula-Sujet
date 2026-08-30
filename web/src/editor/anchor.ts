import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * A stretch of prose tied to something in the bible.
 *
 * The mark carries an id and nothing else that matters: the row in `text_anchor`
 * holds what it points at. That way the prose stays prose -- a document you
 * could paste into a word processor -- and the link survives every edit around
 * it, because ProseMirror moves marks with their text. A character offset would
 * not survive the next sentence you insert above it.
 */
export const Anchor = Mark.create({
  name: 'anchor',
  // Two anchors may cover the same words: a line can be both the moment he
  // realises it and the moment the reader is told.
  excludes: '',
  inclusive: false,

  addAttributes() {
    return {
      markId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-anchor'),
        renderHTML: (attributes) =>
          attributes['markId'] ? { 'data-anchor': attributes['markId'] as string } : {},
      },
      kind: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-kind'),
        renderHTML: (attributes) =>
          attributes['kind'] ? { 'data-kind': attributes['kind'] as string } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('title'),
        renderHTML: (attributes) =>
          attributes['label'] ? { title: attributes['label'] as string } : {},
      },
      code: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-code'),
        renderHTML: (attributes) =>
          attributes['code'] ? { 'data-code': attributes['code'] as string } : {},
      },
      targetId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-target'),
        renderHTML: (attributes) =>
          attributes['targetId'] ? { 'data-target': attributes['targetId'] as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-anchor]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'anchor' }), 0];
  },
});

/** Every anchor id still present in the document. What is missing has been cut. */
export function markIdsIn(doc: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { marks?: { type?: string; attrs?: Record<string, unknown> }[]; content?: unknown[] };
    for (const mark of n.marks ?? []) {
      if (mark.type === 'anchor' && typeof mark.attrs?.['markId'] === 'string') {
        found.add(mark.attrs['markId']);
      }
    }
    for (const child of n.content ?? []) walk(child);
  };
  walk(doc);
  return [...found];
}
