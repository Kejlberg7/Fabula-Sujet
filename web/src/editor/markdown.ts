/**
 * A Markdown rendering of the prose, kept beside the document.
 *
 * Not the source of truth -- the ProseMirror document is -- but it is what
 * search reads and what an export would use, and it means the text is never
 * locked inside one editor's JSON. Written by hand rather than pulled in as a
 * dependency: the mark-up this editor allows is a page long, and a converter
 * that handles everything would handle nothing here better.
 */

interface Node {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
  content?: Node[];
}

function inline(nodes: Node[] | undefined): string {
  return (nodes ?? []).map((node) => {
    if (node.type === 'hardBreak') return '  \n';
    let text = node.text ?? '';
    if (!text) return '';
    const has = (name: string) => node.marks?.some((m) => m.type === name);
    // Anchors deliberately leave no trace: they are apparatus, not writing.
    if (has('code')) text = `\`${text}\``;
    if (has('bold')) text = `**${text}**`;
    if (has('italic')) text = `*${text}*`;
    if (has('strike')) text = `~~${text}~~`;
    return text;
  }).join('');
}

function block(node: Node, depth = 0): string {
  switch (node.type) {
    case 'paragraph': return inline(node.content);
    case 'heading': return `${'#'.repeat(Number(node.attrs?.['level'] ?? 1))} ${inline(node.content)}`;
    case 'blockquote':
      return (node.content ?? []).map((c) => `> ${block(c, depth)}`).join('\n>\n');
    case 'horizontalRule': return '---';
    case 'codeBlock': return `\`\`\`\n${inline(node.content)}\n\`\`\``;
    case 'bulletList':
      return (node.content ?? []).map((li) => `- ${(li.content ?? []).map((c) => block(c, depth + 1)).join(' ')}`).join('\n');
    case 'orderedList':
      return (node.content ?? []).map((li, i) => `${i + 1}. ${(li.content ?? []).map((c) => block(c, depth + 1)).join(' ')}`).join('\n');
    default: return inline(node.content);
  }
}

export function toMarkdown(doc: unknown): string {
  const root = doc as Node | null;
  if (!root?.content) return '';
  return root.content.map((node) => block(node)).filter(Boolean).join('\n\n').trim();
}

export function countWords(markdown: string): number {
  return markdown.trim().split(/\s+/).filter(Boolean).length;
}
