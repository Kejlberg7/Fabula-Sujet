import { REVEAL_DA } from '../format';
import { useQuery } from '../store';

const REACH_DA: Record<string, string> = {
  work: 'kun sin egen bog', series: 'hele serien', world: 'hele verden',
};


/**
 * The series read as one thing.
 *
 * Every other view answers a question about a book. This one answers the only
 * question no single volume can: what carries across. A person who turns up in
 * one book is not recurring, and another series in the same world is not here
 * at all — the reader of this series has not read it.
 */
export function Series({ nonce }: { nonce: number }) {
  const { data, loading } = useQuery('series.overview', {}, [nonce]);

  if (loading && !data) return <div className="page"><p className="empty">Læser …</p></div>;
  if (!data) {
    return (
      <div className="page">
        <h2>Serien</h2>
        <p className="empty">
          Den valgte bog hører ikke til en serie. En enkelt bog er ikke en serie, og en
          oversigt over den ville ikke sige andet end det, Kapitler allerede siger.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>{data.name}</h2>
      {data.summary && <p className="lede">{data.summary}</p>}

      <div className="volume-line">
        {data.volumes.map((volume, i) => (
          <article className="continuity-card" key={volume.id}>
            <h3>{i + 1}. {volume.title}</h3>
            <p className="dim small">
              {volume.chapters} {volume.chapters === 1 ? 'kapitel' : 'kapitler'}
              {' · '}
              {volume.scenes} {volume.scenes === 1 ? 'scene' : 'scener'}
            </p>
            {volume.summary && <p className="small">{volume.summary}</p>}
          </article>
        ))}
      </div>

      <h3 className="section">Går igen</h3>
      {data.people.length === 0
        ? <p className="empty">Ingen person er endnu i mere end ét bind.</p>
        : (
          <div className="scene-chips">
            {data.people.map((person) => (
              <span className="chip quiet" key={person.id}>
                {person.code && <i className="num">{person.code}</i>}
                {' '}{person.name} <em>· {person.volumes.join(' · ')}</em>
              </span>
            ))}
          </div>
        )}

      <h3 className="section">Plottråde</h3>
      {data.threads.length === 0
        ? <p className="empty">Ingen plottråde i serien endnu.</p>
        : (
          <div className="continuity-grid">
            {data.threads.map((line) => (
              <article className="continuity-card thread-card" key={line.id}>
                <h3>{line.name} <span className="chip quiet">{REACH_DA[line.scope] ?? line.scope}</span></h3>
                {line.summary && <div className="dim">{line.summary}</div>}
                <p className="small">
                  Begynder i {line.home}.{' '}
                  {line.volumes.length > 0
                    ? `Ligger i ${line.volumes.join(', ')}.`
                    : 'Endnu ikke skrevet ind i en scene.'}
                </p>
                <p className="dim small">
                  {line.setups} {line.setups === 1 ? 'setup' : 'setups'}
                  {' · '}
                  {line.payoffs} {line.payoffs === 1 ? 'indfrielse' : 'indfrielser'}
                </p>
              </article>
            ))}
          </div>
        )}

      <h3 className="section">Uløste setups</h3>
      {data.open.length === 0
        ? <p className="empty">Ingen. Hvert setup i serien har noget efter sig.</p>
        : (
          <div className="series-open">
            {data.open.map((item) => (
              <p key={`${item.threadId}:${item.message}`}>{item.message}</p>
            ))}
          </div>
        )}

      <h3 className="section">Afsløringer i læserækkefølge</h3>
      {data.reveals.length === 0
        ? <p className="empty">Ingen afsløringer i serien endnu.</p>
        : (
          <table className="table reveals">
            <thead>
              <tr><th>Bind</th><th>Scene</th><th>Påstand</th><th>Styrke</th></tr>
            </thead>
            <tbody>
              {data.reveals.map((item, i) => (
                <tr key={`${item.factId}:${i}`}>
                  <td>{item.volume}</td>
                  <td>{item.sceneTitle}</td>
                  <td>
                    {item.summary}
                    {/* Den vigtigste oplysning i en efterfølger: læseren ved
                        det allerede, så det her er ikke en afsløring for dem. */}
                    {item.carriedFrom && (
                      <em className="dim"> · læseren har det med fra «{item.carriedFrom}»</em>
                    )}
                  </td>
                  <td>{REVEAL_DA[item.strength] ?? item.strength}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
