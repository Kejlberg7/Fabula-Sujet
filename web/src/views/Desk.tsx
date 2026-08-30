import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import { formatInstant, MODE_DA, SOURCE_DA, STRENGTH_DA } from '../format';
import { Prose, type AnchorTarget, type ProseHandle } from '../editor/Prose';
import type { Notice } from '../main';

const NARRATION_DA: Record<string, string> = {
  first: 'jeg-fortæller', second: 'du-fortæller',
  third_limited: 'tredje person, bunden', third_omniscient: 'tredje person, alvidende',
};
const TENSE_DA: Record<string, string> = {
  past: 'datid', present: 'nutid', future: 'fremtid',
};
const REVEAL_DA: Record<string, string> = {
  hinted: 'antydet', implied: 'underforstået', stated: 'sagt', confirmed: 'bekræftet',
};
const LEAK_DA: Record<string, string> = {
  absent: 'Ikke til stede',
  unknown_reveal: 'Læseren løber forud',
  unaware_of_own_scene: 'Til stede, uvidende',
};
const SUGGESTION_DA: Record<string, string> = {
  continuity: 'sammenhæng', craft: 'fortælling', pacing: 'tempo', research: 'research',
};
const RELATION_DA: Record<string, string> = {
  supports: 'støtter', context: 'kontekst', conflicts: 'mulig modstrid',
};

/**
 * The writing desk.
 *
 * The manuscript in the middle, and beside it the two answers that actually
 * stop a draft: what the viewpoint character knows at this moment, and what the
 * reader knows by this chapter. The distance between the two columns is the
 * dramatic irony; a crossing of them is a mistake, and it is named at the top
 * rather than found three months later.
 */
