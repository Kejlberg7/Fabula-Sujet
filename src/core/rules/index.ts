import { bilocation, lifeSpan, travelTime } from './place';
import { knowledgeGap, missingCarrier } from './knowing';
import { loadSnapshot, type Finding, type Rule } from './kit';
import type { Store } from '../../db/client';
import type { Context } from '../workbench';

export { loadSnapshot } from './kit';
export type { Finding, Occupation, Rule, Snapshot } from './kit';

/**
 * Every built-in rule, in the order they are worth reading.
 *
 * Place before knowledge on purpose: if she was never in the room, what she
 * knows is the second question.
 */
export const RULES: Rule[] = [
  bilocation,
  travelTime,
  lifeSpan,
  knowledgeGap,
  missingCarrier,
];

export interface RuleRun {
  findings: Finding[];
  /** What a law allowed. Never reported, but shown so the law can be seen working. */
  lifted: Finding[];
  ran: string[];
}

export function runRules(store: Store, ctx: Context, only?: string[]): RuleRun {
  const snap = loadSnapshot(store, ctx);
  const chosen = only?.length ? RULES.filter((r) => only.includes(r.code)) : RULES;
  const all = chosen.flatMap((rule) => rule.run(snap));
  return {
    findings: all.filter((f) => !f.lifted),
    lifted: all.filter((f) => f.lifted),
    ran: chosen.map((r) => r.code),
  };
}
