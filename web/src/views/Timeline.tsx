import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useQuery } from '../store';
import { formatInstant, formatSpan, SECONDS } from '../format';
import type { TimelineItem } from '../../../src/server/api';
import {
  clampRange, denseEventRange, paddedRange, panRange, zoomRange, type TimeRange,
} from '../../../src/core/time/focus';

const ROW = 26;
const AXIS = 34;
const PAD = 10;

/** Steps that read naturally, from an hour to a century. */
const STEPS: { seconds: number; label: (t: number) => string }[] = [
  { seconds: SECONDS.HOUR, label: (t) => formatInstant(t, 'hour') },
  { seconds: 6 * SECONDS.HOUR, label: (t) => formatInstant(t, 'hour') },
  { seconds: SECONDS.DAY, label: (t) => formatInstant(t, 'day') },
  { seconds: 7 * SECONDS.DAY, label: (t) => formatInstant(t, 'day') },
  { seconds: 30 * SECONDS.DAY, label: (t) => formatInstant(t, 'month') },
  { seconds: 365 * SECONDS.DAY, label: (t) => formatInstant(t, 'year') },
  { seconds: 5 * 365 * SECONDS.DAY, label: (t) => formatInstant(t, 'year') },
  { seconds: 25 * 365 * SECONDS.DAY, label: (t) => formatInstant(t, 'year') },
  { seconds: 100 * 365 * SECONDS.DAY, label: (t) => formatInstant(t, 'year') },
];

/**
 * The chronology, in lanes.
 *
 * The one rule this picture must obey: a vague time is drawn as the range it
 * could occupy, hatched, and never snapped to a point. Half of what a writer
 * knows is "sometime that spring", and a timeline that renders that as a firm
 * Tuesday is worse than having no timeline at all.
 */
