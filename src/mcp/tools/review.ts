import { z } from 'zod';
import { openFindings, review } from '../../core/review';
import { RULES } from '../../core/rules';
import { dismissFinding, revokeDismissal } from '../../core/services/findings';
import { manuscriptPacket } from '../../core/queries/manuscript';
import { proseGaps } from '../../core/queries/proseGaps';
import { createSuggestion, decideSuggestion, suggestionsFor } from '../../core/services/suggestions';
import {
  currentText, finishReviewRun, reviewRuns, startReviewRun, type ScopeKind,
} from '../../core/services/reviews';
import { defineTool, write, type ToolDef } from '../kit';
import { resolveChapter, resolveScene, resolveSeries, resolveWork } from '../resolve';

const SCOPE: Record<string, ScopeKind> = {
  scene: 'scene', kapitel: 'chapter', bog: 'work', serie: 'series',
};

const SCOPE_DA: Record<ScopeKind, string> = {
  scene: 'scenen', chapter: 'kapitlet', work: 'bogen', series: 'serien',
};

/** «1 note», «2 noter». Et tal med den forkerte endelse læses som en fejl. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
      // En note, der blev skrevet til en tidligere version, er ikke forkert —
      // den handler bare ikke om de ord, der står her nu. Det skal kunne ses.
      const notes = packet.suggestions.length
        ? packet.suggestions.map((s) =>
          `  · [${s.status}/${s.kind}] ${s.message}`
          + (s.stale ? '\n      (skrevet til en tidligere version af scenen)' : '')).join('\n')
        : '  (ingen)';
      const version = currentText(tools.store, ctx, sc.id);
      // Navne, prosaen bruger, som bibelen ikke svarer for. Det står her, fordi
      // det er her, man opdager det: mens man læser scenen, ikke bagefter.
      const found = proseGaps(tools.store, ctx, { kind: 'scene', id: sc.id })[0];
      const gaps = [
        ...(found?.unlinked ?? []).map((u) =>
          `  · ${u.code} ${u.label} — står som «${u.phrase}»`
          + (u.count > 1 ? ` ${u.count} gange` : '')),
        ...(found?.unknown ?? []).map((u) =>
          `  · «${u.phrase}» — ingen post svarer til navnet`
          + (u.count > 1 ? ` (${u.count} steder)` : '')),
      ];
      return [
        `${packet.scene.chapterTitle} · ${packet.scene.title ?? '(uden titel)'}`,
        `POV: ${packet.pov?.name ?? '(ingen)'}${packet.pov?.legLabel ? ` · ${packet.pov.legLabel}` : ''}`,
        `Lag: ${packet.scene.realmName ?? '(ikke valgt)'}`,
        version
          ? `Version: ${version.id} · ${version.wordCount ?? 0} ord`
          : 'Version: (ingen prosa gemt endnu)',
        '', 'PROSA', packet.prose.markdown ?? '(ingen prosa)',
        '', 'GÆLDENDE LOVE', laws,
        '', 'KILDEHENVISNINGER (kun vist, ikke læst)', sources,
        '', 'ANKRE I PROSAEN (mærke-id, som en note kan hænges på)', anchors,
        '', 'MARGINNOTER', notes,
        ...(gaps.length > 0
          ? ['', 'NAVNE UDEN KOBLING (kun forfatteren kan sætte omtalen)', ...gaps]
          : []),
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
      gennemlaesning_id: z.string().optional()
        .describe('Den gennemlæsning, noten hører til, hvis den kommer fra en'),
    },
    run: (args, tools) => {
      const { value } = write(tools, 'Tilføj margennote', (session, ctx) =>
        createSuggestion(session, ctx, {
          sceneId: resolveScene(tools.store, ctx, args.scene).id,
          kind: args.slags, message: args.besked, markId: args.maerke_id,
          proposedText: args.foreslaaet_tekst, sourceId: args.kilde_id,
          runId: args.gennemlaesning_id,
        }, tools.store));
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
        ? rows.map((s) => `[${s.status}/${s.kind}] ${s.message}`
          + (s.proposedText ? `\n  forslag: ${s.proposedText}` : '')
          + (s.stale ? '\n  (skrevet til en tidligere version af scenen)' : '')
          + `\n  ${s.id}`).join('\n\n')
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
    name: 'start_gennemlaesning',
    title: 'Start en gennemlæsning',
    description:
      'Åbner en gennemlæsning af en scene, et kapitel, en bog eller en hel serie, og skriver '
      + 'ned præcis hvilken version af prosaen hver scene stod i. Uden det kan en gammel '
      + 'læsning ikke skelnes fra en, der handler om det, der står nu. Noter, du skriver '
      + 'undervejs, skal have gennemlaesning_id med, så de hører til den samme læsning. '
      + 'Gennemlæsningen skriver aldrig i prosaen.',
    inputSchema: {
      omfang: z.enum(['scene', 'kapitel', 'bog', 'serie']),
      hvad: z.string().describe('Scenen, kapitlet, bogen eller serien — id eller navn'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const kind = SCOPE[args.omfang]!;
      const id = kind === 'scene' ? resolveScene(tools.store, ctx, args.hvad).id
        : kind === 'chapter' ? resolveChapter(tools.store, ctx, args.hvad).id
          : kind === 'work' ? resolveWork(tools.store, ctx, args.hvad).id
            : resolveSeries(tools.store, ctx, args.hvad).id;
      const { value } = write(tools, 'Start gennemlæsning', (session, c) =>
        startReviewRun(session, c, tools.store, { kind, id }));
      const lines = value.scenes.map((sc) =>
        `  ${String(sc.position).padStart(3)}. ${sc.workTitle} · ${sc.chapterTitle} · `
        + `${sc.title ?? '(uden titel)'}`
        + (sc.textId ? ` — ${sc.wordCount ?? 0} ord, version ${sc.textId}` : ' — ingen prosa endnu'));
      const empty = value.scenes.filter((sc) => sc.textId == null).length;
      return [
        `Gennemlæsning af ${SCOPE_DA[kind]} «${value.scopeLabel}» er åbnet. (id: ${value.runId})`,
        `${count(value.scenes.length, 'scene', 'scener')}`
        + `${empty ? `, hvoraf ${empty} endnu ikke har prosa` : ''}.`,
        '', ...lines,
        '',
        'Læs dem med vis_scene_til_gennemgang og kommentér med tilfoej_margennote. '
        + 'Afslut med afslut_gennemlaesning, når du har været hele vejen igennem.',
      ].join('\n');
    },
  }),

  defineTool({
    name: 'afslut_gennemlaesning',
    title: 'Afslut en gennemlæsning',
    description:
      'Lukker gennemlæsningen og gemmer, hvad den samlet set kom frem til. Læsningen bliver '
      + 'stående med de versioner, den gjaldt.',
    inputSchema: { id: z.string(), opsummering: z.string().optional() },
    run: (args, tools) => {
      write(tools, 'Afslut gennemlæsning', (session, ctx) =>
        finishReviewRun(session, ctx, tools.store, { id: args.id, summary: args.opsummering }));
      return 'Gennemlæsningen er afsluttet.';
    },
  }),

  defineTool({
    name: 'vis_gennemlaesninger',
    title: 'Vis gennemlæsninger',
    description:
      'Hvad der er blevet læst igennem, hvornår, og hvor meget af prosaen der er skrevet om '
      + 'siden. En læsning, hvis scener alle er skrevet om, siger ikke længere noget om bogen.',
    inputSchema: { antal: z.number().int().positive().optional() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const runs = reviewRuns(tools.store, ctx, { limit: args.antal });
      if (runs.length === 0) return 'Der er ikke læst noget igennem endnu.';
      return runs.map((run) => [
        `${SCOPE_DA[run.scopeKind]} «${run.scopeLabel}» — ${run.createdAt.toLocaleDateString('da-DK')}`
        + (run.finishedAt ? '' : '  (stadig åben)'),
        `  ${count(run.scenes, 'scene', 'scener')}, `
        + `${count(run.notes, 'note', 'noter')} `
        + `(${run.openNotes === 1 ? '1 åben' : `${run.openNotes} åbne`})`,
        run.rewritten > 0
          ? `  ${run.rewritten} af scenerne er skrevet om siden — `
            + 'så meget af læsningen er forældet'
          : '  ingen af scenerne er skrevet om siden',
        run.summary ? `  «${run.summary}»` : '',
        `  ${run.id}`,
      ].filter(Boolean).join('\n')).join('\n\n');
    },
  }),

  defineTool({
    name: 'vis_navne_uden_kobling',
    title: 'Vis navne uden kobling',
    description:
      'Finder navne, der står i prosaen uden at hænge sammen med bibelen. To slags, og de '
      + 'er ikke det samme problem: en person, et sted eller en genstand, der har en post, '
      + 'men som ingen omtale i scenen peger på — den er ét klik fra at være knyttet — og '
      + 'et navn, ingen post svarer til, som er en beslutning, forfatteren ikke har taget '
      + 'endnu. Ingen af delene er en fejl, og der findes ingen vej herfra til at skrive i '
      + 'prosaen: en omtale sættes kun af forfatteren selv i editoren. Skriv i stedet en '
      + 'margennote om det, der er værd at tage stilling til.',
    inputSchema: {
      omfang: z.enum(['scene', 'kapitel', 'bog', 'serie']),
      hvad: z.string().describe('Scenen, kapitlet, bogen eller serien — id eller navn'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const kind = SCOPE[args.omfang]!;
      const id = kind === 'scene' ? resolveScene(tools.store, ctx, args.hvad).id
        : kind === 'chapter' ? resolveChapter(tools.store, ctx, args.hvad).id
          : kind === 'work' ? resolveWork(tools.store, ctx, args.hvad).id
            : resolveSeries(tools.store, ctx, args.hvad).id;
      const gaps = proseGaps(tools.store, ctx, { kind, id });
      if (gaps.length === 0) {
        return `Hvert navn i prosaen i ${SCOPE_DA[kind]} har en omtale, der peger på det.`;
      }
      const blocks = gaps.map((g) => [
        `${g.workTitle} · ${g.chapterTitle} · ${g.title ?? '(uden titel)'}`
        + `  (${count(g.linked, 'omtale', 'omtaler')} i forvejen)`,
        ...g.unlinked.map((u) =>
          `  uden kobling: ${u.code} ${u.label} — står som «${u.phrase}»`
          + (u.count > 1 ? ` ${u.count} gange` : '')),
        ...(g.unknown.length > 0
          ? [`  ingen post: ${g.unknown.map((u) =>
            `«${u.phrase}»${u.count > 1 ? ` (${u.count})` : ''}`).join(', ')}`]
          : []),
        `  ${g.sceneId}`,
      ].join('\n'));
      return [
        `${count(gaps.length, 'scene', 'scener')} har navne uden kobling.`,
        ...blocks,
      ].join('\n\n');
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
