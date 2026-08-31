import { useState } from 'react';
import { REVEAL_DA } from '../format';
import { useQuery } from '../store';

const MARK: Record<string, string> = { staerk: '✓', se_efter: '?', tynd: '!' };
const VERDICT_DA: Record<string, string> = {
  staerk: 'holder', se_efter: 'se efter', tynd: 'tynd',
};

/**
 * How well the reveals work.
 *
 * Everything else in the app answers whether something is possible. This one
 * answers whether it is any good — and deliberately gives no score. A number
 * cannot be argued with and cannot be acted on; a reading that names the scenes
 * it came from can be both.
 */
export function Twists({ nonce }: { nonce: number }) {
  const { data, loading } = useQuery('twist.list', {}, [nonce]);
  const { data: workspace } = useQuery('branch.workspace', undefined, [nonce]);
  const [against, setAgainst] = useState('');

  const others = (workspace?.branches ?? [])
    .filter((b) => b.id !== workspace?.activeBranchId && b.archivedAt == null);

  if (loading && !data) return <div className="page"><p className="empty">Læser …</p></div>;
  if (!data || data.length === 0) {
    return (
      <div className="page">
        <h2>Grebet</h2>
        <p className="empty">
          Der er ingen afsløringer at vurdere endnu. Marker med «opret_afsloering», hvornår
          læseren får noget at vide — så er der noget at læse på.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Grebet</h2>
      <p className="lede">
        Ikke om afsløringen kan lade sig gøre, men om den er noget værd. Der gives ingen karakter:
        hver aflæsning peger på de scener, den kommer af — for det er dem, du kan gøre noget ved.
        En akse tier, når der ikke er noget at regne på.
      </p>

      {data.map((twist) => (
        <article key={twist.factId} className="twist">
          <header>
            <div>
              <h3>{twist.summary}</h3>
              <p className="dim">{twist.shape}</p>
            </div>
            <span className={twist.carriedIn ? 'chip disc'
              : twist.disclosure ? 'chip story' : 'chip quiet'}>
              {twist.carriedIn
                ? `med fra «${twist.carriedIn}»`
                : twist.disclosure
                  ? `scene ${twist.disclosure.order} af ${twist.totalScenes}`
                  : 'aldrig sagt'}
            </span>
          </header>

          <div className="beats">
            {twist.beats.map((b) => (
              <span key={b.id + b.strength} className="beat" title={`${b.chapterTitle} · ${b.title}`}>
                <i className="num">{b.order}</i>
                {REVEAL_DA[b.strength] ?? b.strength}
                {b.slotName && ` · ${b.slotName}`}
              </span>
            ))}
          </div>

          {twist.readings.map((reading) => (
            <div key={reading.axis} className={`axis ${reading.verdict}`}>
              <div className="axis-head">
                <span className="mark">{MARK[reading.verdict] ?? '·'}</span>
                <strong>{reading.title}</strong>
                <span className="dim small">{VERDICT_DA[reading.verdict] ?? reading.verdict}</span>
              </div>
              <p>{reading.message}</p>
              {reading.scenes.length > 0 && (
                <div className="scene-chips">
                  {reading.scenes.map((s) => (
                    <span key={`${reading.axis}:${s.id}`} className="chip quiet"
                      title={`Kapitel ${s.chapterPosition} · ${s.chapterTitle}`}>
                      {s.order}. {s.title}
                      {/* Scenenummeret tæller fra et i hvert bind, så et spor
                          eller et setup fra et tidligere bind skal sige hvilket. */}
                      {s.otherWork && <em> · {s.otherWork}</em>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </article>
      ))}

      {others.length > 0 && (
        <>
          <div className="compare-head">
            <h3 className="section">Mod en anden gren</h3>
            <select aria-label="Gren at sammenligne med" value={against}
              onChange={(e) => setAgainst(e.target.value)}>
              <option value="">vælg en gren …</option>
              {others.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {against && <Shift branchId={against} nonce={nonce} />}
        </>
      )}
    </div>
  );
}

/** The same reveals, read on two arrangements. This is what branching was for. */
function Shift({ branchId, nonce }: { branchId: string; nonce: number }) {
  const { data, loading, error } = useQuery('twist.compare', { otherBranchId: branchId }, [nonce, branchId]);
  if (loading && !data) return <p className="empty">Læser begge …</p>;
  if (error) return <p className="empty">{error}</p>;
  if (!data || data.length === 0) {
    return <p className="empty">Afsløringerne står ens på de to grene.</p>;
  }
  return (
    <>
      {data.map((shift) => (
        <article key={shift.factId} className="twist shift">
          <header>
            <h3>{shift.summary}</h3>
            <span className="chip story">
              scene {shift.here ?? '—'} → {shift.there ?? '—'}
            </span>
          </header>
          <div className="shape-pair">
            <p><span className="dim small">her</span> {shift.hereShape}</p>
            <p><span className="dim small">der</span> {shift.thereShape}</p>
          </div>
          {shift.moved.map((m) => (
            <div key={m.axis} className="axis">
              <div className="axis-head"><strong>{m.title}</strong></div>
              <p><span className="dim small">her</span> {m.here}</p>
              <p><span className="dim small">der</span> {m.there}</p>
            </div>
          ))}
        </article>
      ))}
    </>
  );
}
