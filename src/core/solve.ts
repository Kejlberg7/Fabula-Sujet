import { and, eq } from 'drizzle-orm';
import type { Store } from '../db/client';
import { event, realm, temporalLink } from '../db/schema';
import { solve, type SolverFinding } from './time/solver';
import type { Context } from './workbench';

export interface SolveReport {
  findings: SolverFinding[];
  /** Events whose bounds moved. */
  updated: number;
  iterations: number;
}

/**
 * Runs the solver over the active branch and writes the result back.
 *
 * The solved bounds are the one thing that does *not* go through the change
 * log. They are derived: recomputable from the events and their links at any
 * time, and nobody wants "undo" to walk back through nine hundred rows of
 * arithmetic to reach the sentence they actually typed. Everything a person
 * decides still goes through the log; this is the machine talking to itself.
 */
export function solveTime(store: Store, ctx: Context): SolveReport {
  const { db } = store;
  const events = db.select().from(event)
    .where(and(eq(event.worldId, ctx.worldId), eq(event.branchId, ctx.branchId))).all();
  const links = db.select().from(temporalLink)
    .where(eq(temporalLink.branchId, ctx.branchId)).all();
  const realms = db.select().from(realm)
    .where(and(eq(realm.worldId, ctx.worldId), eq(realm.branchId, ctx.branchId))).all();

  const result = solve(
    events.map((e) => ({
      id: e.id, realmId: e.realmId,
      earliest: e.earliest, latest: e.latest,
      durationMin: e.durationMin, durationMax: e.durationMax,
    })),
    links.map((l) => ({
      id: l.id, fromEventId: l.fromEventId, toEventId: l.toEventId,
      kind: l.kind, offsetMin: l.offsetMin, offsetMax: l.offsetMax, axis: l.axis,
    })),
    realms.map((r) => ({
      id: r.id, parentRealmId: r.parentRealmId,
      timeRatioNum: r.timeRatioNum, timeRatioDen: r.timeRatioDen,
      parentEpoch: r.parentEpoch, localEpoch: r.localEpoch,
    })),
  );

  let updated = 0;
  const now = Date.now();
  const write = store.sqlite.prepare(
    'update "event" set solved_earliest = ?, solved_latest = ?, solved_at = ? where id = ?',
  );
  store.sqlite.transaction(() => {
    for (const e of events) {
      const bounds = result.bounds.get(e.id);
      if (!bounds) continue;
      if (bounds.earliest === e.solvedEarliest && bounds.latest === e.solvedLatest) continue;
      write.run(bounds.earliest, bounds.latest, now, e.id);
      updated += 1;
    }
  })();

  return { findings: result.findings, updated, iterations: result.iterations };
}
