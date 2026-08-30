import {
  useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject,
} from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Anchor, markIdsIn } from './anchor';
import { countWords, toMarkdown } from './markdown';

export interface AnchorTarget {
  kind: 'event' | 'fact' | 'entity' | 'identity' | 'reveal' | 'scene' | 'thread';
  id: string;
  code: string;
  label: string;
  group: string;
  href: string | null;
}

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';

export interface ProseHandle {
  /**
   * Write an accepted wording into one anchored passage.
   *
   * Returns `missing` when the mark is no longer in the document -- the passage
   * has been rewritten or cut since the note was made, and there is nothing to
   * replace. Better to say so than to guess where the sentence used to be.
   */
  applyProposal(
    markId: string,
    text: string,
    commit: (doc: unknown, markdown: string) => Promise<void>,
  ): Promise<'ok' | 'missing'>;

  /**
   * Turn words already standing in the prose into a mention.
   *
   * The panel beside the text may notice that a name has no mention, but it may
   * not act on it -- this runs because the writer pressed the button, and it
   * only ever adds a mark. Not one letter of the manuscript changes.
   *
   * Returns `missing` when the words are no longer there, or are already inside
   * another mention: better to say so than to mark the wrong sentence.
   */
  anchorPhrase(phrase: string, target: AnchorTarget): Promise<'ok' | 'missing'>;
}

/**
 * Where an anchor sits in the document right now.
 *
 * ProseMirror moves marks with their text, so this is a lookup and never a
 * stored offset: the passage may have drifted a thousand characters since the
 * note was written, and it will still be found.
 */
function rangeOfMark(editor: Editor, markId: string): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const carries = node.marks.some((m) =>
      m.type.name === 'anchor' && m.attrs['markId'] === markId);
    if (carries) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  });
  return from < 0 ? null : { from, to };
}

/**
 * The manuscript, and the one place the writer's own words live.
 *
 * It saves itself a second after you stop typing and again when you leave, so
 * there is no save button to forget -- and every save keeps the previous draft,
 * so there is nothing to be careful about either. Nothing else in the app writes
 * here: the bible is data Claude may work in freely, the prose is the writer's.
 */
