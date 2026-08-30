import { z } from 'zod';
import { openFindings, review } from '../../core/review';
import { RULES } from '../../core/rules';
import { dismissFinding, revokeDismissal } from '../../core/services/findings';
import { manuscriptPacket } from '../../core/queries/manuscript';
import { createSuggestion, decideSuggestion, suggestionsFor } from '../../core/services/suggestions';
import { defineTool, write, type ToolDef } from '../kit';
import { resolveScene } from '../resolve';

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
      + 'vidensbrud, manglende bærer, POV, lag, selvmøder, afsløringsrækkefølge, '
      + 'genstande, relationer, identiteter, forsvindinger, setups og kilder. '
      + 'Melder kun det, der ikke kan arrangeres anderledes — '
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
    name: 'vis_scene_til_gennemgang',
    title: 'Vis scene til manuskriptgennemgang',
    description:
      'Samler scenens prosa, synsvinkel, tidspunkt, personviden, læservarviden, gældende love, '
      + 'kildehenvisninger og eksisterende margennoter. Brug den før du vurderer prosaen. '
      + 'Kilders filer vises kun som metadata og bliver ikke læst maskinelt.',
    inputSchema: { scene: z.string() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const sc = resolveScene(tools.store, ctx, args.scene);
      const packet = manuscriptPacket(tools.store, ctx, sc.id);
      const laws = packet.laws.length
        ? packet.laws.map((l) => `  · [${l.hardness}] ${l.statement}`).join('\n')
        : '  (ingen)';
      const relation: Record<string, string> = {
        supports: 'støtter', context: 'kontekst', conflicts: 'mulig modstrid',
      };
      const sources = packet.sources.length
        ? packet.sources.map((s) =>
          `  · ${s.title} (${s.kind})${s.url ? ` — ${s.url}` : ''}`
          + `\n      ${relation[s.backs.relation] ?? s.backs.relation}: `
          + `${s.backs.kind} «${s.backs.label ?? 'væk'}»`
          + (s.backs.quote ? `\n      «${s.backs.quote}»` : '')).join('\n')
        : '  (ingen)';
      // Mærke-id'erne er ikke pynt: de er de eneste adresser i prosaen, en note
      // kan hænges på, og dermed det eneste sted et tekstforslag kan skrives ind.
      const anchors = packet.anchors.length
        ? packet.anchors.map((a) =>
          `  · ${a.markId} — ${a.targetLabel}${a.excerpt ? `: «${a.excerpt}»` : ''}`).join('\n')
        : '  (ingen — så kan et tekstforslag ikke placeres)';
      const notes = packet.suggestions.length
        ? packet.suggestions.map((s) => `  · [${s.status}/${s.kind}] ${s.message}`).join('\n')
        : '  (ingen)';
      return [
        `${packet.scene.chapterTitle} · ${packet.scene.title ?? '(uden titel)'}`,
        `POV: ${packet.pov?.name ?? '(ingen)'}${packet.pov?.legLabel ? ` · ${packet.pov.legLabel}` : ''}`,
        `Lag: ${packet.scene.realmName ?? '(ikke valgt)'}`,
        '', 'PROSA', packet.prose.markdown ?? '(ingen prosa)',
        '', 'GÆLDENDE LOVE', laws,
        '', 'KILDEHENVISNINGER (kun vist, ikke læst)', sources,
        '', 'ANKRE I PROSAEN (mærke-id, som en note kan hænges på)', anchors,
        '', 'MARGINNOTER', notes,
        '', 'Skriv kun margennoter. Ret aldrig prosaen som en del af gennemgangen.',
      ].join('\n');
    },
  }),

  defineTool({
    name: 'tilfoej_margennote',
    title: 'Tilføj margennote',
    description:
      'Læg en kommentar eller et tekstforslag ved en scene. Forslaget er inert: værktøjet ændrer '
      + 'aldrig prosaen. En foreslået formulering kan kun skrives ind af forfatteren selv, ved at '
      + 'klikke den ind i editoren — der findes ingen vej fra dette værktøj til manuskriptet. '
      + 'Angiv mærke_id fra et anker i scenen, når forslaget gælder en bestemt passage; uden det '
      + 'kan formuleringen ikke placeres, og noten kan kun læses.',
    inputSchema: {
      scene: z.string(),
      slags: z.enum(['continuity', 'craft', 'pacing', 'research']),
      besked: z.string(),
      maerke_id: z.string().optional(),
      foreslaaet_tekst: z.string().optional(),
      kilde_id: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, 'Tilføj margennote', (session, ctx) =>
        createSuggestion(session, ctx, {
          sceneId: resolveScene(tools.store, ctx, args.scene).id,
          kind: args.slags, message: args.besked, markId: args.maerke_id,
          proposedText: args.foreslaaet_tekst, sourceId: args.kilde_id,
        }));
      return `Margennoten er lagt ind uden at ændre prosaen. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'vis_margennoter',
    title: 'Vis margennoter',
    description: 'Vis åbne, fulgte og afviste kommentarer fra manuskriptgennemgangen.',
    inputSchema: {
      scene: z.string().optional(),
      status: z.enum(['open', 'accepted', 'rejected']).optional(),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const sceneId = args.scene ? resolveScene(tools.store, ctx, args.scene).id : undefined;
      const rows = suggestionsFor(tools.store, ctx, { sceneId, status: args.status });
      return rows.length
        ? rows.map((s) => `[${s.status}/${s.kind}] ${s.message}${s.proposedText ? `\n  forslag: ${s.proposedText}` : ''}\n  ${s.id}`).join('\n\n')
        : 'Der er ingen margennoter med det filter.';
    },
  }),

  defineTool({
    name: 'afgoer_margennote',
    title: 'Afgør margennote',
    description:
      'Markér en note som åben, fulgt eller afvist. Selv "fulgt" ændrer ikke prosaen; '
      + 'det registrerer kun forfatterens beslutning og kan fortrydes.',
    inputSchema: {
      id: z.string(),
      status: z.enum(['open', 'accepted', 'rejected']),
    },
    run: (args, tools) => {
      write(tools, 'Afgør margennote', (session, ctx) =>
        decideSuggestion(session, ctx, tools.store, args));
      return args.status === 'accepted' ? 'Margennoten er markeret som fulgt; prosaen er urørt.'
        : args.status === 'rejected' ? 'Margennoten er afvist; prosaen er urørt.'
          : 'Margennoten er åbnet igen.';
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
