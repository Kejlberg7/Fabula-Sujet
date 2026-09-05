/**
 * What a finished text is made of, before anyone decides which file it becomes.
 *
 * Markdown and DOCX are two renderings of the same thing, and the moment they
 * are built separately they start to disagree -- one keeps a scene break the
 * other drops, one strips the apparatus and the other forgets to. So the
 * export builds this instead: headings, paragraphs, runs. A renderer turns it
 * into bytes and decides nothing about the text itself.
 *
 * Deliberately small. It carries what the editor can actually produce and
 * nothing more; a model that could express everything Word can would be a
 * model nobody could render twice the same way.
 */

/** A stretch of text with the marks the editor allows. */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** A line break inside the paragraph. `text` is then ignored. */
  lineBreak?: boolean;
}

/**
 * How a paragraph sits on the page.
 *
 * `prose` is the writer's own sentences and gets a novel's first-line indent;
 * `prose_first` is the paragraph that opens a scene, which by convention does
 * not. `plain` is everything the program says in its own voice -- the
 * appendix -- and `note` is the same, quieter.
 */
export type ParagraphStyle = 'prose' | 'prose_first' | 'plain' | 'note';

export type Block =
  | { kind: 'heading'; level: number; runs: Run[]; startsPage?: boolean }
  | { kind: 'paragraph'; runs: Run[]; style?: ParagraphStyle }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; items: Block[][] }
  | { kind: 'code'; text: string }
  /** A scene break: white space with a mark in it, so the reader sees the jump. */
  | { kind: 'separator' };

export interface Document {
  title: string;
  /** The series, or the world, when the title alone does not place the book. */
  subtitle?: string;
  /** For the file's own properties. Never printed in the reading edition. */
  createdAt?: Date;
  blocks: Block[];
}

/** Shorthand for the appendix, which is written as blocks by hand. */
export const text = (value: string): Run[] => [{ text: value }];

export const para = (value: string, style: ParagraphStyle = 'plain'): Block =>
  ({ kind: 'paragraph', runs: text(value), style });

export const heading = (level: number, value: string, startsPage = false): Block =>
  ({ kind: 'heading', level, runs: text(value), ...(startsPage ? { startsPage } : {}) });

interface ProseNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
  content?: ProseNode[];
}

function runsOf(nodes: ProseNode[] | undefined): Run[] {
  const out: Run[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      out.push({ text: '', lineBreak: true });
      continue;
    }
    const value = node.text ?? '';
    if (!value) continue;
    // An anchor is apparatus, not writing, and this is the one place that is
    // decided: every reading edition goes through here, so no renderer can
    // let a mark id slip into the page by forgetting about it.
    const has = (name: string) => node.marks?.some((mark) => mark.type === name) ?? false;
    out.push({
      text: value,
      ...(has('bold') ? { bold: true } : {}),
      ...(has('italic') ? { italic: true } : {}),
      ...(has('strike') ? { strike: true } : {}),
      ...(has('code') ? { code: true } : {}),
    });
  }
  return out;
}

function blockOf(node: ProseNode): Block | null {
  switch (node.type) {
    case 'heading':
      return { kind: 'heading', level: Number(node.attrs?.['level'] ?? 1), runs: runsOf(node.content) };
    case 'blockquote':
      return { kind: 'quote', blocks: (node.content ?? []).map(blockOf).filter(isBlock) };
    case 'horizontalRule':
      return { kind: 'separator' };
    case 'codeBlock':
      return { kind: 'code', text: (node.content ?? []).map((c) => c.text ?? '').join('') };
    case 'bulletList':
    case 'orderedList':
      return {
        kind: 'list',
        ordered: node.type === 'orderedList',
        items: (node.content ?? []).map((li) => (li.content ?? []).map(blockOf).filter(isBlock)),
      };
    default:
      return { kind: 'paragraph', runs: runsOf(node.content) };
  }
}

const isBlock = (block: Block | null): block is Block => block != null;

/**
 * The editor's document, as blocks.
 *
 * ProseMirror JSON is the source of truth for the prose, so the export reads
 * that rather than the Markdown kept beside it -- the same decision the editor
 * makes when it saves.
 */
export function fromProse(doc: unknown): Block[] {
  const root = doc as ProseNode | null;
  if (!root?.content) return [];
  return root.content.map(blockOf).filter(isBlock);
}

/**
 * Marks the first prose paragraph of a passage, so it is not indented.
 *
 * A novel indents every paragraph except the one that opens a scene. That is
 * typography, not content, which is why it is applied here on the way out and
 * never stored.
 */
export function asProse(blocks: Block[]): Block[] {
  let first = true;
  return blocks.map((block) => {
    if (block.kind !== 'paragraph') return block;
    const style: ParagraphStyle = first ? 'prose_first' : 'prose';
    first = false;
    return { ...block, style };
  });
}
