import { law, source, sourceLink } from '../../db/schema';
import type { Session } from '../changelog';
import type { Context } from '../workbench';

/**
 * What can and cannot happen here.
 *
 * An `ability` lifts a built-in rule for someone in particular; a `prohibition`
 * adds a limit the engine did not know about. The built-in rules ask this table
 * before they report anything, which is the difference between a tool you use
 * and a tool you switch off.
 *
 * Laws are inherited downwards, so a law on the world holds in every realm
 * until one of them says otherwise. What is worth writing down is the exception.
 */
export function createLaw(
  session: Session,
  ctx: Context,
  input: {
    kind: 'ability' | 'prohibition';
    hardness: 'hard' | 'soft';
    statement: string;
    /** Which built-in rule this modifies. Required for hard laws, absent for soft. */
    ruleCode?: string;
    scopeKind?: 'world' | 'series' | 'work' | 'realm';
    scopeId?: string;
    subjectKind?: 'everyone' | 'entity' | 'entity_kind' | 'carrier_holder';
    subjectEntityId?: string;
    subjectExpression?: string;
    validFrom?: number;
    validTo?: number;
    sourceId?: string;
  },
): string {
  if (input.hardness === 'hard' && !input.ruleCode) {
    throw new Error(
      'En hård lov skal pege på en regel, den ændrer. Uden det kan motoren ikke regne på den — brug en blød lov i stedet.',
    );
  }
  return session.insert(law, {
    worldId: ctx.worldId, branchId: ctx.branchId,
    kind: input.kind, hardness: input.hardness, ruleCode: input.ruleCode ?? null,
    scopeKind: input.scopeKind ?? 'world', scopeId: input.scopeId ?? null,
    subjectKind: input.subjectKind ?? 'everyone',
    subjectEntityId: input.subjectEntityId ?? null,
    subjectExpression: input.subjectExpression ?? null,
    statement: input.statement,
    validFrom: input.validFrom ?? null, validTo: input.validTo ?? null,
    sourceId: input.sourceId ?? null, enabled: true, createdAt: new Date(),
  })['id'] as string;
}

/**
 * Research. Stored and shown, not read: pulling text out of a PDF or a
 * photographed page is later work, and pretending otherwise would make the
 * source look more useful than it is.
 */
export function createSource(
  session: Session,
  ctx: Context,
  input: {
    title: string;
    kind: 'note' | 'link' | 'pdf' | 'article' | 'image' | 'file';
    url?: string;
    filePath?: string;
    mimeType?: string;
    byteSize?: number;
    note?: string;
  },
): string {
  return session.insert(source, {
    worldId: ctx.worldId, kind: input.kind, title: input.title,
    url: input.url ?? null, filePath: input.filePath ?? null,
    mimeType: input.mimeType ?? null, byteSize: input.byteSize ?? null,
    note: input.note ?? null, createdAt: new Date(),
  })['id'] as string;
}

export function linkSource(
  session: Session,
  ctx: Context,
  input: {
    sourceId: string;
    targetKind: 'fact' | 'law' | 'event' | 'entity' | 'scene' | 'work';
    targetId: string;
    relation?: 'supports' | 'context' | 'conflicts';
    quote?: string;
    note?: string;
  },
): string {
  return session.insert(sourceLink, {
    sourceId: input.sourceId, branchId: ctx.branchId,
    targetKind: input.targetKind, targetId: input.targetId,
    relation: input.relation ?? 'context',
    quote: input.quote ?? null, note: input.note ?? null,
  })['id'] as string;
}
