import { z } from 'zod';
import type { Store } from '../db/client';
import type { Actor, Session } from '../core/changelog';
import { Workbench, type Context } from '../core/workbench';
import { parseInstant, parseSpan } from '../core/time/gregorian';

export interface Tools {
  bench: Workbench;
  store: Store;
  actor: Actor;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Returns what to say back. Throwing is fine: the wrapper turns it into an answer. */
  run: (args: never, tools: Tools) => string;
}

export const defineTool = <S extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  run: (args: z.infer<z.ZodObject<S>>, tools: Tools) => string;
}): ToolDef => def as unknown as ToolDef;

/**
 * Runs a write inside one turn and adds a receipt when it moved a lot.
 *
 * There is no approval prompt in front of this surface -- you talk, and the
 * machine does what needs doing. That trade only holds up if what happened is
 * easy to see afterwards, so an unusually large action says so out loud rather
 * than passing quietly.
 */
export function write<T>(
  tools: Tools,
  summary: string,
  work: (session: Session, ctx: Context) => T,
): { value: T; receipt: string } {
  let touched = 0;
  const value = tools.bench.run({ actor: tools.actor, summary }, (session, ctx) => {
    const result = work(session, ctx);
    touched = session.changeCount;
    return result;
  });
  return {
    value,
    receipt: touched >= 10 ? `\n\n(Jeg rørte ${touched} ting i den ene handling.)` : '',
  };
}

/**
 * Times arrive as people write them: "1985-06-12", "1985", or a raw number of
 * seconds. A vague date stays vague -- `earliest` takes the first moment it
 * could be and `latest` the last, which is the whole point of the time model.
 */
export function asInstant(value: string | number | undefined, edge: 'earliest' | 'latest'): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') return value;
  const parsed = parseInstant(value);
  return edge === 'earliest' ? parsed.earliest : parsed.latest;
}

/** Durations as people say them: "3 dage", "10 min", or seconds. */
export function asSpan(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  return typeof value === 'number' ? value : parseSpan(value);
}

export const timeArg = z.union([z.string(), z.number()]);

/** A short line naming what was made, so the next sentence can refer to it. */
export function made(kind: string, name: string, id: string): string {
  return `${kind} "${name}" er oprettet. (id: ${id})`;
}
