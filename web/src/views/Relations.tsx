import { useMemo } from 'react';
import { useQuery } from '../store';

/** A network picture with an equivalent text list for keyboards and screen readers. */
export function Relations({ nonce }: { nonce: number }) {
  const { data, loading } = useQuery('continuity.get', undefined, [nonce]);
  const graph = useMemo(() => {
    const edges = data?.relationships ?? [];
    const names = [...new Set(edges.flatMap((edge) => [edge.fromName, edge.toName]))].sort((a, b) => a.localeCompare(b, 'da'));
    const positions = new Map(names.map((name, index) => {
      const angle = -Math.PI / 2 + 2 * Math.PI * index / Math.max(names.length, 1);
      return [name, { x: 300 + Math.cos(angle) * 220, y: 190 + Math.sin(angle) * 145 }];
    }));
    return { edges, names, positions };
  }, [data]);
  if (loading && !data) return <div className="page"><p className="empty">Læser …</p></div>;
  return <div className="page">
    <h2>Relationskort</h2>
    <p className="lede">Registrerede relationer mellem personer og andre entiteter. Kortet viser kun forbindelser, du har skrevet ind.</p>
    {!graph.edges.length ? <p className="empty">Ingen relationer endnu.</p> : <>
      <div className="relation-graph" role="img" aria-label={`Relationskort med ${graph.names.length} entiteter og ${graph.edges.length} relationer`}>
        <svg viewBox="0 0 600 380" aria-hidden="true">
          <defs><marker id="relation-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--line-2)" /></marker></defs>
          {graph.edges.map((edge) => { const a = graph.positions.get(edge.fromName)!; const b = graph.positions.get(edge.toName)!; return <g key={edge.id}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="relation-edge" markerEnd={edge.symmetric ? undefined : 'url(#relation-arrow)'} />
            <text x={(a.x+b.x)/2} y={(a.y+b.y)/2 - 5} className="relation-edge-label">{edge.kind}</text>
          </g>; })}
          {graph.names.map((name) => { const p = graph.positions.get(name)!; return <g key={name}>
            <circle cx={p.x} cy={p.y} r="34" className="relation-node" />
            <text x={p.x} y={p.y + 4} className="relation-node-label">{name.length > 12 ? `${name.slice(0, 11)}…` : name}</text>
          </g>; })}
        </svg>
      </div>
      <ul className="relation-accessible">{graph.edges.map((edge) => <li key={edge.id}>{edge.fromName} {edge.symmetric ? '↔' : '→'} {edge.toName}: {edge.kind} · {edge.when}</li>)}</ul>
    </>}
  </div>;
}
