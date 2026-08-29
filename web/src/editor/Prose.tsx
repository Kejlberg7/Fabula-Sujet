import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Anchor, markIdsIn } from './anchor';
import { countWords, toMarkdown } from './markdown';

export interface AnchorTarget {
  kind: 'event' | 'fact' | 'entity';
  id: string;
  label: string;
  group: string;
}

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';

/**
 * The manuscript, and the one place the writer's own words live.
 *
 * It saves itself a second after you stop typing and again when you leave, so
 * there is no save button to forget -- and every save keeps the previous draft,
 * so there is nothing to be careful about either. Nothing else in the app writes
 * here: the bible is data Claude may work in freely, the prose is the writer's.
 */
export function Prose({
  sceneId, initialDoc, targets, onSave, onAnchor, onAnchorsPruned,
}: {
  sceneId: string;
  initialDoc: unknown;
  targets: AnchorTarget[];
  onSave: (doc: unknown, markdown: string) => Promise<void>;
  onAnchor: (target: AnchorTarget, markId: string, excerpt: string) => Promise<void>;
  onAnchorsPruned: (markIds: string[]) => void;
}) {
  const [state, setState] = useState<SaveState>('clean');
  const [words, setWords] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const timer = useRef<number>(0);
  const pending = useRef<Editor | null>(null);

  const flush = useCallback(async (editor: Editor) => {
    window.clearTimeout(timer.current);
    pending.current = null;
    const doc = editor.getJSON();
    const markdown = toMarkdown(doc);
    setState('saving');
    try {
      await onSave(doc, markdown);
      setState('saved');
      onAnchorsPruned(markIdsIn(doc));
    } catch {
      setState('failed');
    }
  }, [onSave, onAnchorsPruned]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Anchor,
    ],
    content: (initialDoc as object | null) ?? '',
    editorProps: {
      attributes: {
        class: 'prose-surface',
        spellcheck: 'true',
        lang: 'da',
      },
    },
    onUpdate: ({ editor: e }) => {
      setState('dirty');
      setWords(countWords(toMarkdown(e.getJSON())));
      pending.current = e;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(e), 1200);
    },
    onSelectionUpdate: ({ editor: e }) => setHasSelection(!e.state.selection.empty),
  }, [sceneId]);

  useEffect(() => {
    if (editor) setWords(countWords(toMarkdown(editor.getJSON())));
  }, [editor]);

  // Leaving the scene, or the page, must not cost the last sentence.
  useEffect(() => () => {
    const e = pending.current;
    window.clearTimeout(timer.current);
    if (e && !e.isDestroyed) void flush(e);
  }, [flush]);

  const anchorSelection = async (target: AnchorTarget) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const excerpt = editor.state.doc.textBetween(from, to, ' ').slice(0, 240);
    const markId = crypto.randomUUID();
    editor.chain().focus()
      .setMark('anchor', { markId, kind: target.kind, label: target.label })
      .run();
    await onAnchor(target, markId, excerpt);
    void flush(editor);
  };

  const button = (label: string, active: boolean, run: () => void, title?: string) => (
    <button type="button" className={active ? 'tool on' : 'tool'} title={title}
      onMouseDown={(e) => e.preventDefault()} onClick={run}>{label}</button>
  );

  const groups = [...new Set(targets.map((t) => t.group))];

  return (
    <div className="prose-pane">
      <div className="prose-tools">
        {editor && (
          <>
            {button('B', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Fed')}
            {button('I', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Kursiv')}
            {button('H2', editor.isActive('heading', { level: 2 }), () =>
              editor.chain().focus().toggleHeading({ level: 2 }).run(), 'Overskrift')}
            {button('„“', editor.isActive('blockquote'), () =>
              editor.chain().focus().toggleBlockquote().run(), 'Citat')}
            {button('—', false, () => editor.chain().focus().setHorizontalRule().run(), 'Skille')}
          </>
        )}
        <span className="spacer" />
        <span className="dim mono">{words} ord</span>
        <span className={`savestate ${state}`}>
          {state === 'clean' && 'gemt'}
          {state === 'dirty' && 'skriver …'}
          {state === 'saving' && 'gemmer …'}
          {state === 'saved' && 'gemt'}
          {state === 'failed' && 'kunne ikke gemme'}
        </span>
      </div>

      <div className={hasSelection ? 'anchor-bar live' : 'anchor-bar'}>
        {hasSelection ? (
          <>
            <span className="dim">Knyt det markerede til:</span>
            <select
              value=""
              onChange={(e) => {
                const target = targets.find((t) => `${t.kind}:${t.id}` === e.target.value);
                if (target) void anchorSelection(target);
                e.target.value = '';
              }}
            >
              <option value="">vælg …</option>
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {targets.filter((t) => t.group === group).map((t) => (
                    <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>{t.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </>
        ) : (
          <span className="dim">
            Markér en passage for at knytte den til et event, et faktum eller en person.
          </span>
        )}
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