export function Timeline({ nonce }: { nonce: number }) {
  const [by, setBy] = useState<'person' | 'place'>('person');
  const [realmId, setRealmId] = useState<string>('');
  const [view, setView] = useState<TimeRange | null>(null);
  const [viewMode, setViewMode] = useState<'focus' | 'all' | 'custom'>('focus');
  const [selected, setSelected] = useState<TimelineItem | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(900);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTrackWidth(Math.max(320, entry.contentRect.width - PAD * 2));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { data: context } = useQuery('context.get', undefined, [nonce]);
  const { data, loading } = useQuery(
    'timeline.get',
    { by, realmId: realmId || undefined },
    [nonce],
  );

  const ranges = useMemo(() => {
    if (!data || data.span.from == null || data.span.to == null) return null;
    const all = paddedRange({ from: data.span.from, to: data.span.to });
    const dense = denseEventRange(data.items) ?? all;
    // If almost everything is already together, "fokus" should not be a
    // mysterious almost-identical preset.
    const focus = dense.to - dense.from > (all.to - all.from) * 0.9
      ? all : clampRange(dense, all);
    return { all, focus };
  }, [data]);

  const focusKey = data && data.span.from != null && data.span.to != null
    ? `${by}:${realmId}:${data.items.map((item) => `${item.id}:${item.from}:${item.toLatest}`).join('|')}`
    : '';
  useEffect(() => {
    if (!ranges) return;
    setView(ranges.focus);
    setViewMode('focus');
    setSelected(null);
  // Reset only when the actual chronology/filter changes, not when an
  // unrelated MCP edit refreshes the screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  const activeView = view ?? ranges?.focus ?? null;
  const geometry = useMemo(() => {
    if (!activeView) return null;
    const from = activeView.from;
    const to = activeView.to;
    const width = trackWidth;
    const scale = width / (to - from);
    const x = (t: number) => PAD + (t - from) * scale;

    const target = (to - from) / 9;
    const step = STEPS.find((s) => s.seconds >= target) ?? STEPS[STEPS.length - 1]!;
    const ticks: { t: number; label: string }[] = [];
    for (let t = Math.ceil(from / step.seconds) * step.seconds; t <= to; t += step.seconds) {
      ticks.push({ t, label: step.label(t) });
    }
    return { from, to, width: width + PAD * 2, x, ticks, span: to - from };
  }, [activeView, trackWidth]);

  if (loading && !data) return <div className="page"><p className="empty">Henter …</p></div>;
  if (!data || !geometry || data.lanes.length === 0) {
    return (
      <div className="page">
        <h2>Tidslinje</h2>
        <p className="empty">
          Der er ikke noget placeret i tiden endnu. Opret events med et tidsspænd, og bind dem
          sammen — så finder løseren resten.
        </p>
      </div>
    );
  }

  const height = AXIS + data.lanes.length * ROW + 8;
  const rowOf = (laneId: string) =>
    AXIS + data.lanes.findIndex((l) => l.id === laneId) * ROW;
  const visible = data.items.filter((item) =>
    item.toLatest >= geometry.from && item.from <= geometry.to);
  const choose = (mode: 'focus' | 'all') => {
    if (!ranges) return;
    setView(ranges[mode]);
    setViewMode(mode);
  };
  const zoom = (factor: number) => {
    if (!ranges || !activeView) return;
    setView(zoomRange(activeView, factor, ranges.all));
    setViewMode('custom');
  };
  const pan = (fraction: number) => {
    if (!ranges || !activeView) return;
    setView(panRange(activeView, fraction, ranges.all));
    setViewMode('custom');
  };
  const jumpOverview = (event: MouseEvent<HTMLDivElement>) => {
    if (!ranges || !activeView) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const centre = ranges.all.from + ratio * (ranges.all.to - ranges.all.from);
    const span = activeView.to - activeView.from;
    setView(clampRange({ from: centre - span / 2, to: centre + span / 2 }, ranges.all));
    setViewMode('custom');
  };
  const overviewX = (time: number) => ranges
    ? ((time - ranges.all.from) / (ranges.all.to - ranges.all.from)) * 100 : 0;

  return (
    <div className="page">
      <h2>Tidslinje</h2>
      <p className="lede">
        Kronologien, som den faktisk er kendt. Skraverede bjælker er de events, der endnu kun
        ligger inden for et spænd — de bliver smallere, efterhånden som du binder dem sammen.
      </p>

      <div className="tl-controls">
        <div className="picker">
          <label htmlFor="by">Baner</label>
          <select id="by" value={by} onChange={(e) => setBy(e.target.value as 'person' | 'place')}>
            <option value="person">Per person</option>
            <option value="place">Per sted</option>
          </select>
        </div>
        <div className="picker">
          <label htmlFor="realm">Lag</label>
          <select id="realm" value={realmId} onChange={(e) => setRealmId(e.target.value)}>
            <option value="">Alle lag</option>
            {context?.realms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{r.timeRatio !== 1 ? ` (×${r.timeRatio})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="picker">
          <label>Udsnit</label>
          <button className="btn" aria-current={viewMode === 'focus'}
            onClick={() => choose('focus')}>Fokus</button>
          <button className="btn" aria-current={viewMode === 'all'}
            onClick={() => choose('all')}>Hele tiden</button>
        </div>
        <div className="picker tl-navigate">
          <label>Flyt og zoom</label>
          <button className="btn" title="Tidligere" aria-label="Vis tidligere"
            onClick={() => pan(-0.6)}>←</button>
          <button className="btn" title="Zoom ud" aria-label="Zoom ud"
            onClick={() => zoom(1.7)}>−</button>
          <button className="btn" title="Zoom ind" aria-label="Zoom ind"
            onClick={() => zoom(0.58)}>+</button>
          <button className="btn" title="Senere" aria-label="Vis senere"
            onClick={() => pan(0.6)}>→</button>
        </div>
        <span className="mono tl-stats" style={{ color: 'var(--muted)' }}>
          viser {formatSpan(geometry.span)} af {formatSpan(ranges!.all.to - ranges!.all.from)}
          {' · '}{visible.length} af {data.items.length} markeringer
        </span>
      </div>

      {ranges && activeView && (
        <div className="tl-overview" role="slider" tabIndex={0}
          aria-label="Hele kronologien; klik for at flytte det viste udsnit"
          aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(overviewX((activeView.from + activeView.to) / 2))}
          onClick={jumpOverview}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') pan(-0.25);
            if (event.key === 'ArrowRight') pan(0.25);
          }}>
          {data.items.filter((item) => item.kind === 'event').map((item) => (
            <span key={item.id} className="tl-overview-event"
              style={{ left: `${overviewX((item.from + item.toLatest) / 2)}%` }} />
          ))}
          <span className="tl-overview-window" style={{
            left: `${overviewX(activeView.from)}%`,
            width: `${overviewX(activeView.to) - overviewX(activeView.from)}%`,
          }} />
        </div>
      )}

      <div className="tl-frame">
        <div style={{ display: 'grid', gridTemplateColumns: '148px 1fr' }}>
          <div style={{ borderRight: '1px solid var(--line)' }}>
            <div style={{ height: AXIS }} />
            {data.lanes.map((lane) => (
              <div
                key={lane.id}
                title={lane.name}
                style={{
                  height: ROW, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0 10px', fontSize: 12, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{lane.name}</span>
                <span className="count" style={{ color: 'var(--line-2)', marginLeft: 'auto' }}>
                  {lane.itemCount}
                </span>
              </div>
            ))}
          </div>

          <div ref={track}>
            <svg width={geometry.width} height={height} role="img"
              aria-label="Kronologi med en bane per person eller sted">
              <defs>
                <pattern id="vague" width="6" height="6" patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--story-wash)" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--story)" strokeWidth="1.4"
                    opacity="0.45" />
                </pattern>
              </defs>

              {geometry.ticks.map((tick) => (
                <g key={tick.t}>
                  <line x1={geometry.x(tick.t)} y1={AXIS - 8} x2={geometry.x(tick.t)} y2={height}
                    stroke="var(--line)" strokeWidth="1" />
                  <text x={geometry.x(tick.t) + 4} y={16} fontSize="10"
                    fontFamily="var(--mono)" fill="var(--muted)">{tick.label}</text>
                </g>
              ))}
              <line x1="0" y1={AXIS - 1} x2={geometry.width} y2={AXIS - 1}
                stroke="var(--line-2)" strokeWidth="1" />

              {data.lanes.map((lane, index) => (
                <line key={lane.id} x1="0" y1={AXIS + (index + 1) * ROW}
                  x2={geometry.width} y2={AXIS + (index + 1) * ROW}
                  stroke="var(--line)" strokeWidth="1" />
              ))}

              {visible.filter((i) => i.kind === 'presence').map((item) => {
                const y = rowOf(item.laneId) + ROW / 2 - 2;
                const left = geometry.x(Math.max(item.from, geometry.from));
                const right = geometry.x(Math.min(item.toLatest, geometry.to));
                const w = Math.max(2, right - left);
                return (
                  <rect key={item.id} x={left} y={y} width={w} height={4} rx="2"
                    fill="var(--line-2)" opacity="0.85">
                    <title>{item.title} — {formatInstant(item.from, 'day')}</title>
                  </rect>
                );
              })}

              {visible.filter((i) => i.kind === 'event').map((item) => {
                const y = rowOf(item.laneId) + 5;
                const left = geometry.x(Math.max(item.from, geometry.from));
                const right = geometry.x(Math.min(item.toLatest, geometry.to));
                const w = Math.max(3, right - left);
                const chosen = selected?.id === item.id;
                return (
                  <g key={item.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(item)}>
                    <rect
                      x={left} y={y} width={w} height={16} rx="2"
                      fill={item.certain ? 'var(--story-wash)' : 'url(#vague)'}
                      stroke={chosen ? 'var(--disc)' : 'var(--story)'}
                      strokeWidth={chosen ? 2 : 1.2}
                      strokeDasharray={item.certain ? undefined : '3 2'}
                    />
                    <title>
                      {item.title}
                      {item.detail ? ` (${item.detail})` : ''}
                      {'\n'}
                      {item.certain
                        ? formatInstant(item.from, 'minute')
                        : `${formatInstant(item.from, 'day')} – ${formatInstant(item.toLatest, 'day')}`}
                      {'\n'}{item.realmName}
                    </title>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      <div className="tl-legend">
        <span>
          <span className="tl-swatch"
            style={{ background: 'var(--story-wash)', border: '1px solid var(--story)' }} />
          Fastlagt tidspunkt
        </span>
        <span>
          <span className="tl-swatch"
            style={{
              border: '1px dashed var(--story)',
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--story) 0 1px, transparent 1px 5px)',
            }} />
          Uskarpt — ligger et sted i spændet
        </span>
        <span>
          <span className="tl-swatch" style={{ background: 'var(--line-2)', height: 4 }} />
          Tilstedeværelse
        </span>
      </div>

      {selected && <SelectedEvent id={selected.id.split(':')[0]!} nonce={nonce} />}
    </div>
  );
}

function SelectedEvent({ id, nonce }: { id: string; nonce: number }) {
  const { data, error } = useQuery('event.get', { id }, [nonce]);
  if (error) return <div className="banner bad" style={{ marginTop: 18 }}>{error}</div>;
  if (!data) return null;
  return (
    <div className="banner" style={{ marginTop: 18 }}>
      <h4>{data.title}</h4>
      <p>
        {data.bounds.from == null
          ? <span className="vague">Ikke placeret i tiden</span>
          : data.bounds.from === data.bounds.fromLatest
            ? formatInstant(data.bounds.from, 'minute')
            : <span className="vague">
                mellem {formatInstant(data.bounds.from, 'day')} og {formatInstant(data.bounds.fromLatest!, 'day')}
              </span>}
        {data.placeName ? ` · ${data.placeName}` : ''} · {data.realmName}
        {data.participants.length > 0 && ` · ${data.participants.map((p) => p.name).join(', ')}`}
      </p>
    </div>
  );
}
