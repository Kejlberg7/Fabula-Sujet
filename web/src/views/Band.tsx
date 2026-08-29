import { useEffect, useRef, useState } from 'react';
import { useQuery } from '../store';
import { formatInstant } from '../format';

/**
 * The two axes at once.
 *
 * Chronology down the left, reading order down the right, one thread per
 * telling. A book told in order is a ladder; every crossing is a flashback, a
 * foreshadowing or something deliberately withheld. This is the picture the
 * whole model exists to be able to draw, and Memento drawn this way is a
 * lattice -- which is the correct answer, not a fault in the drawing.
 */
export function Band({ nonce }: { nonce: number }) {
  const { data, loading } = useQuery('band.get', {}, [nonce]);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<{ kind: 'scene' | 'event'; id: string } | null>(null);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(560, entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (loading && !data) return <div className="page"><p className="empty">Henter …</p></div>;
  if (!data) {
    return (
      <div className="page">
        <h2>Båndet</h2>
        <p className="empty">Vælg en bog for at se de to akser mod hinanden.</p>
      </div>
    );
  }

  const rows = Math.max(data.events.length, data.scenes.length, 1);
  const rowHeight = 30;
  const padding = 34;
  const height = rows * rowHeight + padding * 2;
  const leftAxis = Math.min(360, width * 0.4);
  const rightAxis = width - Math.min(360, width * 0.4);
  const y = (v: number) => padding + v * (height - padding * 2);

  const lit = (kind: 'scene' | 'event', id: string) => {
    if (!hover) return true;
    if (hover.kind === kind && hover.id === id) return true;
    return data.ribbons.some((r) =>
      (hover.kind === 'scene' ? r.sceneId === hover.id : r.eventId === hover.id)
      && (kind === 'scene' ? r.sceneId === id : r.eventId === id));
  };

  return (
    <div className="page wide">
      <h2>Båndet</h2>
      <p className="lede">
        Kronologien til venstre, læserækkefølgen til højre, en tråd for hver gang bogen
        fortæller noget. Krydser trådene, springer du i tiden.
      </p>

      <div className="banner">
        <h4>
          {data.stats.backwards === 0
            ? 'Bogen fortælles i den rækkefølge, tingene skete'
            : `${data.stats.backwards} scene${data.stats.backwards === 1 ? '' : 'r'} springer bagud i tiden`}
        </h4>
        <p>
          {data.stats.told} event{data.stats.told === 1 ? '' : 's'} bliver fortalt.
          {data.stats.untold > 0 && ` ${data.stats.untold} er lagt ind, men ikke skrevet endnu.`}
          {data.stats.floating > 0 && ` ${data.stats.floating} scene${data.stats.floating === 1 ? '' : 'r'} hænger ikke på et event og kan ikke placeres.`}
        </p>
      </div>

      <div className="tl-legend">
        <span><i className="tl-swatch" style={{ background: 'var(--story)' }} /> kronologi</span>
        <span><i className="tl-swatch" style={{ background: 'var(--disc)' }} /> fortælling</span>
        <span><i className="tl-swatch" style={{ background: 'var(--alert)' }} /> spring bagud</span>
        <span>
          <i className="tl-swatch"
            style={{ background: 'transparent', border: '1.5px solid var(--line-2)' }} />
          {' '}ikke fortalt endnu
        </span>
      </div>

      <div className="band" ref={box}>
        <svg width={width} height={height} role="img"
          aria-label="Kronologi mod læserækkefølge">
          <text x={leftAxis} y={18} textAnchor="end" className="axis-label">Kronologi</text>
          <text x={rightAxis} y={18} className="axis-label">Læserækkefølge</text>
          <line x1={leftAxis} y1={padding - 8} x2={leftAxis} y2={height - padding + 8} className="axis" />
          <line x1={rightAxis} y1={padding - 8} x2={rightAxis} y2={height - padding + 8} className="axis" />

          {data.ribbons.map((r, index) => {
            const y1 = y(r.fromY);
            const y2 = y(r.toY);
            const bend = (rightAxis - leftAxis) * 0.45;
            const on = !hover || lit('scene', r.sceneId);
            return (
              <path
                key={index}
                d={`M ${leftAxis} ${y1} C ${leftAxis + bend} ${y1}, ${rightAxis - bend} ${y2}, ${rightAxis} ${y2}`}
                className={[
                  'ribbon',
                  r.backwards ? 'back' : '',
                  r.mode !== 'dramatised' ? 'soft' : '',
                  on ? '' : 'dimmed',
                ].filter(Boolean).join(' ')}
              />
            );
          })}

          {data.events.map((e) => (
            <g key={e.eventId}
              className={lit('event', e.eventId) ? 'node' : 'node dimmed'}
              onMouseEnter={() => setHover({ kind: 'event', id: e.eventId })}
              onMouseLeave={() => setHover(null)}>
              <circle cx={leftAxis} cy={y(e.y)} r={e.untold ? 3 : 4.5}
                className={e.untold ? 'dot untold' : 'dot story'} />
              <text x={leftAxis - 12} y={y(e.y) + 4} textAnchor="end"
                className={e.untold ? 'node-label untold' : 'node-label'}>
                <tspan className="rank">{e.rank}</tspan>{'  '}{e.title}
                {!e.certain && <tspan className="vague-mark">  ~</tspan>}
              </text>
              <title>
                {`${e.title}\n${formatInstant(e.from, 'day')}${
                  e.certain ? '' : ` – ${formatInstant(e.fromLatest, 'day')} (uskarpt)`
                }${e.placeName ? `\n${e.placeName}` : ''}${e.untold ? '\nIkke fortalt endnu' : ''}`}
              </title>
            </g>
          ))}

          {data.scenes.map((s) => (
            <g key={s.sceneId}
              className={lit('scene', s.sceneId) ? 'node' : 'node dimmed'}
              onMouseEnter={() => setHover({ kind: 'scene', id: s.sceneId })}
              onMouseLeave={() => setHover(null)}>
              <circle cx={rightAxis} cy={y(s.y)} r={s.floating ? 3 : 4.5}
                className={s.floating ? 'dot untold' : 'dot disc'} />
              <text x={rightAxis + 12} y={y(s.y) + 4}
                className={s.floating ? 'node-label untold' : 'node-label'}>
                <tspan className="rank">{s.chapterPosition}</tspan>{'  '}{s.title}
                {s.povName && <tspan className="pov">  · {s.povName}</tspan>}
              </text>
              <title>{`${s.chapterTitle}\n${s.title}${s.povName ? `\nSynsvinkel: ${s.povName}` : ''}`}</title>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
