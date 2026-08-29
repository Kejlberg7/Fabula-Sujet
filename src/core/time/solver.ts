import { RealmClocks, type RealmClock } from './realms';

/**
 * The time solver.
 *
 * An event does not have a timestamp; it has an interval and links to other
 * events. This narrows the intervals until nothing moves. Ten minutes of
 * arithmetic replaces an afternoon of "wait, when was the fire, then?".
 *
 * Two things come out of it for free, and they are the reason it is worth
 * building at all:
 *
 *  - An interval that narrows to nothing means the chronology cannot happen.
 *  - A cycle in the ordering means the same.
 *
 * Neither is an exception to handle; both are findings to report.
 */

export interface SolverEvent {
  id: string;
  realmId: string;
  earliest: number | null;
  latest: number | null;
  durationMin: number | null;
  durationMax: number | null;
}

export interface SolverLink {
  id: string;
  fromEventId: string;
  toEventId: string;
  kind: 'before' | 'after' | 'same_time' | 'offset' | 'during';
  offsetMin: number | null;
  offsetMax: number | null;
  axis: 'world' | 'personal';
}

export interface SolvedBounds {
  earliest: number | null;
  latest: number | null;
}

export interface SolverFinding {
  ruleCode: 'impossible_chronology' | 'unanchored_realm';
  severity: 'error' | 'warning' | 'note';
  message: string;
  subjects: { events?: string[]; links?: string[]; realms?: string[] };
  fingerprint: string;
}

export interface SolverResult {
  bounds: Map<string, SolvedBounds>;
  findings: SolverFinding[];
  iterations: number;
}

interface Span { lo: number; hi: number }

const NEG = Number.NEGATIVE_INFINITY;
const POS = Number.POSITIVE_INFINITY;

/**
 * Events only constrain each other if their clocks can be compared at all.
 * A realm that has not been pinned to its parent is its own island, and saying
 * so is better than inventing an anchor.
 */
function frameOf(clocks: RealmClocks, realmId: string): string {
  return clocks.isAnchored(realmId) ? clocks.rootOf(realmId) : realmId;
}

export function solve(
  events: readonly SolverEvent[],
  links: readonly SolverLink[],
  realms: readonly RealmClock[],
): SolverResult {
  const clocks = new RealmClocks(realms);
  const byId = new Map(events.map((e) => [e.id, e]));
  const findings: SolverFinding[] = [];
  const reportedRealms = new Set<string>();

  // Everything is reasoned about on the root clock of its frame.
  const span = new Map<string, Span>();
  const durMin = new Map<string, number>();
  for (const e of events) {
    const toRoot = (v: number) => (clocks.isAnchored(e.realmId) ? clocks.toRoot(e.realmId, v) : v);
    span.set(e.id, {
      lo: e.earliest == null ? NEG : toRoot(e.earliest),
      hi: e.latest == null ? POS : toRoot(e.latest),
    });
    const d = e.durationMin ?? 0;
    durMin.set(e.id, clocks.isAnchored(e.realmId) ? clocks.spanToRoot(e.realmId, d) : d);
    if (!clocks.isAnchored(e.realmId) && !reportedRealms.has(e.realmId)) {
      reportedRealms.add(e.realmId);
      findings.push({
        ruleCode: 'unanchored_realm',
        severity: 'note',
        message: `Laget er ikke fæstnet til sin forælder, så dets tidspunkter kan ikke sammenlignes med resten. Sæt et fælles holdepunkt (parent_epoch og local_epoch).`,
        subjects: { realms: [e.realmId] },
        fingerprint: `unanchored_realm:${e.realmId}`,
      });
    }
  }

  const usable = links.filter((l) => {
    const from = byId.get(l.fromEventId);
    const to = byId.get(l.toEventId);
    if (!from || !to) return false;
    return frameOf(clocks, from.realmId) === frameOf(clocks, to.realmId);
  });

  const scale = (l: SolverLink, value: number): number => {
    const from = byId.get(l.fromEventId)!;
    return clocks.isAnchored(from.realmId) ? clocks.spanToRoot(from.realmId, value) : value;
  };

  const limit = Math.max(16, usable.length * 4 + events.length);
  let iterations = 0;
  let changed = true;

  while (changed && iterations < limit) {
    changed = false;
    iterations += 1;

    for (const l of usable) {
      const a = span.get(l.fromEventId)!;
      const b = span.get(l.toEventId)!;
      const before = `${a.lo}|${a.hi}|${b.lo}|${b.hi}`;

      switch (l.kind) {
        case 'before': {
          const gap = durMin.get(l.fromEventId)!;
          b.lo = Math.max(b.lo, a.lo + gap);
          a.hi = Math.min(a.hi, b.hi - gap);
          break;
        }
        case 'after': {
          const gap = durMin.get(l.toEventId)!;
          a.lo = Math.max(a.lo, b.lo + gap);
          b.hi = Math.min(b.hi, a.hi - gap);
          break;
        }
        case 'same_time': {
          const lo = Math.max(a.lo, b.lo);
          const hi = Math.min(a.hi, b.hi);
          a.lo = lo; b.lo = lo; a.hi = hi; b.hi = hi;
          break;
        }
        case 'offset': {
          const omin = scale(l, l.offsetMin ?? 0);
          const omax = scale(l, l.offsetMax ?? l.offsetMin ?? 0);
          b.lo = Math.max(b.lo, a.lo + omin);
          b.hi = Math.min(b.hi, a.hi + omax);
          a.lo = Math.max(a.lo, b.lo - omax);
          a.hi = Math.min(a.hi, b.hi - omin);
          break;
        }
        case 'during': {
          b.lo = Math.max(b.lo, a.lo);
          const outer = byId.get(l.fromEventId)!;
          const outerMax = outer.durationMax ?? outer.durationMin ?? 0;
          b.hi = Math.min(b.hi, a.hi + scale(l, outerMax) - durMin.get(l.toEventId)!);
          break;
        }
      }

      if (`${a.lo}|${a.hi}|${b.lo}|${b.hi}` !== before) changed = true;
    }
  }

  findings.push(...reportEmptySpans(events, usable, span));

  findings.push(...findCycles(usable));

  const bounds = new Map<string, SolvedBounds>();
  for (const e of events) {
    const s = span.get(e.id)!;
    const back = (v: number) => Math.round(clocks.isAnchored(e.realmId) ? clocks.fromRoot(e.realmId, v) : v);
    bounds.set(e.id, {
      earliest: Number.isFinite(s.lo) ? back(s.lo) : null,
      latest: Number.isFinite(s.hi) ? back(s.hi) : null,
    });
  }

  return { bounds, findings, iterations };
}

