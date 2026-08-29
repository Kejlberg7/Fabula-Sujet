import { z } from 'zod';
import { openFindings, review } from '../../core/review';
import { RULES } from '../../core/rules';
import { dismissFinding, revokeDismissal } from '../../core/services/findings';
import { defineTool, write, type ToolDef } from '../kit';

const MARK: Record<string, string> = { error: '✗', warning: '!', note: '·' };

function render(
  findings: { severity: string; ruleCode: string; message: string; fingerprint: string;
    dismissedReason: string | null; returned?: boolean }[],
): string {
  return findings.map((f) =>
    `${MARK[f.severity] ?? '·'} [${f.ruleCode}] ${f.message}`
    + (f.returned ? '\n   (den var væk, og er kommet tilbage)' : '')
    + (f.dismissedReason ? `\n   afvist: ${f.dismissedReason}` : '')
    + `\n   ${f.fingerprint}`).join('\n\n');
}

export const reviewTools: ToolDef[] = [
  defineTool({
    name: 'koer_gennemgang',
    title: 'Kør gennemgangen',
    description:
      'Løser tiden og kører alle reglerne igennem: bilokation, rejsetid, liv og alder, '
      + 'vidensbrud og manglende bærer. Melder kun det, der ikke kan arrangeres anderledes — '
      + 'en uskarp dato, der stadig kan lægges, så det går op, er ikke en fejl, men noget '
      + 'du ikke har besluttet endnu. En evne, der nævner regelkoden, slår den pågældende '
      + 'regel fra, og det, den ville have meldt, står for sig som løftet.',
    inputSchema: {
      regler: z.array(z.string()).optional()
        .describe('Kør kun disse regelkoder. Udelad for dem alle'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const report = review(tools.store, ctx, args.regler);
      const { errors, warnings, notes, dismissed } = report.counts;

      const head = errors + warnings + notes === 0
        ? 'Ingenting at melde.'
        : `${errors} fejl, ${warnings} advarsler, ${notes} bemærkninger.`;
      const tail = [
        report.appeared > 0 ? `${report.appeared} er nye.` : '',
        report.resolved > 0 ? `${report.resolved} er blevet rettet siden sidst.` : '',
        dismissed > 0 ? `${dismissed} er afvist og tælles ikke med.` : '',
      ].filter(Boolean).join(' ');

      const live = report.findings.filter((f) => f.dismissedReason == null);
      const body = live.length ? `\n\n${render(live)}` : '';
      const lifted = report.lifted.length
        ? `\n\nLøftet af en lov (meldes ikke):\n`
          + report.lifted.map((f) => `  · [${f.ruleCode}] ${f.message}\n    lov: «${f.lifted}»`).join('\n')
        : '';
      return `${head}${tail ? ` ${tail}` : ''}${body}${lifted}`;
    },
  }),

  defineTool({
    name: 'vis_fund',
    title: 'Vis fund',
    description: 'Det, der står åbent lige nu, uden at køre gennemgangen igen.',
    inputSchema: { medtag_afviste: z.boolean().optional() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const all = openFindings(tools.store, ctx);
      const shown = args.medtag_afviste ? all : all.filter((f) => f.dismissedReason == null);
      if (shown.length === 0) return 'Der står ingen fund åbne.';
      return render(shown);
    },
  }),

  defineTool({
    name: 'afvis_fund',
    title: 'Afvis et fund',
    description:
      'Læg et fund til side med en grund. Det holder på tværs af gennemgange, fordi det '
      + 'hænger på fingeraftrykket og ikke på rækken. Grunden er ikke valgfri: en advarsel, '
      + 'der kan slukkes uden at sige hvorfor, bliver til en liste, ingen læser.',
    inputSchema: {
      fingeraftryk: z.string(),
      grund: z.string(),
    },
    run: (args, tools) => {
      write(tools, 'Afvis fund', (session, ctx) =>
        dismissFinding(session, ctx, tools.store, {
          fingerprint: args.fingeraftryk, reason: args.grund,
        }));
      return `Lagt til side: «${args.grund}»`;
    },
  }),

  defineTool({
    name: 'genaabn_fund',
    title: 'Tag en afvisning tilbage',
    description: 'Fundet dukker op igen ved næste gennemgang.',
    inputSchema: { fingeraftryk: z.string() },
    run: (args, tools) => {
      const { value } = write(tools, 'Tag afvisning tilbage', (session, ctx) =>
        revokeDismissal(session, ctx, tools.store, { fingerprint: args.fingeraftryk }));
      return value ? 'Afvisningen er taget tilbage.' : 'Der var ingen afvisning at tage tilbage.';
    },
  }),

  defineTool({
    name: 'vis_regler',
    title: 'Vis reglerne',
    description: 'Hvilke regler motoren kører, og hvad de hedder på dansk.',
    inputSchema: {},
    run: () => RULES.map((r) => `  ${r.code.padEnd(18)} ${r.title}`).join('\n'),
  }),
];