export function Prose({
  sceneId, initialDoc, targets, onSave, onAnchor, onAnchorsPruned, onOpenAnchor,
  focusMarkId, ref,
}: {
  sceneId: string;
  initialDoc: unknown;
  targets: AnchorTarget[];
  onSave: (doc: unknown, markdown: string) => Promise<void>;
  onAnchor: (target: AnchorTarget, markId: string, excerpt: string) => Promise<void>;
  onAnchorsPruned: (markIds: string[]) => void;
  onOpenAnchor: (markId: string) => void;
  focusMarkId?: string | null;
  ref?: RefObject<ProseHandle | null>;
}) {
  const [state, setState] = useState<SaveState>('clean');
  const [words, setWords] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const [mention, setMention] = useState<{
    from: number; to: number; query: string; left: number; top: number;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const timer = useRef<number>(0);
  const pending = useRef<Editor | null>(null);
  const openAnchor = useRef(onOpenAnchor);
  const mentionState = useRef<typeof mention>(null);
  const mentionChoices = useRef<AnchorTarget[]>([]);
  const activeMention = useRef(0);
  const chooseMention = useRef<(target: AnchorTarget) => void>(() => {});
  openAnchor.current = onOpenAnchor;

  const readMention = useCallback((e: Editor) => {
    const selection = e.state.selection;
    if (!selection.empty) { setMention(null); return; }
    const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, '\ufffc');
    const match = before.match(/(?:^|\s)@([^\s@]*)$/u);
    if (!match) { setMention(null); return; }
    const query = match[1] ?? '';
    const from = selection.from - query.length - 1;
    const at = e.view.coordsAtPos(selection.from);
    setMention({ from, to: selection.from, query, left: at.left, top: at.bottom + 6 });
    setMentionIndex(0);
  }, []);

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
      handleClick: (_view, _pos, event) => {
        const element = event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-anchor]') : null;
        const markId = element?.dataset['anchor'];
        if (!markId) return false;
        openAnchor.current(markId);
        return true;
      },
      // ProseMirror handles Enter itself and stops the DOM event before a
      // React handler on the surrounding pane sees it. Keep the mention
      // keyboard contract inside ProseMirror's own key pipeline instead.
      handleKeyDown: (_view, event) => {
        if (!mentionState.current || mentionChoices.current.length === 0) return false;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const next = (activeMention.current + 1) % mentionChoices.current.length;
          activeMention.current = next;
          setMentionIndex(next);
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const next = (activeMention.current - 1 + mentionChoices.current.length)
            % mentionChoices.current.length;
          activeMention.current = next;
          setMentionIndex(next);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          chooseMention.current(
            mentionChoices.current[activeMention.current] ?? mentionChoices.current[0]!,
          );
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          mentionState.current = null;
          setMention(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      setState('dirty');
      setWords(countWords(toMarkdown(e.getJSON())));
      pending.current = e;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(e), 1200);
      readMention(e);
    },
    onSelectionUpdate: ({ editor: e }) => {
      setHasSelection(!e.state.selection.empty);
      readMention(e);
    },
  }, [sceneId]);

  useEffect(() => {
    if (editor) setWords(countWords(toMarkdown(editor.getJSON())));
  }, [editor]);

  useEffect(() => {
    if (!editor || !focusMarkId) return;
    let attempts = 0;
    let finder = 0;
    let remover = 0;
    let focused: HTMLElement | null = null;
    const find = () => {
      focused = editor.view.dom.querySelector<HTMLElement>(
        `[data-anchor="${CSS.escape(focusMarkId)}"]`,
      );
      // TipTap gives us the Editor before EditorContent has necessarily put
      // its document into the DOM. A backlink must still land precisely, so
      // wait briefly for that normal mount sequence instead of giving up.
      if (!focused && attempts++ < 10) {
        finder = window.setTimeout(find, 40);
        return;
      }
      if (!focused) return;
      focused.scrollIntoView({ block: 'center', behavior: 'smooth' });
      focused.classList.add('anchor-focus');
      remover = window.setTimeout(() => focused?.classList.remove('anchor-focus'), 2400);
    };
    finder = window.setTimeout(find, 0);
    return () => {
      window.clearTimeout(finder);
      window.clearTimeout(remover);
      focused?.classList.remove('anchor-focus');
    };
  }, [editor, focusMarkId]);

  /**
   * Følg med, når prosaen skifter under editoren.
   *
   * Et fortryd henter en tidligere version af scenen tilbage, og uden det her
   * bliver editoren stående med den tekst, der lige er taget tilbage — og
   * gemmer den ind igen ved næste tastetryk. Så var fortryd ingenting værd.
   *
   * Kun når der ikke er noget uskrevet: den, der sidder og skriver, skal aldrig
   * få sine egne ord skiftet ud under hænderne.
   */
  useEffect(() => {
    if (!editor || state === 'dirty' || state === 'saving') return;
    const incoming = initialDoc as object | null;
    if (!incoming) return;
    if (toMarkdown(incoming) === toMarkdown(editor.getJSON())) return;
    editor.commands.setContent(incoming, { emitUpdate: false });
    setWords(countWords(toMarkdown(incoming)));
    setState('clean');
  }, [editor, initialDoc, state]);

  useImperativeHandle(ref, () => ({
    async applyProposal(markId, text, commit) {
      if (!editor) return 'missing';
      const range = rangeOfMark(editor, markId);
      if (!range) return 'missing';

      // Behold mærkerne fra passagens begyndelse, ankeret iblandt: en ny
      // formulering af den samme sætning er stadig det samme anker, og et
      // anker, der forsvinder her, ville blive ryddet ved næste gemning.
      const { state } = editor;
      const marks = state.doc.resolve(range.from + 1).marks();
      const wording = text.replace(/\s+/g, ' ').trim();
      editor.view.dispatch(
        state.tr.replaceWith(range.from, range.to, state.schema.text(wording, marks)),
      );

      // Udskiftningen udløste den almindelige autogemning. Den ville lægge
      // prosaen ind i sin egen tur, og så ville fortryd kun tage halvdelen.
      window.clearTimeout(timer.current);
      pending.current = null;

      const doc = editor.getJSON();
      const markdown = toMarkdown(doc);
      setWords(countWords(markdown));
      setState('saving');
      try {
        await commit(doc, markdown);
      } catch (error) {
        setState('failed');
        throw error;
      }
      setState('saved');
      // Ankeret er beholdt med vilje ovenfor, så der er intet at rydde op --
      // og en oprydning her ville lægge sig som en tom tur oven på gemningen.
      return 'ok';
    },

    async anchorPhrase(phrase, target) {
      if (!editor || !phrase) return 'missing';
      let hit: { from: number; to: number } | undefined;
      editor.state.doc.descendants((node, pos) => {
        if (hit) return false;
        if (!node.isText || !node.text) return true;
        // Et ord, der allerede ligger i en omtale, er ikke ledigt.
        if (node.marks.some((m) => m.type.name === 'anchor')) return false;
        const at = node.text.indexOf(phrase);
        if (at === -1) return true;
        hit = { from: pos + at, to: pos + at + phrase.length };
        return false;
      });
      if (!hit) return 'missing';

      const markId = crypto.randomUUID();
      editor.chain().focus().setTextSelection(hit)
        .setMark('anchor', {
          markId, kind: target.kind, label: target.label,
          code: target.code, targetId: target.id,
        })
        .setTextSelection(hit.to)
        .run();
      await onAnchor(target, markId, phrase);
      void flush(editor);
      return 'ok';
    },
  }), [editor, onAnchor, flush]);

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
      .setMark('anchor', {
        markId, kind: target.kind, label: target.label,
        code: target.code, targetId: target.id,
      })
      .run();
    await onAnchor(target, markId, excerpt);
    void flush(editor);
  };

  const mentionTargets = mention ? targets.map((target) => {
    const query = mention.query.toLocaleLowerCase('da');
    const code = target.code.toLocaleLowerCase('da');
    const label = target.label.toLocaleLowerCase('da');
    const rank = code.startsWith(query) ? 0
      : code.includes(query) ? 1
        : label.startsWith(query) ? 2
          : label.includes(query) ? 3 : 4;
    return { target, rank };
  }).filter(({ rank }) => rank < 4)
    .sort((a, b) => a.rank - b.rank
      || a.target.code.localeCompare(b.target.code, 'da', { numeric: true }))
    .slice(0, 10).map(({ target }) => target) : [];

  const insertMention = async (target: AnchorTarget) => {
    if (!editor || !mention) return;
    const markId = crypto.randomUUID();
    const mark = editor.state.schema.marks['anchor']!.create({
      markId, kind: target.kind, label: target.label,
      code: target.code, targetId: target.id,
    });
    editor.view.dispatch(editor.state.tr.replaceWith(
      mention.from, mention.to, editor.state.schema.text(target.label, [mark]),
    ));
    setMention(null);
    await onAnchor(target, markId, target.label);
    void flush(editor);
  };
  mentionState.current = mention;
  mentionChoices.current = mentionTargets;
  activeMention.current = mentionIndex;
  chooseMention.current = (target) => void insertMention(target);

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
                const target = targets.find((t) => `${t.kind}:${t.id}:${t.code}` === e.target.value);
                if (target) void anchorSelection(target);
                e.target.value = '';
              }}
            >
              <option value="">vælg …</option>
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {targets.filter((t) => t.group === group).map((t) => (
                    <option key={`${t.kind}:${t.id}:${t.code}`} value={`${t.kind}:${t.id}:${t.code}`}>
                      {t.code} · {t.label}
                    </option>
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
      {mention && (
        <div className="mention-menu" role="listbox" aria-label="Arbejdsreferencer"
          style={{ left: mention.left, top: mention.top }}>
          {mentionTargets.length === 0 ? (
            <div className="mention-empty">Ingen reference matcher @{mention.query}</div>
          ) : mentionTargets.map((target, index) => (
            <button type="button" role="option" aria-selected={index === mentionIndex}
              key={`${target.kind}:${target.id}:${target.code}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void insertMention(target)}>
              <span className="reference-code">{target.code}</span>
              <span>{target.label}</span>
              <small>{target.group}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
