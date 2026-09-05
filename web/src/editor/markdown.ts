/**
 * The prose as Markdown -- the core's own rendering, not a second one.
 *
 * It used to live here, and that was the mistake: the export needed exactly
 * this and could not import a browser module, so a book leaving the program
 * was serialised by different code than the text search reads. Now both call
 * the same function, and an anchor is stripped in one place.
 */
export { countWords, toMarkdown } from '../../../src/core/export/prose';
