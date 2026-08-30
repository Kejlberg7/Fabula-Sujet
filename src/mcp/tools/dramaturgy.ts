import { z } from 'zod';
import { lineageRoot, workInBranch } from '../../core/branches';
import { compareTwists, twistReadings } from '../../core/queries/dramaturgy';
import { branch } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { defineTool, type ToolDef, type Tools } from '../kit';

const MARK: Record<string, string> = { staerk: '+', se_efter: '?', tynd: '−' };

function activeWork(tools: Tools, given?: string): string {
  const ctx = tools.bench.context();
  if (given) return given;
  if (!ctx.workId) throw new Error('Der er ikke valgt en bog. Brug saet_aktivt_vaerk.');
  return ctx.workId;
}

export const dramaturgyTools: ToolDef[] = [
  defineTool({
    name: 'vurder_afsloeringer',
    title: 'Vurder afsløringerne',
    description:
      'Hvor godt virker bogens afsløringer — ikke om de er mulige, men om de er noget værd. '
      + 'Læses på otte akser: overraskelse, retfærdighed, efterrationalisering, timing, konsekvens, '
      + 'vildledning, forberedelse og informationskontrol. Der gives med vilje ingen karakter: '
      + 'hver aflæsning peger på de scener, den kommer af, for det er dem, forfatteren kan gøre '
      + 'noget ved. En akse tier, når der ikke er noget at regne på.',
    inputSchema: {
      vaerk: z.string().optional(),
      faktum: z.string().optional().describe('Nøjes med afsløringer af dette faktum'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const reports = twistReadings(tools.store, ctx, { workId: activeWork(tools, args.vaerk) })
        .filter((r) => !args.faktum
          || r.summary.toLowerCase().includes(args.faktum.toLowerCase()));
      if (reports.length === 0) return 'Der er ingen afsløringer at vurdere endnu.';

      return reports.map((r) => {
        const head = `${r.summary}\n  ${r.shape}`
          + (r.disclosure
            ? `\n  Sagt i scene ${r.disclosure.order} af ${r.totalScenes}: «${r.disclosure.title}»`
            : '');
        const lines = r.readings.map((x) =>
          `  ${MARK[x.verdict] ?? '·'} ${x.title}: ${x.message}`
          + (x.scenes.length
            ? `\n      ${x.scenes.map((s) => `${s.order}. ${s.title}`).join(' · ')}`
            : ''));
        return `${head}\n${lines.join('\n')}`;
      }).join('\n\n');
    },
  }),

  defineTool({
    name: 'sammenlign_afsloeringer',
    title: 'Sammenlign afsløringer på to grene',
    description:
      'Læser de samme afsløringer på to grene og viser, hvilke akser der flytter sig. '
      + '«Twistet i kapitel 8» mod «twistet i kapitel 12» kan ikke afgøres i luften — '
      + 'men med begge rækkefølger skrevet ned er forskellen på akserne selve argumentet.',
    inputSchema: {
      gren: z.string().describe('Navnet på grenen, der sammenlignes med'),
      vaerk: z.string().optional(),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const workId = activeWork(tools, args.vaerk);
      const others = tools.store.db.select().from(branch)
        .where(eq(branch.worldId, ctx.worldId)).all()
        .filter((b) => b.id !== ctx.branchId);
      const target = others.find((b) =>
        b.name.localeCompare(args.gren, 'da', { sensitivity: 'accent' }) === 0)
        ?? others.find((b) => b.name.toLowerCase().includes(args.gren.toLowerCase()));
      if (!target) {
        return `Fandt ikke grenen «${args.gren}». Der er: ${others.map((b) => b.name).join(', ') || 'ingen andre'}.`;
      }
      const otherWorkId = workInBranch(tools.store, workId, target.id);
      if (!otherWorkId) return 'Bogen findes ikke på den anden gren.';

      const shifts = compareTwists(tools.store, {
        here: ctx, hereWorkId: workId,
        there: { ...ctx, branchId: target.id }, thereWorkId: otherWorkId,
        lineage: (table, id) => lineageRoot(tools.store, table, id),
      });
      if (shifts.length === 0) return `Afsløringerne står ens på denne gren og «${target.name}».`;

      return shifts.map((s) =>
        `${s.summary}\n`
        + `  her:  scene ${s.here ?? '—'} · ${s.hereShape}\n`
        + `  der:  scene ${s.there ?? '—'} · ${s.thereShape}\n`
        + s.moved.map((m) => `  ${m.title}\n      her: ${m.here}\n      der: ${m.there}`).join('\n'),
      ).join('\n\n');
    },
  }),
];
