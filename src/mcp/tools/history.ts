import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { change, checkpoint } from '../../db/schema';
import {
  history, markCheckpoint, redoLast, rollbackTo, undoLast,
} from '../../core/changelog';
import { deleteRow, updateRow } from '../../core/services/generic';
import { formatInstant } from '../../core/time/gregorian';
import { defineTool, write, type ToolDef } from '../kit';

const when = (at: Date) => formatInstant(Math.floor(at.getTime() / 1000), 'minute');

export const historyTools: ToolDef[] = [
  defineTool({
    name: 'opdater',
    title: 'Opdater',
    description:
      'Ret felter på en hvilken som helst række. Tabelnavnene er engelske og står i docs/GLOSSARY.md '
      + '— fx "entity", "event", "fact", "belief", "scene". Rettelsen går gennem loggen og kan fortrydes.',
    inputSchema: {
      tabel: z.string(),
      id: z.string(),
      felter: z.record(z.string(), z.unknown()).describe('Feltnavn → ny værdi (engelske feltnavne)'),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Ret ${args.tabel}`, (session) =>
        updateRow(session, tools.store, {
          table: args.tabel, id: args.id, patch: args.felter as Record<string, unknown>,
        }));
      void value;
      return `${args.tabel} ${args.id} er rettet: ${Object.keys(args.felter).join(', ')}.`;
    },
  }),

  defineTool({
    name: 'slet',
    title: 'Slet',
    description:
      'Fjerner en række. Den ligger stadig i loggen, så et fortryd henter den tilbage med alle felter.',
    inputSchema: { tabel: z.string(), id: z.string() },
    run: (args, tools) => {
      write(tools, `Slet ${args.tabel}`, (session) =>
        deleteRow(session, tools.store, { table: args.tabel, id: args.id }));
      return `${args.tabel} ${args.id} er slettet. Sig til, hvis det var forkert — fortryd henter den tilbage.`;
    },
  }),

  defineTool({
    name: 'fortryd',
    title: 'Fortryd',
    description:
      'Fortryder den seneste handling — hele den, ikke én række ad gangen. Fortrydelsen er selv en '
      + 'handling, så den kan gentages.',
    inputSchema: {},
    run: (_args, tools) => {
      const ctx = tools.bench.context();
      const undone = undoLast(tools.store, ctx.branchId, tools.actor);
      if (!undone) return 'Der er ikke noget at fortryde.';
      const latest = history(tools.store.db, ctx.branchId, 1)[0];
      return `Fortrudt${latest?.summary ? `: ${latest.summary.replace(/^Fortryd: /, '')}` : ''}.`;
    },
  }),

  defineTool({
    name: 'gentag',
    title: 'Gentag',
    description: 'Fortryder den seneste fortrydelse.',
    inputSchema: {},
    run: (_args, tools) => {
      const ctx = tools.bench.context();
      const redone = redoLast(tools.store, ctx.branchId, tools.actor);
      return redone ? 'Gentaget.' : 'Der er ikke nogen fortrydelse at gentage.';
    },
  }),

  defineTool({
    name: 'saet_nedslag',
    title: 'Sæt nedslag',
    description:
      'Et navngivet punkt at komme tilbage til: "sådan så det ud, før jeg skrev kapitel fem om".',
    inputSchema: { maerkat: z.string(), note: z.string().optional() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const id = markCheckpoint(tools.store.db, ctx.branchId, args.maerkat, args.note);
      return `Nedslaget "${args.maerkat}" er sat. (id: ${id})`;
    },
  }),

  defineTool({
    name: 'rul_tilbage_til',
    title: 'Rul tilbage til',
    description:
      'Fortryder alt efter et punkt. Angiv enten et nedslag eller et trinnummer fra historikken. '
      + 'Selve tilbagerulningen kan også fortrydes.',
    inputSchema: {
      nedslag: z.string().optional().describe('Mærkat eller id'),
      trin: z.number().optional().describe('Trinnummer fra historik'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      let seq = args.trin;
      if (args.nedslag) {
        const marks = tools.store.db.select().from(checkpoint)
          .where(eq(checkpoint.branchId, ctx.branchId)).all();
        const hit = marks.find((m) => m.id === args.nedslag)
          ?? marks.find((m) => m.label.toLowerCase() === args.nedslag!.toLowerCase());
        if (!hit) throw new Error(`Jeg kan ikke finde et nedslag der hedder "${args.nedslag}".`);
        seq = hit.changeSeq;
      }
      if (seq == null) throw new Error('Angiv enten et nedslag eller et trinnummer.');
      const undone = rollbackTo(tools.store, ctx.branchId, seq, tools.actor);
      return undone === 0
        ? 'Der var ikke noget at rulle tilbage.'
        : `Rullet tilbage. ${undone} handling${undone === 1 ? '' : 'er'} er fortrudt.`;
    },
  }),

  defineTool({
    name: 'historik',
    title: 'Historik',
    description:
      'Hvad der er sket, hvornår, og af hvem. Trinnummeret bagest kan bruges med rul_tilbage_til.',
    inputSchema: { antal: z.number().optional() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const rows = history(tools.store.db, ctx.branchId, args.antal ?? 20);
      if (rows.length === 0) return 'Der er ikke sket noget endnu.';
      return rows.map((r) => {
        const who = r.actorKind === 'assistant' ? 'Claude' : r.actorKind === 'user' ? 'dig' : 'systemet';
        const state = r.undone ? ' [fortrudt]' : '';
        return `[trin ${r.lastSeq}] ${when(r.startedAt)} — ${r.summary ?? '(uden beskrivelse)'} `
          + `(${r.changeCount} ${r.changeCount === 1 ? 'ændring' : 'ændringer'}, af ${who})${state}`;
      }).join('\n');
    },
  }),

  defineTool({
    name: 'vis_aendringer',
    title: 'Vis ændringer',
    description: 'De seneste enkeltændringer, hvis du vil se præcis hvilke rækker der blev rørt.',
    inputSchema: { antal: z.number().optional() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const rows = tools.store.db.select().from(change)
        .where(eq(change.branchId, ctx.branchId))
        .orderBy(desc(change.seq)).limit(args.antal ?? 20).all();
      if (rows.length === 0) return 'Loggen er tom.';
      const verb = { insert: 'oprettede', update: 'rettede', delete: 'slettede', merge: 'flettede' };
      return rows.map((c) =>
        `[${c.seq}] ${verb[c.op]} ${c.tableName} ${c.rowId}${c.undoneAt ? ' [fortrudt]' : ''}`).join('\n');
    },
  }),
];
