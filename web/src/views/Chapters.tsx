import { useMemo } from 'react';
import { useQuery } from '../store';
import { formatInstant, MODE_DA } from '../format';

/**
 * The telling, in reading order -- with where each scene sits in the chronology.
 *
 * The rank column is the cheap half of the band view: when the numbers run
 * backwards, you are looking at a flashback or a piece of foreshadowing, and it
 * shows up without anyone having to draw it.
 */
export function Chapters({ nonce }: { nonce: number }) {
  const { data, loading } = useQuery('list.chapters', {}, [nonce]);

  const rankOf = useMemo(() => {
    const placed: { id: string; from: number }[] = [];
    for (const ch of data ?? []) {
      for (const sc of ch.scenes) {
        for (const ev of sc.events) {
          if (ev.from != null && !placed.some((p) => p.id === ev.id)) {
            placed.push({ id: ev.id, from: ev.from });
          }
        }
      }
    }
    placed.sort((a, b) => a.from - b.from);
    return new Map(placed.map((p, index) => [p.id, index + 1]));
  }, [data]);

  if (loading && !data) return <div className="page"><p className="empty">Henter …</p></div>;

  const outOfOrder = (() => {
    const ranks: number[] = [];
    for (const ch of data ?? []) {
      for (const sc of ch.scenes) {
        for (const ev of sc.events) {
          const r = rankOf.get(ev.id);
          if (r != null) ranks.push(r);
        }
      }
    }
    let crossings = 0;
    for (let i = 1; i < ranks.length; i += 1) if (ranks[i]! < ranks[i - 1]!) crossings += 1;
    return { crossings, total: ranks.length };
  })();

  return (
    <div className="page">
      <h2>Kapitler</h2>
      <p className="lede">
        Bogen i læserækkefølge. Talholdet til højre er kronologisk plads — når det løber baglæns,
        er du i et tilbageblik eller en foregribelse.
      </p>

      {data?.length === 0 && (
        <p className="empty">Bogen har ingen kapitler endnu. Vælg en anden bog, eller tal dem ind.</p>
      )}

      {outOfOrder.total > 0 && (
        <div className="banner">
          <h4>Fortællerorden mod kronologi</h4>
          <p>
            {outOfOrder.crossings === 0
              ? 'Bogen fortælles i den rækkefølge, tingene skete.'
              : `${outOfOrder.crossings} af ${outOfOrder.total - 1} spring går baglæns i tiden.`}
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th className="num">Kap.</th>
              <th>Titel</th>
              <th>Scener</th>
              <th className="num">Kronologisk</th>
            </tr>
          </thead>
          <tbody>
            {data.map((ch) => (
              <tr key={ch.id}>
                <td className="num">{ch.position}</td>
                <td>
                  {ch.title}
                  {ch.summary && <div className="dim">{ch.summary}</div>}
                </td>
                <td>
                  {ch.scenes.length === 0 && <span className="vague">ingen scener</span>}
                  {ch.scenes.map((sc) => (
                    <div key={sc.id}>
                      {sc.title ?? '(uden titel)'}
                      {sc.pov && (
                        <span className="chip quiet" style={{ marginLeft: 6 }}>{sc.pov}</span>
                      )}
                      {sc.events.map((ev) => (
                        <div key={ev.id} className="dim" style={{ fontSize: 12 }}>
                          {MODE_DA[ev.mode] ?? ev.mode}: {ev.title}
                          {ev.from != null && ` · ${formatInstant(ev.from, 'day')}`}
                        </div>
                      ))}
                    </div>
                  ))}
                </td>
                <td className="num">
                  {ch.scenes.flatMap((sc) => sc.events).map((ev) => {
                    const rank = rankOf.get(ev.id);
                    return rank == null ? null : (
                      <div key={ev.id}>
                        <span className="chip story">{rank}</span>
                      </div>
                    );
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