export function Desk({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const { data: scenes } = useQuery('scene.list', {}, [nonce]);
  const requested = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const [sceneId, setSceneId] = useState<string | null>(requested.get('scene'));
  const [tab, setTab] = useState<'pov' | 'reader' | 'anchors' | 'margin'>('pov');
  const prose = useRef<ProseHandle>(null);

  useEffect(() => {
    if (!scenes?.length) return;
    if (!sceneId || !scenes.some((s) => s.id === sceneId)) setSceneId(scenes[0]!.id);
  }, [scenes, sceneId]);

  const { data: desk, reload } = useQuery(
    'desk.get', { sceneId: sceneId ?? '' }, [nonce, sceneId],
  );
  const { data: references } = useQuery('reference.list', undefined, [nonce]);

  const targets = useMemo<AnchorTarget[]>(() => (references ?? [])
    .filter((item) => item.exists)
    .map((item) => ({
      kind: item.targetKind, id: item.targetId, code: item.code,
      label: item.label, group: item.group, href: item.href,
    })), [references]);

  const save = useCallback(async (doc: unknown, markdown: string) => {
    if (!sceneId) return;
    await call('desk.saveProse', { sceneId, doc, markdown });
  }, [sceneId]);

  const anchor = useCallback(async (
    target: AnchorTarget, markId: string, excerpt: string,
  ) => {
    if (!sceneId) return;
    try {
      await call('anchor.create', {
        sceneId, markId, targetKind: target.kind, targetId: target.id, excerpt,
      });
      notify({ text: `Knyttet til «${target.label}».` });
      reload();
      onChanged();
    } catch (error) {
      notify({ text: error instanceof Error ? error.message : String(error), bad: true });
    }
  }, [sceneId, notify, reload, onChanged]);

  const prune = useCallback((markIds: string[]) => {
    if (!sceneId) return;
    void call('anchor.prune', { sceneId, markIds }).then((r) => {
      if (r.removed > 0) { reload(); onChanged(); }
    }).catch(() => { /* An anchor left behind is harmless; a crash is not. */ });
  }, [sceneId, reload, onChanged]);

  const openAnchor = useCallback((markId: string) => {
    const tied = desk?.anchors.find((item) => item.markId === markId);
    if (!tied) return;
    if (tied.href) {
      const target = tied.href.startsWith('skrivebord?scene=')
        ? new URLSearchParams(tied.href.split('?')[1]).get('scene') : null;
      if (target) setSceneId(target);
      window.location.hash = tied.href;
      return;
    }
    setTab('anchors');
  }, [desk?.anchors]);

  const decideSuggestion = useCallback(async (
    id: string, status: 'open' | 'accepted' | 'rejected',
  ) => {
    try {
      await call('suggestion.decide', { id, status });
      notify({
        text: status === 'accepted'
          ? 'Markeret som fulgt. Prosaen er ikke ændret.'
          : status === 'rejected' ? 'Margennoten er afvist.' : 'Margennoten er åbnet igen.',
      });
      reload();
      onChanged();
    } catch (error) {
      notify({ text: error instanceof Error ? error.message : String(error), bad: true });
    }
  }, [notify, reload, onChanged]);

  /**
   * Det udtrykkelige ja.
   *
   * Klikket er selve tilsagnet, og derfor sker udskiftningen i editoren, hvor
   * forfatteren ser sætningen lande. Prosa og note gemmes i den samme tur, så
   * ét fortryd tager begge dele tilbage.
   */
  const applySuggestion = useCallback(async (
    id: string, markId: string, text: string,
  ) => {
    try {
      const result = await prose.current?.applyProposal(markId, text, async (doc, markdown) => {
        await call('suggestion.apply', { id, doc, markdown });
      });
      if (result === 'missing') {
        notify({
          text: 'Passagen findes ikke længere i teksten, så formuleringen kan ikke placeres.',
          bad: true,
        });
        return;
      }
      notify({ text: 'Formuleringen er skrevet ind. Fortryd tager både tekst og note tilbage.' });
      reload();
      onChanged();
    } catch (error) {
      notify({ text: error instanceof Error ? error.message : String(error), bad: true });
    }
  }, [notify, reload, onChanged]);

  if (scenes && scenes.length === 0) {
    return (
      <div className="page">
        <h2>Skrivebordet</h2>
        <p className="empty">
          Bogen har ingen scener endnu. Sig til Claude «opret et kapitel og en scene»,
          eller lav dem under Kapitler.
        </p>
      </div>
    );
  }
  /**
   * Vent på, at de hentede data faktisk hører til den valgte scene.
   *
   * Uden det her monteres editoren ét gennemløb for tidligt, mens `desk` stadig
   * er den forrige scenes: overskriften skifter, men prosaen bliver stående —
   * og næste tastetryk gemmer den gamle tekst ind i den nye scene. Nøglen på
   * <Prose> redder det ikke, for den er allerede skiftet, når det rigtige
   * dokument ankommer.
   */
  if (!desk || !sceneId || desk.scene.id !== sceneId) {
    return <div className="page"><p className="empty">Henter …</p></div>;
  }

  const known = new Set(desk.pov?.knows.map((k) => k.factId) ?? []);

  return (
    <div className="desk">
      <aside className="desk-scenes">
        <h3>Læserækkefølge</h3>
        {scenes?.map((s) => (
          <button
            key={s.id} className="scene-pick" aria-current={s.id === sceneId}
            onClick={() => setSceneId(s.id)}
          >
            <span className="num">{s.chapterPosition}.{s.position}</span>
            <span className="scene-name">{s.title}</span>
            <span className="dim mono">{s.wordCount || '—'}</span>
          </button>
        ))}
      </aside>

      <section className="desk-main">
        <header className="desk-head">
          <div>
            <span className="dim">
              Kapitel {desk.scene.chapterPosition} · {desk.scene.chapterTitle}
            </span>
            <h2>{desk.scene.title ?? '(uden titel)'}</h2>
          </div>
          <div className="desk-meta">
            {desk.pov && (
              <span className="chip story">
                {desk.pov.name}
                {desk.pov.legLabel && desk.pov.legLabel !== 'ben 1' && ` · ${desk.pov.legLabel}`}
              </span>
            )}
            {desk.scene.narrationPerson && (
              <span className="chip quiet">{NARRATION_DA[desk.scene.narrationPerson]}</span>
            )}
            {desk.scene.narrationTense && (
              <span className="chip quiet">{TENSE_DA[desk.scene.narrationTense]}</span>
            )}
            {desk.scene.realmName && <span className="chip quiet">{desk.scene.realmName}</span>}
            <span className="chip disc">
              {desk.moment.at == null
                ? 'ikke placeret i tiden'
                : formatInstant(desk.moment.at, 'day')}
            </span>
          </div>
        </header>

        <div className="desk-nav">
          <button className="btn" disabled={!desk.previousSceneId}
            onClick={() => setSceneId(desk.previousSceneId)}>← Forrige</button>
          <button className="btn" disabled={!desk.nextSceneId}
            onClick={() => setSceneId(desk.nextSceneId)}>Næste →</button>
        </div>

        <Prose
          key={sceneId}
          ref={prose}
          sceneId={sceneId}
          initialDoc={desk.prose.doc}
          targets={targets}
          onSave={save}
          onAnchor={anchor}
          onAnchorsPruned={prune}
          onOpenAnchor={openAnchor}
          focusMarkId={requested.get('mark')}
        />
      </section>

      <aside className="desk-panel">
        {desk.leaks.length > 0 && (
          <div className="banner alert">
            <h4>{desk.leaks.length === 1 ? 'Ét sted klemmer det' : `${desk.leaks.length} steder klemmer det`}</h4>
            {desk.leaks.map((leak, index) => (
              <p key={index}>
                <span className="chip alert">{LEAK_DA[leak.kind] ?? leak.kind}</span>{' '}
                {leak.message}
              </p>
            ))}
          </div>
        )}
        {desk.lifted.length > 0 && (
          <p className="dim small">
            {desk.lifted.length} advarsel{desk.lifted.length === 1 ? '' : 'er'} er løftet af en lov:
            «{desk.lifted[0]!.lifted}»
          </p>
        )}

        <div className="tabs">
          <button aria-current={tab === 'pov'} onClick={() => setTab('pov')}>
            {desk.pov ? `${desk.pov.name} ved` : 'Ingen POV'}
            <span className="count">{desk.pov?.knows.length ?? 0}</span>
          </button>
          <button aria-current={tab === 'reader'} onClick={() => setTab('reader')}>
            Læseren ved<span className="count">{desk.readerKnows.length}</span>
          </button>
          <button aria-current={tab === 'anchors'} onClick={() => setTab('anchors')}>
            Ankre<span className="count">{desk.anchors.length}</span>
          </button>
          <button aria-current={tab === 'margin'} onClick={() => setTab('margin')}>
            Margen<span className="count">{desk.suggestions.filter((s) => s.status === 'open').length}</span>
          </button>
        </div>

        {tab === 'pov' && (
          <div className="panel-body">
            {!desk.pov && (
              <p className="empty">
                Scenen har ingen synsvinkel. Sæt en, så kan panelet svare på,
                hvad den person ved lige her.
              </p>
            )}
            {desk.pov && desk.moment.at == null && (
              <p className="vague">
                Scenen er ikke placeret i tiden, så svaret gælder alt, {desk.pov.name} nogensinde
                ved. Knyt scenen til et event for at binde svaret til et øjeblik.
              </p>
            )}
            {desk.pov?.knows.length === 0 && (
              <p className="empty">{desk.pov.name} ved ingenting her.</p>
            )}
            {desk.pov?.knows.map((k) => (
              <div key={k.factId} className="know">
                <div>{k.summary}</div>
                <div className="dim small">
                  {STRENGTH_DA[k.strength] ?? k.strength} · {SOURCE_DA[k.source] ?? k.source}
                  {k.viaObject && ` (${k.viaObject})`}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'reader' && (
          <div className="panel-body">
            {desk.readerKnows.length === 0 && (
              <p className="empty">Læseren har ikke fået noget endnu — alt er stadig i vente.</p>
            )}
            {desk.readerKnows.map((f) => (
              <div key={f.factId} className={known.has(f.factId) ? 'know' : 'know ahead'}>
                <div>{f.summary}</div>
                <div className="dim small">
                  {/* En læser af bind to har bind et med sig, og det skal stå,
                      hvorfra — ellers ligner et kapitelnummer fra en anden bog
                      et nummer i denne. */}
                  {f.fromEarlierWork
                    ? `fra «${f.fromEarlierWork}», kap. ${f.firstChapter}`
                    : `kap. ${f.firstChapter}`}
                  {' · '}{REVEAL_DA[f.strength] ?? f.strength}
                  {f.slots.length > 0 && ` · kun ${f.slots.join(', ')}`}
                  {!f.complete && ' · ikke hele vejen'}
                  {desk.pov && !known.has(f.factId) && ` · ${desk.pov.name} ved det ikke`}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'anchors' && (
          <div className="panel-body">
            {desk.anchors.length === 0 && (
              <p className="empty">
                Ingen ankre endnu. Markér en passage i teksten og knyt den til det, den udtrykker.
              </p>
            )}
            {desk.anchors.map((a) => (
              <div key={a.id} className={a.broken ? 'know broken-reference' : 'know'}>
                <div className="dim small">
                  {a.code && <span className="reference-code">{a.code}</span>}
                  {a.targetLabel}
                  {a.broken && <span className="chip alert">brudt reference</span>}
                </div>
                {a.excerpt && <div className="excerpt">«{a.excerpt}»</div>}
                {a.href && <a className="small" href={`#${a.href}`}>Åbn kortet →</a>}
              </div>
            ))}
          </div>
        )}

        {tab === 'margin' && (
          <div className="panel-body">
            {desk.sources.length > 0 && (
              <>
                <h4 className="panel-head">Kilder til scenen</h4>
                {desk.sources.map((src) => (
                  <div key={`${src.id}-${src.backs.id}`} className="know">
                    <div>{src.title}</div>
                    <div className="dim small">
                      {RELATION_DA[src.backs.relation] ?? src.backs.relation}
                      {src.backs.label && ` · ${src.backs.label}`}
                    </div>
                    {src.backs.quote && <div className="excerpt">«{src.backs.quote}»</div>}
                  </div>
                ))}
                <h4 className="panel-head">Margennoter</h4>
              </>
            )}
            {desk.suggestions.length === 0 && (
              <p className="empty">
                Ingen margennoter. Bed Claude gennemgå scenen; kommentarerne lander her uden at
                ændre manuskriptet.
              </p>
            )}
            {desk.suggestions.map((note) => (
              <article key={note.id} className={`margin-note ${note.status}`}>
                <div className="margin-note-head">
                  <span className="chip quiet">{SUGGESTION_DA[note.kind] ?? note.kind}</span>
                  {note.status !== 'open' && (
                    <span className="dim small">{note.status === 'accepted' ? 'fulgt' : 'afvist'}</span>
                  )}
                  {/*
                    Ikke en advarsel. Noten er skrevet om en tidligere version af
                    scenen, og det er alt, mærket siger — den kan stadig være
                    god, og den kan stadig skrives ind.
                  */}
                  {note.stale && <span className="chip quiet">tidligere version</span>}
                </div>
                <p>{note.message}</p>
                {note.proposedText && (
                  <div className="proposed">
                    <span className="dim small">
                      {note.appliedAt
                        ? 'Foreslået formulering — skrevet ind'
                        : note.markId
                          ? 'Foreslået formulering — ikke anvendt'
                          : 'Foreslået formulering — uden anker, så den kan ikke placeres'}
                    </span>
                    <div>«{note.proposedText}»</div>
                  </div>
                )}
                <div className="margin-actions">
                  {/* Klikket her ER tilsagnet. Derfor står knappen kun, hvor den
                      kan holde: en formulering med et anker, der ikke allerede
                      er skrevet ind. */}
                  {note.proposedText && note.markId && !note.appliedAt && (
                    <button
                      className="btn primary"
                      onClick={() =>
                        void applySuggestion(note.id, note.markId!, note.proposedText!)}
                    >
                      Skriv den ind
                    </button>
                  )}
                  {note.status === 'open' ? (
                    <>
                      <button className="btn" onClick={() => void decideSuggestion(note.id, 'accepted')}>
                        Markér som fulgt
                      </button>
                      <button className="btn" onClick={() => void decideSuggestion(note.id, 'rejected')}>
                        Afvis
                      </button>
                    </>
                  ) : (
                    <button className="btn" onClick={() => void decideSuggestion(note.id, 'open')}>
                      Åbn igen
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        <h4 className="panel-head">Scenen fortæller</h4>
        <div className="panel-body">
          {desk.tells.length === 0 && (
            <p className="empty">Ingen events knyttet. Uden dem kan scenen ikke placeres i tiden.</p>
          )}
          {desk.tells.map((t) => (
            <div key={t.id} className="know">
              <div>{t.title}</div>
              <div className="dim small">
                {MODE_DA[t.mode] ?? t.mode}
                {t.from != null && ` · ${formatInstant(t.from, 'day')}`}
                {desk.pov && !t.povPresent && ' · uden POV'}
              </div>
            </div>
          ))}
          {desk.reveals.length > 0 && <h4 className="panel-head">Afsløres her</h4>}
          {desk.reveals.map((r) => (
            <div key={r.id} className="know">
              <div>{r.summary}</div>
              <div className="dim small">
                {REVEAL_DA[r.strength] ?? r.strength}
                {r.slotName && ` · kun pladsen «${r.slotName}»`}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
