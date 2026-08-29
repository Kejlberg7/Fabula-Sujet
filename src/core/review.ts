import { and, eq } from 'drizzle-orm';
import type { Store } from '../db/client';
import { dismissal, finding } from '../db/schema';
import { newId } from './ids';
import { runRules, type Finding } from './rules';
import { solveTime } from './solve';
import type { Context } from './workbench';

/**
 * One pass over the whole world: solve the time, run the rules, write down what
 * came out.
 *
 * Findings are derived, like the solved bounds -- recomputable from the model
 * at any moment -- so they are written straight rather than through the change
 * log. Undoing a review would be a strange thing to want, and walking back
 * through nine hundred rows of arithmetic to reach the sentence you actually
 * typed would be worse. Dismissals are the opposite: a person deciding
 * something, with a reason, so those go through the log like everything else.
 *
 * Nothing is deleted. A problem that has been fixed is marked resolved and
 * stops being listed, which is what lets a dismissal survive a re-run and lets
 * "this came back" be a thing you can see.
 */

export interface ReviewReport {
  /** Open findings, worst first. */
  findings: StoredFinding[];
  /** What a law allowed, kept apart so the law can be seen doing its work. */
  lifted: { ruleCode: string; message: string; lifted: string }[];
  counts: { errors: number; warnings: number; notes: number; dismissed: number };
  resolved: number;
  appeared: number;
  solved: { updated: number; iterations: number };
}

export interface StoredFinding {
  id: string;
  ruleCode: string;
  severity: 'error' | 'warning' | 'note';
  message: string;
  fingerprint: string;
  subjects: Finding['subjects'];
  firstSeenAt: number;
  /** Set when it was put aside, with the reason it was put aside. */
  dismissedReason: string | null;
  /** True when it was seen before, went away, and has come back. */
  returned: boolean;
}

const RANK: Record<string, number> = { error: 0, warning: 1, note: 2 };

export function review(store: Store, ctx: Context, only?: string[]): ReviewReport {
  const { db, sqlite } = store;

  // The rules read solved bounds, so the arithmetic has to have happened first.
  const solved = solveTime(store, ctx);
  const fromRules = runRules(store, ctx, only);

  const all: Finding[] = [
    ...solved.findings.map((f) => ({
      ruleCode: f.ruleCode,
      severity: f.severity,
      message: f.message,
      subjects: { events: f.subjects.events ?? [], realms: f.subjects.realms ?? [] },
      fingerprint: f.fingerprint,
    })),
    ...fromRules.findings,
  ];

  const now = Date.now();
  const existing = db.select().from(finding)
    .where(eq(finding.branchId, ctx.branchId)).all();
  const byPrint = new Map(existing.map((row) => [row.fingerprint, row]));
  const seen = new Set(all.map((f) => f.fingerprint));

  let appeared = 0;
  const returned = new Set<string>();

  const upsert = sqlite.prepare(
    `insert into "finding"
       (id, branch_id, rule_code, severity, fingerprint, message, subjects,
        first_seen_at, last_seen_at, resolved_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, null)
     on conflict(branch_id, fingerprint) do update set
       severity = excluded.severity,
       message = excluded.message,
       subjects = excluded.subjects,
       last_seen_at = excluded.last_seen_at,
       resolved_at = null`,
  );
  const resolve = sqlite.prepare(
    'update "finding" set resolved_at = ? where id = ? and resolved_at is null',
  );

  sqlite.transaction(() => {
    for (const f of all) {
      const before = byPrint.get(f.fingerprint);
      if (!before) appeared += 1;
      // Seen before, marked fixed, and here again: worth saying out loud.
      else if (before.resolvedAt != null) returned.add(f.fingerprint);
      upsert.run(
        before?.id ?? newId(), ctx.branchId, f.ruleCode, f.severity, f.fingerprint,
        f.message, JSON.stringify(f.subjects), before?.firstSeenAt?.getTime() ?? now, now,
      );
    }
  })();

  /**
   * A rule that did not run this time cannot have fixed anything, so only the
   * rules we actually asked for are allowed to close their own findings.
   */
  const ranCodes = new Set([...fromRules.ran, 'impossible_chronology', 'unanchored_realm']);
  let resolvedCount = 0;
  sqlite.transaction(() => {
    for (const row of existing) {
      if (seen.has(row.fingerprint)) continue;
      if (!ranCodes.has(row.ruleCode)) continue;
      if (row.resolvedAt != null) continue;
      resolve.run(now, row.id);
      resolvedCount += 1;
    }
  })();

  const putAside = new Map(
    db.select().from(dismissal).where(eq(dismissal.branchId, ctx.branchId)).all()
      .filter((d) => d.revokedAt == null)
      .map((d) => [d.fingerprint, d.reason]),
  );

  const open = db.select().from(finding)
    .where(and(eq(finding.branchId, ctx.branchId))).all()
    .filter((row) => row.resolvedAt == null)
    .map((row): StoredFinding => ({
      id: row.id,
      ruleCode: row.ruleCode,
      severity: row.severity,
      message: row.message,
      fingerprint: row.fingerprint,
      subjects: row.subjects as Finding['subjects'],
      firstSeenAt: row.firstSeenAt.getTime(),
      dismissedReason: putAside.get(row.fingerprint) ?? null,
      returned: returned.has(row.fingerprint),
    }))
    .sort((a, b) => (RANK[a.severity]! - RANK[b.severity]!)
      || a.ruleCode.localeCompare(b.ruleCode));

  const live = open.filter((f) => f.dismissedReason == null);
  return {
    findings: open,
    lifted: fromRules.lifted.map((f) => ({
      ruleCode: f.ruleCode, message: f.message, lifted: f.lifted!,
    })),
    counts: {
      errors: live.filter((f) => f.severity === 'error').length,
      warnings: live.filter((f) => f.severity === 'warning').length,
      notes: live.filter((f) => f.severity === 'note').length,
      dismissed: open.length - live.length,
    },
    resolved: resolvedCount,
    appeared,
    solved: { updated: solved.updated, iterations: solved.iterations },
  };
}

/** Findings as they stand, without running anything. */
export function openFindings(store: Store, ctx: Context): StoredFinding[] {
  const putAside = new Map(
    store.db.select().from(dismissal).where(eq(dismissal.branchId, ctx.branchId)).all()
      .filter((d) => d.revokedAt == null)
      .map((d) => [d.fingerprint, d.reason]),
  );
  return store.db.select().from(finding)
    .where(eq(finding.branchId, ctx.branchId)).all()
    .filter((row) => row.resolvedAt == null)
    .map((row): StoredFinding => ({
      id: row.id,
      ruleCode: row.ruleCode,
      severity: row.severity,
      message: row.message,
      fingerprint: row.fingerprint,
      subjects: row.subjects as Finding['subjects'],
      firstSeenAt: row.firstSeenAt.getTime(),
      dismissedReason: putAside.get(row.fingerprint) ?? null,
      returned: false,
    }))
    .sort((a, b) => (RANK[a.severity]! - RANK[b.severity]!)
      || a.ruleCode.localeCompare(b.ruleCode));
}
