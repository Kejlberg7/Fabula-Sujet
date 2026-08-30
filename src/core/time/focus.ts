export interface TimeRange {
  from: number;
  to: number;
}

interface TimedItem {
  id: string;
  kind: string;
  from: number;
  toLatest: number;
}

const MINIMUM_SPAN = 60 * 60;

export function paddedRange(range: TimeRange, fraction = 0.04): TimeRange {
  const raw = Math.max(0, range.to - range.from);
  const span = Math.max(raw, MINIMUM_SPAN);
  const centre = (range.from + range.to) / 2;
  const pad = span * fraction;
  return { from: centre - span / 2 - pad, to: centre + span / 2 + pad };
}

/**
 * Find the shortest window containing most of the distinct events.
 *
 * Timeline rows repeat an event once per participant. Deduplicating before we
 * look for density keeps a crowded scene from pretending to be the centre of
 * the whole story. Seventy-two percent puts Memento's fifteen events in March
 * 2000 together while leaving the two sparse backstory strands in the overview.
 */
export function denseEventRange(items: TimedItem[], share = 0.72): TimeRange | null {
  const distinct = new Map<string, { from: number; to: number; middle: number }>();
  for (const item of items) {
    if (item.kind !== 'event') continue;
    const eventId = item.id.split(':')[0]!;
    const current = distinct.get(eventId);
    const from = current ? Math.min(current.from, item.from) : item.from;
    const to = current ? Math.max(current.to, item.toLatest) : item.toLatest;
    distinct.set(eventId, { from, to, middle: (from + to) / 2 });
  }
  const events = [...distinct.values()].sort((a, b) => a.middle - b.middle);
  if (events.length === 0) return null;
  if (events.length < 4) {
    return paddedRange({
      from: Math.min(...events.map((item) => item.from)),
      to: Math.max(...events.map((item) => item.to)),
    }, 0.08);
  }

  const wanted = Math.min(events.length, Math.max(3, Math.ceil(events.length * share)));
  let best = events.slice(0, wanted);
  let bestSpan = best[best.length - 1]!.middle - best[0]!.middle;
  for (let start = 1; start + wanted <= events.length; start += 1) {
    const candidate = events.slice(start, start + wanted);
    const span = candidate[candidate.length - 1]!.middle - candidate[0]!.middle;
    if (span < bestSpan) {
      best = candidate;
      bestSpan = span;
    }
  }
  return paddedRange({
    from: Math.min(...best.map((item) => item.from)),
    to: Math.max(...best.map((item) => item.to)),
  }, 0.08);
}

export function zoomRange(range: TimeRange, factor: number, bounds: TimeRange): TimeRange {
  const centre = (range.from + range.to) / 2;
  const fullSpan = bounds.to - bounds.from;
  const span = Math.min(fullSpan, Math.max(MINIMUM_SPAN, (range.to - range.from) * factor));
  return clampRange({ from: centre - span / 2, to: centre + span / 2 }, bounds);
}

export function panRange(range: TimeRange, fraction: number, bounds: TimeRange): TimeRange {
  const shift = (range.to - range.from) * fraction;
  return clampRange({ from: range.from + shift, to: range.to + shift }, bounds);
}

export function clampRange(range: TimeRange, bounds: TimeRange): TimeRange {
  const span = Math.min(range.to - range.from, bounds.to - bounds.from);
  let from = range.from;
  if (from < bounds.from) from = bounds.from;
  if (from + span > bounds.to) from = bounds.to - span;
  return { from, to: from + span };
}
