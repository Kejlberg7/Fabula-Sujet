import { useQuery } from '../store';
import { TRUTH_DA } from '../format';

export function Facts({ nonce }: { nonce: number }) {
  const { data, loading } = useQuery('list.facts', undefined, [nonce]);
  const { data: references } = useQuery('reference.list', undefined, [nonce]);

  return (
    <div className="page">
      <h2>Fakta</h2>
      <p className="lede">
        Påstande om verden, med pladser frem for færdige sætninger. En tom plads er ikke et hul —
        det er forskellen på at vide, at Peter blev dræbt, og at vide af hvem.
      </p>

      {loading && !data && <p className="empty">Henter …</p>}
      {data?.length === 0 && <p className="empty">Ingen fakta endnu.</p>}

      {data && data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Faktum</th>
              <th>Pladser</th>
              <th>Sandhed</th>
              <th className="num">Tror det</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const bound = Object.entries(row.binds);
              return (
                <tr key={row.id}>
                  <td>
                    {references?.filter((item) => item.targetKind === 'fact' && item.targetId === row.id)
                      .map((item) => <span className="reference-code" key={item.id}>{item.code}</span>)}
                    {row.summary}
                    <div className="mono" style={{ color: 'var(--muted)' }}>{row.predicate}</div>
                  </td>
                  <td className="mono">
                    {bound.length === 0
                      ? <span className="vague">ingen udfyldt</span>
                      : bound.map(([slot, value]) => (
                          <div key={slot}>
                            <span style={{ color: 'var(--muted)' }}>{slot}:</span> {value}
                          </div>
                        ))}
                  </td>
                  <td>
                    <span className={
                      row.truth === 'true' ? 'chip story'
                        : row.truth === 'false' ? 'chip alert'
                          : 'chip quiet'
                    }>
                      {TRUTH_DA[row.truth] ?? row.truth}
                    </span>
                  </td>
                  <td className="num">{row.believers}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
