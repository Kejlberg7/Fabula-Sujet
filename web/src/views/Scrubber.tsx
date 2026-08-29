import { useEffect, useState } from 'react';
import { useQuery } from '../store';
import { formatInstant, SOURCE_DA } from '../format';

/**
 * A person's knowledge, dragged through their own life.
 *
 * The stops are not a uniform sample -- they are exactly the moments the model
 * already knows something happens, so the curve is true rather than smoothed.
 * Leonard's rises when he sees something and falls fifteen minutes later, and
 * the flat line underneath is what the polaroid in his pocket keeps holding.
 */
export function Scrubber({
  entityId, nonce, legCount,
}: { entityId: string; nonce: number; legCount: number }) {
  const [legId, setLegId] = useState<string | undefined>(undefined);
  const { data } = useQuery('knows.track', { entityId, legId }, [nonce, entityId, legId]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (data) setIndex(Math.max(0, data.stops.length - 1));
  }, [data]);

  if (!data) return null;
  if (data.stops.length === 0) {
    return <p className="dim small">Der er ingen øjeblikke at rulle igennem endnu.</p>;
  }

  const stop = data.stops[Math.min(index, data.stops.length - 1)]!;
  const peak = Math.max(1, ...data.stops.map((s) => s.total));
  const width = 300;
  const height = 54;
  const x = (i: number) => (data.stops.length <= 1 ? width / 2
    : (i / (data.stops.length - 1)) * (width - 8) + 4);
  const y = (v: number) => height - 6 - (v / peak) * (height - 14);

  // A step, not a slope: knowledge does not fade in between two moments.
  const path = data.stops.flatMap((s, i) => (i === 0
    ? [`M ${x(0)} ${y(s.total)}`]
    : [`L ${x(i)} ${y(data.stops[i - 1]!.total)}`, `L ${x(i)} ${y(s.total)}`])).join(' ');

  return (
    <div className="scrubber">
      {legCount > 1 && (
        <select className="leg-pick" value={legId ?? data.legId ?? ''}
          onChange={(e) => setLegId(e.target.value || undefined)}>
          {data.legs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.ordinal}. {l.label ?? 'uden mærkat'}
            </option>
          ))}
        </select>
      )}

      <svg width={width} height={height} className="curve" role="img"
        aria-label={`Videnskurve for ${data.entityName}`}>
        <path d={`${path} L ${x(data.stops.length - 1)} ${height - 6} L ${x(0)} ${height - 6} Z`}
          className="curve-fill" />
        <path d={path} className="curve-line" />
        {data.stops.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s.total)} r={i === index ? 4 : 2}
            className={i === index ? 'curve-dot on' : 'curve-dot'} />
        ))}
        <line x1={x(index)} y1={2} x2={x(index)} y2={height - 6} className="curve-head" />
      </svg>

      <input
        type="range" min={0} max={data.stops.length - 1} value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
        aria-label="Rul gennem tiden"
      />

      <div className="stop">
        <div className="mono">
          {formatInstant(stop.worldAt, 'minute')}
          <span className="dim"> · {index + 1} af {data.stops.length}</span>
        </div>
        <div className="dim small">{stop.why}</div>
        <div className="totals">
          <span className="chip story">{stop.total} i alt</span>
          {stop.bySource.carried > 0 && (
            <span className="chip quiet">{stop.bySource.carried} båret</span>
          )}
        </div>
        {stop.gained.map((g) => (
          <div key={g.factId} className="delta up">+ {g.summary}</div>
        ))}
        {stop.lost.map((l) => (
          <div key={l.factId} className="delta down">− {l.summary}</div>
        ))}
        {stop.changed.map((c) => (
          <div key={c.factId} className="delta shift">
            ↻ {c.summary}
            <span className="dim"> · {SOURCE_DA[c.from] ?? c.from} → {SOURCE_DA[c.to] ?? c.to}</span>
          </div>
        ))}
        {stop.gained.length === 0 && stop.lost.length === 0 && stop.changed.length === 0 && (
          <div className="dim small">Intet ændrer sig her.</div>
        )}
      </div>
    </div>
  );
}