/**
 * One contradiction, one finding.
 *
 * Squeezing an interval to nothing squeezes its neighbours too, so reporting
 * per event turns a single impossible stretch into a handful of near-identical
 * complaints. Events that were squeezed together are reported together: the
 * writer has one thing to look at, and the fingerprint stays stable while they
 * work out which end of it to move.
 */
function reportEmptySpans(
  events: readonly SolverEvent[],
  links: readonly SolverLink[],
  span: ReadonlyMap<string, Span>,
): SolverFinding[] {
  const empty = new Set(events.filter((e) => {
    const s = span.get(e.id)!;
    return s.lo > s.hi;
  }).map((e) => e.id));
  if (empty.size === 0) return [];

  const parent = new Map<string, string>([...empty].map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const l of links) {
    if (!empty.has(l.fromEventId) || !empty.has(l.toEventId)) continue;
    const a = find(l.fromEventId);
    const b = find(l.toEventId);
    if (a !== b) parent.set(a, b);
  }

  const groups = new Map<string, string[]>();
  for (const id of empty) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(id);
  }

  return [...groups.values()].map((group) => {
    const ids = [...group].sort();
    return {
      ruleCode: 'impossible_chronology' as const,
      severity: 'error' as const,
      message: ids.length === 1
        ? 'Tidsbåndene presser dette event ned til ingenting: der findes ikke et tidspunkt, hvor det kan ligge.'
        : `Tidsbåndene presser ${ids.length} events ned til ingenting på én gang. Der findes ikke et forløb, hvor de alle kan ligge — ét af båndene skal give sig.`,
      subjects: { events: ids },
      fingerprint: `impossible_chronology:empty:${ids.join(',')}`,
    };
  });
}

/**
 * A loop in the ordering.
 *
 * On the personal axis any loop at all is impossible: a life runs one way even
 * when the world does not. On the world axis a loop of strictly ordered events
 * is equally impossible -- a causal loop is a loop in *causation*, which lives
 * in the links between facts, not in whether the clock can be read twice.
 */
function findCycles(links: readonly SolverLink[]): SolverFinding[] {
  const findings: SolverFinding[] = [];

  for (const axis of ['personal', 'world'] as const) {
    const edges = new Map<string, { to: string; link: SolverLink }[]>();
    for (const l of links) {
      if (l.axis !== axis) continue;
      const strict = l.kind === 'before' || l.kind === 'after'
        || (l.kind === 'offset' && (l.offsetMin ?? 0) > 0);
      if (axis === 'world' && !strict) continue;
      if (axis === 'personal' && l.kind === 'same_time') continue;
      const [from, to] = l.kind === 'after'
        ? [l.toEventId, l.fromEventId]
        : [l.fromEventId, l.toEventId];
      if (!edges.has(from)) edges.set(from, []);
      edges.get(from)!.push({ to, link: l });
    }

    const state = new Map<string, 'open' | 'done'>();
    const stack: string[] = [];

    const walk = (node: string): void => {
      state.set(node, 'open');
      stack.push(node);
      for (const edge of edges.get(node) ?? []) {
        const seen = state.get(edge.to);
        if (seen === 'open') {
          const cycle = stack.slice(stack.indexOf(edge.to)).concat(edge.to);
          const key = [...cycle].sort().join(',');
          findings.push({
            ruleCode: 'impossible_chronology',
            severity: 'error',
            message: axis === 'personal'
              ? 'Båndene får en persons egen tid til at gå i ring. Verdens tid må gerne springe tilbage, men et liv løber én vej.'
              : 'Båndene får rækkefølgen til at gå i ring: hvert event skal ligge efter det næste.',
            subjects: { events: cycle, links: [edge.link.id] },
            fingerprint: `impossible_chronology:cycle:${axis}:${key}`,
          });
          continue;
        }
        if (seen !== 'done') walk(edge.to);
      }
      stack.pop();
      state.set(node, 'done');
    };

    for (const node of edges.keys()) if (!state.has(node)) walk(node);
  }

  return findings;
}
