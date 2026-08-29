import { useQuery } from '../store';

export function Laws({ nonce }: { nonce: number }) {
  const { data, loading } = useQuery('list.laws', undefined, [nonce]);

  return (
    <div className="page">
      <h2>Love</h2>
      <p className="lede">
        Hvad der kan og ikke kan lade sig gøre her. En <em>evne</em> ophæver en indbygget regel for
        nogen bestemt; et <em>påbud</em> tilføjer en grænse, motoren ikke kendte. Reglerne spørger
        her, før de siger noget — det er forskellen på et værktøj, du bruger, og et, du slår fra.
      </p>

      {loading && !data && <p className="empty">Henter …</p>}
      {data?.length === 0 && (
        <p className="empty">
          Ingen love endnu. De bliver først for alvor nødvendige, når noget usædvanligt
          kan lade sig gøre i din verden.
        </p>
      )}

      {data && data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Slags</th>
              <th>Loven</th>
              <th>Gælder</th>
              <th>Regel</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className={row.kind === 'ability' ? 'chip story' : 'chip disc'}>
                    {row.kind === 'ability' ? 'evne' : 'påbud'}
                  </span>
                  {row.hardness === 'soft' && (
                    <span className="chip quiet" style={{ marginLeft: 4 }}>blød</span>
                  )}
                </td>
                <td>{row.statement}</td>
                <td className="dim">{row.subject ?? 'alle'}</td>
                <td className="mono dim">{row.ruleCode ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
