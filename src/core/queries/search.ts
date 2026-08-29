import type { Store } from '../../db/client';
import type { Context } from '../workbench';

export interface SearchHit {
  kind: string;
  id: string;
  label: string;
  detail: string | null;
}

/**
 * Free text across the bible and the prose.
 *
 * Plain LIKE over the columns a person actually searches. It is not clever, and
 * at the size of one writer's world it does not need to be -- when it does,
 * SQLite's own full-text index goes behind this same signature.
 */
export function find(store: Store, ctx: Context, query: string, limit = 30): SearchHit[] {
  const needle = `%${query.trim().toLowerCase()}%`;
  const hits: SearchHit[] = [];
  const run = (sql: string, kind: string) => {
    const rows = store.sqlite.prepare(sql).all(ctx.branchId, needle, needle) as
      { id: string; label: string; detail: string | null }[];
    for (const r of rows) hits.push({ kind, ...r });
  };

  run(`select id, name as label, summary as detail from entity
       where branch_id = ? and (lower(name) like ? or lower(coalesce(summary,'')) like ?)`, 'entitet');
  run(`select id, title as label, summary as detail from event
       where branch_id = ? and (lower(title) like ? or lower(coalesce(summary,'')) like ?)`, 'event');
  run(`select id, summary as label, predicate as detail from fact
       where branch_id = ? and (lower(summary) like ? or lower(predicate) like ?)`, 'faktum');
  run(`select id, statement as label, rule_code as detail from law
       where branch_id = ? and (lower(statement) like ? or lower(coalesce(rule_code,'')) like ?)`, 'lov');
  run(`select id, title as label, summary as detail from chapter
       where branch_id = ? and (lower(title) like ? or lower(coalesce(summary,'')) like ?)`, 'kapitel');
  run(`select id, coalesce(title,'(uden titel)') as label, summary as detail from scene
       where branch_id = ? and (lower(coalesce(title,'')) like ? or lower(coalesce(summary,'')) like ?)`, 'scene');
  run(`select id, substr(coalesce(markdown,''), 1, 120) as label, null as detail from scene_text
       where branch_id = ? and (lower(coalesce(markdown,'')) like ? or ? is null)`, 'prosa');

  return hits.slice(0, limit);
}
