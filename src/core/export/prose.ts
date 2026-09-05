import { fromProse } from './document';
import { renderBlocks } from './markdown';

/**
 * The Markdown rendering kept beside the prose.
 *
 * Not the source of truth -- the ProseMirror document is -- but it is what
 * search reads and what the export used to have to reinvent. It goes through
 * the same blocks and the same renderer as a finished book, which is the point:
 * anchors leave no trace in either, because they leave no trace in one place.
 *
 * Imports nothing but its two neighbours, so the browser bundle can have it.
 */
export function toMarkdown(doc: unknown): string {
  return renderBlocks(fromProse(doc));
}

export function countWords(markdown: string): number {
  return markdown.trim().split(/\s+/).filter(Boolean).length;
}
