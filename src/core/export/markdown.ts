import type { Block, Document, Run } from './document';

/**
 * Blocks as Markdown.
 *
 * Written by hand rather than pulled in as a dependency: the mark-up this
 * editor allows is a page long, and a converter that handled everything would
 * handle nothing here better.
 *
 * This is also what the editor uses when it saves. The Markdown kept beside
 * the prose and the Markdown that leaves the program as a reading edition are
 * the same text produced by the same code -- two of them would drift, and the
 * one nobody looked at would be the one search reads.
 */

function inline(runs: Run[]): string {
  return runs.map((run) => {
    if (run.lineBreak) return '  \n';
    let value = run.text;
    if (!value) return '';
    if (run.code) value = `\`${value}\``;
    if (run.bold) value = `**${value}**`;
    if (run.italic) value = `*${value}*`;
    if (run.strike) value = `~~${value}~~`;
    return value;
  }).join('');
}

function render(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(Math.min(Math.max(block.level, 1), 6))} ${inline(block.runs)}`;
    case 'paragraph':
      return inline(block.runs);
    case 'quote':
      return block.blocks.map((child) => `> ${render(child)}`).join('\n>\n');
    case 'list':
      return block.items.map((item, i) => {
        const body = item.map(render).join(' ');
        return block.ordered ? `${i + 1}. ${body}` : `- ${body}`;
      }).join('\n');
    case 'code':
      return `\`\`\`\n${block.text}\n\`\`\``;
    case 'separator':
      return '---';
  }
}

export function renderBlocks(blocks: Block[]): string {
  return blocks.map(render).filter(Boolean).join('\n\n').trim();
}

/** A whole reading edition: the title, then everything under it. */
export function toMarkdown(document: Document): string {
  const head: Block[] = [
    { kind: 'heading', level: 1, runs: [{ text: document.title }] },
    ...(document.subtitle
      ? [{ kind: 'paragraph', runs: [{ text: document.subtitle, italic: true }] } as Block]
      : []),
  ];
  return `${renderBlocks([...head, ...document.blocks])}\n`;
}
